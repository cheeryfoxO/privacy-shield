/**
 * 隐私护盾 - Content Script 入口
 * 协调页面生命周期，在合适的时机触发扫描和报告
 * 运行时机：document_start（在 manifest.json 中指定）
 */

(function() {
  'use strict';

  // 跳过不支持扫描的页面
  if (window.location.protocol === 'chrome:' ||
      window.location.protocol === 'chrome-extension:' ||
      window.location.protocol === 'devtools:' ||
      window.location.protocol === 'about:') {
    return;
  }

  console.log('[隐私护盾] 已激活 - ' + window.location.hostname);

  /**
   * 主动触发一次扫描并发送报告
   */
  async function triggerScan() {
    try {
      // 优先使用 message-bridge 提供的统一收集函数
      if (typeof collectAndSendReport === 'function') {
        await collectAndSendReport();
      } else if (typeof MessageBridge !== 'undefined') {
        const report = collectReportFromDetectors();
        await MessageBridge.sendPrivacyReport(report);
      } else {
        // fallback: 直接发送
        const report = collectReportFromDetectors();
        await chrome.runtime.sendMessage({
          type: 'PRIVACY_REPORT',
          data: report
        });
      }
      console.log('[隐私护盾] 扫描报告已发送');
    } catch (e) {
      console.warn('[隐私护盾] 发送失败，将在 1 秒后重试:', e.message);
      setTimeout(async () => {
        try {
          const report = collectReportFromDetectors();
          await chrome.runtime.sendMessage({ type: 'PRIVACY_REPORT', data: report });
        } catch (retryErr) {
          console.error('[隐私护盾] 重试也失败了');
        }
      }, 1000);
    }
  }

  /**
   * 从各检测器收集报告（后备方案）
   */
  function collectReportFromDetectors() {
    let thirdPartyDomains = window.__PRIVACY_THIRD_PARTY_DOMAINS;
    if (!thirdPartyDomains && typeof scanThirdPartyDomains === 'function') {
      thirdPartyDomains = scanThirdPartyDomains();
    }

    let canvasReport = { detected: false, events: [] };
    if (typeof window.__PRIVACY_GET_CANVAS_REPORT === 'function') {
      canvasReport = window.__PRIVACY_GET_CANVAS_REPORT();
    }

    let webrtcReport = { detected: false, events: [] };
    if (typeof window.__PRIVACY_GET_WEBRTC_REPORT === 'function') {
      webrtcReport = window.__PRIVACY_GET_WEBRTC_REPORT();
    }

    return {
      url: window.location.href,
      timestamp: Date.now(),
      domain: typeof extractDomain === 'function'
        ? extractDomain(window.location.hostname)
        : window.location.hostname,
      thirdPartyDomains: thirdPartyDomains || [],
      canvasFingerprinting: canvasReport,
      webrtcLeaks: webrtcReport
    };
  }

  // ============================================================
  // 页面加载完成后自动发送报告（第一次）
  // ============================================================
  function scheduleInitialScan() {
    if (document.readyState === 'complete') {
      setTimeout(triggerScan, 2000); // 让动态资源有时间加载
    } else {
      window.addEventListener('load', () => {
        setTimeout(triggerScan, 2000);
      });
    }
  }

  scheduleInitialScan();

  // ============================================================
  // SPA 路由变化时重新扫描
  // ============================================================
  let lastUrl = window.location.href;

  const _pushState = history.pushState;
  const _replaceState = history.replaceState;

  history.pushState = function() {
    _pushState.apply(this, arguments);
    onUrlChange();
  };

  history.replaceState = function() {
    _replaceState.apply(this, arguments);
    onUrlChange();
  };

  window.addEventListener('popstate', onUrlChange);
  window.addEventListener('hashchange', onUrlChange);

  function onUrlChange() {
    const currentUrl = window.location.href;
    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl;
      console.log('[隐私护盾] SPA 路由变化，重新扫描...');
      setTimeout(triggerScan, 2000);
    }
  }

  // ============================================================
  // 监听来自 Background 的 PING 消息（保持连接活跃）
  // ============================================================
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'PING') {
      sendResponse({ alive: true });
    }
    // REQUEST_REPORT 由 message-bridge.js 处理
  });

  console.log('[隐私护盾] 初始化完成');

  // ============================================================
  // 内联 URL 清理（轻量版，避免额外文件加载）
  // ============================================================

  const TRACKING_PARAMS_SET = new Set([
    'fbclid','gclid','gclsrc','dclid','msclkid','twclid',
    '_ga','_gl','gbraid','wbraid','gad_source','gad_medium',
    'utm_source','utm_medium','utm_campaign','utm_term','utm_content',
    'utm_id','utm_source_platform','utm_creative_format',
    'utm_marketing_tactic','utm_audience',
    'spm','scm','ali_trackid','ali_refid','tracelog','lwfrom',
    'jd_pop','pps','ptag','_t_t_t',
    'refer_page_name','refer_page_id','refer_page_sn',
    'enter_from','previous_page','traffic_source',
    'zh_forcehybrid','utm_oi',
    'spm_id_from','from_source','from_spm_id',
    'sudaref','cate_sudaref',
    'ref_','pd_rd_','pf_rd_','tag',
    'utm_name','utm_term',
    'ref','referrer','source','tracking','trk','trkCampaign',
    'mc_cid','mc_eid','mc_tc',
    'hmb_campaign','hmb_medium','hmb_source',
    'oly_anon_id','oly_enc_id','otc','oicd',
    'vero_conv','vero_id','yclid','_openstat',
    'wickedid','wickedcampaign','igshid','si',
    'nrs_host','nsukey','__nc_form_id','format'
  ]);

  const PREFIX_PARAMS_LIST = ['ref_', 'pd_rd_', 'pf_rd_', 'psc_'];

  function isURL(text) {
    return /^https?:\/\/\S+/i.test(text.trim());
  }

  function cleanURLInPlace(url) {
    if (!url) return url;
    try {
      const u = new URL(url);
      const sp = new URLSearchParams(u.search);
      const toRemove = [];
      for (const [key] of sp) {
        const lk = key.toLowerCase();
        if (TRACKING_PARAMS_SET.has(lk) || PREFIX_PARAMS_LIST.some(p => lk.startsWith(p))) {
          toRemove.push(key);
        }
      }
      for (const k of toRemove) sp.delete(k);
      const cleanSearch = sp.toString();
      let result = u.origin + u.pathname;
      if (cleanSearch) result += '?' + cleanSearch;
      if (u.hash) result += u.hash;
      return result;
    } catch (e) { return url; }
  }

  // ============================================================
  // URL 追踪参数自动清理（复制拦截）
  // ============================================================
  let linkCleanEnabled = true;

  chrome.storage.sync.get(['linkCleanEnabled'], (result) => {
    if (result.linkCleanEnabled !== undefined) {
      linkCleanEnabled = result.linkCleanEnabled;
    }
  });

  document.addEventListener('copy', (e) => {
    if (!linkCleanEnabled) return;

    const selection = window.getSelection().toString().trim();
    if (!selection || !isURL(selection)) return;

    const cleaned = cleanURLInPlace(selection);
    if (cleaned === selection) return;

    e.preventDefault();
    e.clipboardData.setData('text/plain', cleaned);

    chrome.runtime.sendMessage({
      type: 'CLEAN_LINK_STATS',
      data: { domain: window.location.hostname, cleaned }
    }).catch(() => {});
  });

})();
