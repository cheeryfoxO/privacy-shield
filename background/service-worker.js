/**
 * 隐私护盾 - 后台 Service Worker
 * 负责：webRequest 监控、Cookie 收集、数据聚合、评分计算
 */

// ============================================================
// 导入共享库（MV3 Service Worker 使用 importScripts）
// ============================================================
importScripts(
  '../lib/url-parser.js',
  '../lib/known-trackers.js',
  '../lib/cookie-analyzer.js',
  '../lib/privacy-score.js',
  '../lib/storage-manager.js',
  '../lib/ad-rules-engine.js'
);

// ============================================================
// 网络请求缓冲区（Service Worker 可能随时休眠，需要持久化思想）
// ============================================================
const tabNetworkRequests = new Map(); // tabId -> Set of domains

// ============================================================
// webRequest 监听器 — 记录所有第三方网络请求
// ============================================================
chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (details.tabId < 0) return; // 非标签页请求（如后台同步）

    try {
      const requestUrl = new URL(details.url);
      const tabId = details.tabId;

      if (!tabNetworkRequests.has(tabId)) {
        tabNetworkRequests.set(tabId, new Map());
      }

      const tabRequests = tabNetworkRequests.get(tabId);
      if (!tabRequests.has(requestUrl.hostname)) {
        tabRequests.set(requestUrl.hostname, {
          types: new Set(),
          count: 0
        });
      }

      const entry = tabRequests.get(requestUrl.hostname);
      entry.types.add(details.type);
      entry.count++;
    } catch (e) {
      // 忽略无效 URL
    }
  },
  { urls: ['<all_urls>'] }
);

// ============================================================
// 消息处理
// ============================================================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender, sendResponse);
  return true; // 允许异步响应
});

async function handleMessage(message, sender, sendResponse) {
  switch (message.type) {
    case 'PRIVACY_REPORT':
      await handlePrivacyReport(message.data, sender);
      sendResponse({ received: true });
      break;

    case 'GET_REPORT':
      await handleGetReport(message.tabId, sendResponse);
      break;

    case 'GET_OPTIONS':
      handleGetOptions(sendResponse);
      break;

    case 'CLEAR_TAB_DATA':
      clearTabData(message.tabId);
      sendResponse({ received: true });
      break;

    // ---- 广告拦截消息 ----
    case 'AD_BLOCKER_STATUS':
      handleAdBlockerStatus(message.domain, sendResponse);
      break;

    case 'AD_BLOCKER_STATS':
      handleAdBlockerStats(message.data, sendResponse);
      break;

    case 'AD_TOGGLE':
      handleAdToggle(message.enabled, sendResponse);
      break;

    case 'AD_ADD_RULE':
      handleAdAddRule(message.rule, sendResponse);
      break;

    case 'AD_REMOVE_RULE':
      handleAdRemoveRule(message.ruleId, message.type, sendResponse);
      break;

    case 'AD_GET_RULES':
      handleAdGetRules(sendResponse);
      break;

    case 'AD_WHITELIST':
      handleAdWhitelist(message.action, message.domain, sendResponse);
      break;

    case 'CLEAN_LINK_STATS':
      handleCleanLinkStats(message.data, sendResponse);
      break;

    default:
      sendResponse({ error: 'Unknown message type: ' + message.type });
  }
}

// ============================================================
// 处理 Content Script 发来的隐私报告
// ============================================================
async function handlePrivacyReport(data, sender) {
  const tabId = sender.tab ? sender.tab.id : data.tabId;
  if (!tabId) return;

  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab || !tab.url) return;

  const url = tab.url;
  const firstPartyDomain = extractDomainFromUrl(url);

  // 获取 Cookie 数据
  const cookies = await inspectCookies(url, firstPartyDomain);

  // 获取 webRequest 记录的第三方域名
  const networkDomains = getNetworkDomains(tabId, firstPartyDomain);

  // 合并第三方域名数据
  const mergedThirdPartyDomains = mergeThirdPartyDomains(
    data.thirdPartyDomains || [],
    networkDomains
  );

  // 构建完整报告
  const report = {
    url: url,
    domain: firstPartyDomain,
    timestamp: Date.now(),
    thirdPartyDomains: mergedThirdPartyDomains,
    cookies: cookies,
    canvasFingerprinting: data.canvasFingerprinting || { detected: false, events: [] },
    webrtcLeaks: data.webrtcLeaks || { detected: false, events: [] },
    overallScore: null,
    scoreBreakdown: null
  };

  // 计算隐私评分
  const scoreResult = calculatePrivacyScore(report);
  report.overallScore = scoreResult.overallScore;
  report.scoreBreakdown = scoreResult.breakdown;

  // 持久化到 storage
  await StorageManager.saveReport(tabId, report);

  // 记录跨站点历史
  await recordHistory(report);
}

// ============================================================
// 获取 Cookie 数据
// ============================================================
async function inspectCookies(url, firstPartyDomain) {
  try {
    const allCookies = await chrome.cookies.getAll({ url: url });
    return allCookies.map(cookie => analyzeCookie(cookie, firstPartyDomain));
  } catch (e) {
    // 如果 url 受限，尝试获取所有 cookie
    try {
      const allCookies = await chrome.cookies.getAll({});
      return allCookies
        .filter(c => cookieDomainMatches(c, firstPartyDomain))
        .map(cookie => analyzeCookie(cookie, firstPartyDomain));
    } catch (e2) {
      return [];
    }
  }
}

function cookieDomainMatches(cookie, firstPartyDomain) {
  const cookieDomain = cookie.domain.replace(/^\./, '');
  return cookieDomain.endsWith(firstPartyDomain) ||
         firstPartyDomain.endsWith(cookieDomain.replace(/^\./, ''));
}

// ============================================================
// 获取 webRequest 记录的第三方域名
// ============================================================
function getNetworkDomains(tabId, firstPartyDomain) {
  const tabRequests = tabNetworkRequests.get(tabId);
  if (!tabRequests) return [];

  const domains = [];
  for (const [hostname, entry] of tabRequests) {
    if (hostname !== firstPartyDomain && !hostname.endsWith('.' + firstPartyDomain)) {
      domains.push({
        domain: hostname,
        resourceTypes: Array.from(entry.types),
        urlCount: entry.count,
        sources: ['webRequest']
      });
    }
  }

  // 清理该标签页的缓冲数据
  tabNetworkRequests.delete(tabId);

  return domains;
}

// ============================================================
// 合并第三方域名
// ============================================================
function mergeThirdPartyDomains(domScriptDomains, networkDomains) {
  const merged = new Map();

  // 先加入 DOM/Performance API 数据
  for (const item of domScriptDomains) {
    merged.set(item.domain, { ...item });
  }

  // 合并 webRequest 数据
  for (const item of networkDomains) {
    if (merged.has(item.domain)) {
      const existing = merged.get(item.domain);
      existing.resourceTypes = [...new Set([...existing.resourceTypes, ...item.resourceTypes])];
      existing.urlCount += item.urlCount;
      existing.sources = [...new Set([...existing.sources, ...item.sources])];
    } else {
      merged.set(item.domain, { ...item, urlCount: item.urlCount || 1, urls: [] });
    }
  }

  return Array.from(merged.values());
}

// ============================================================
// 处理 Popup 报告请求
// ============================================================
async function handleGetReport(tabId, sendResponse) {
  const report = await StorageManager.getReport(tabId);

  // 如果报告不存在或超过 30 秒，请求重新扫描
  const isStale = !report || (Date.now() - report.timestamp > 30000);

  if (isStale) {
    // 向 content script 请求新报告
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'REQUEST_REPORT' });
      // 等待一小段时间让 content script 响应
      await sleep(500);
      const freshReport = await StorageManager.getReport(tabId);
      sendResponse({ type: 'REPORT_DATA', report: freshReport });
    } catch (e) {
      // Content script 可能未注入（chrome:// 页面等）
      sendResponse({ type: 'REPORT_DATA', report: report || null, error: 'Cannot communicate with page' });
    }
  } else {
    sendResponse({ type: 'REPORT_DATA', report: report });
  }
}

// ============================================================
// 处理选项请求
// ============================================================
async function handleGetOptions(sendResponse) {
  const options = await StorageManager.getOptions();
  sendResponse({ type: 'OPTIONS_DATA', options: options });
}

// ============================================================
// 清理标签页数据
// ============================================================
function clearTabData(tabId) {
  tabNetworkRequests.delete(tabId);
  StorageManager.removeReport(tabId);
}

// ============================================================
// 标签页关闭时清理
// ============================================================
chrome.tabs.onRemoved.addListener((tabId) => {
  clearTabData(tabId);
});

// ============================================================
// 标签页更新（导航到新页面）时清理旧报告
// ============================================================
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url || changeInfo.status === 'loading') {
    // 页面开始加载时清理旧数据
    tabNetworkRequests.delete(tabId);
  }
});

// ============================================================
// 工具函数
// ============================================================
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================
// 广告拦截模块
// ============================================================

let adBlockStats = {
  todayTotal: 0,
  todayDate: new Date().toDateString(),
  perDomain: {}
};

let cachedCssSelectors = null;
let adBlockerEnabled = true;

async function initAdBlocker() {
  const result = await chrome.storage.sync.get(['adBlockerEnabled']);
  adBlockerEnabled = result.adBlockerEnabled !== false;

  await AdRulesEngine.init();

  const statsResult = await chrome.storage.local.get(['adBlockStats']);
  if (statsResult.adBlockStats) {
    adBlockStats = statsResult.adBlockStats;
    if (adBlockStats.todayDate !== new Date().toDateString()) {
      adBlockStats.todayTotal = 0;
      adBlockStats.todayDate = new Date().toDateString();
    }
  }
  console.log('[广告拦截] 初始化完成, 状态:', adBlockerEnabled ? '开启' : '关闭');
}

async function loadCssSelectors() {
  if (cachedCssSelectors) return cachedCssSelectors;

  try {
    const url = chrome.runtime.getURL('lib/easylist-css-selectors.json');
    const response = await fetch(url);
    cachedCssSelectors = await response.json();
  } catch (e) {
    try {
      const url = chrome.runtime.getURL('lib/easylist-css-selectors-seed.json');
      const response = await fetch(url);
      cachedCssSelectors = await response.json();
    } catch (e2) {
      cachedCssSelectors = [];
    }
  }

  const customRules = await AdRulesEngine.getCosmeticRules();
  for (const rule of customRules) {
    cachedCssSelectors.push({ selector: rule.selector, domains: [] });
  }

  return cachedCssSelectors;
}

async function handleAdBlockerStatus(domain, sendResponse) {
  const whitelisted = await AdRulesEngine.isWhitelisted(domain);
  const cssSelectors = whitelisted ? [] : await loadCssSelectors();
  sendResponse({
    enabled: adBlockerEnabled,
    whitelisted: whitelisted,
    cssSelectors: cssSelectors
  });
}

async function handleAdBlockerStats(data, sendResponse) {
  if (!adBlockStats.perDomain[data.domain]) {
    adBlockStats.perDomain[data.domain] = { blocked: 0, hidden: 0 };
  }
  adBlockStats.perDomain[data.domain].hidden = data.hiddenElements;
  adBlockStats.todayTotal++;
  chrome.storage.local.set({ adBlockStats: adBlockStats }).catch(() => {});
  sendResponse({ received: true });
}

async function handleAdToggle(enabled, sendResponse) {
  adBlockerEnabled = enabled;
  await chrome.storage.sync.set({ adBlockerEnabled: enabled });
  sendResponse({ success: true });
}

async function handleAdAddRule(rule, sendResponse) {
  const result = await AdRulesEngine.addRule(rule);
  // 清除 CSS 缓存以重新加载自定义规则
  cachedCssSelectors = null;
  sendResponse(result);
}

async function handleAdRemoveRule(ruleId, type, sendResponse) {
  const result = await AdRulesEngine.removeRule(ruleId, type);
  cachedCssSelectors = null;
  sendResponse(result);
}

async function handleAdGetRules(sendResponse) {
  const rules = await AdRulesEngine.getDynamicRules();
  const whitelist = await AdRulesEngine.getWhitelist();
  const stats = {
    enabled: adBlockerEnabled,
    todayTotal: adBlockStats.todayTotal,
    dnrRuleCount: rules.network.length,
    cosmeticRuleCount: rules.cosmetic.length
  };
  sendResponse({ rules, whitelist, stats });
}

async function handleAdWhitelist(action, domain, sendResponse) {
  if (action === 'add') {
    const list = await AdRulesEngine.addToWhitelist(domain);
    sendResponse({ success: true, whitelist: list });
  } else if (action === 'remove') {
    const list = await AdRulesEngine.removeFromWhitelist(domain);
    sendResponse({ success: true, whitelist: list });
  }
}

// ============================================================
// 跨站点历史记录
// ============================================================

async function recordHistory(report) {
  try {
    const { history = [] } = await chrome.storage.local.get(['history']);

    history.push({
      domain: report.domain,
      score: report.overallScore,
      timestamp: report.timestamp,
      thirdPartyCount: (report.thirdPartyDomains || []).length,
      trackerCount: (report.thirdPartyDomains || []).filter(d => d.knownTracker).length,
      cookieCount: (report.cookies || []).length,
      cookieTrackingCount: (report.cookies || []).filter(c => c.category === 'tracking').length
    });

    const cutoff = Date.now() - 7 * 24 * 3600 * 1000;
    const trimmed = history.filter(h => h.timestamp > cutoff);
    if (trimmed.length > 500) trimmed.splice(0, trimmed.length - 500);
    await chrome.storage.local.set({ history: trimmed });

    await updateTrackerFrequency(report.thirdPartyDomains || []);
  } catch (e) {
    console.error('[隐私护盾] 记录历史失败:', e);
  }
}

async function updateTrackerFrequency(domains) {
  try {
    const { trackerFrequency = {} } = await chrome.storage.local.get(['trackerFrequency']);

    for (const d of domains) {
      if (!d.knownTracker) continue;
      const key = d.domain;
      if (!trackerFrequency[key]) {
        trackerFrequency[key] = { count: 0, category: d.knownTracker.category || '追踪' };
      }
      trackerFrequency[key].count++;
    }

    const { trackerLastReset } = await chrome.storage.local.get(['trackerLastReset']);
    const now = Date.now();
    if (!trackerLastReset || (now - trackerLastReset) > 24 * 3600 * 1000) {
      for (const key of Object.keys(trackerFrequency)) {
        trackerFrequency[key].count = Math.floor(trackerFrequency[key].count * 0.7);
        if (trackerFrequency[key].count <= 0) delete trackerFrequency[key];
      }
      await chrome.storage.local.set({ trackerLastReset: now });
    }

    await chrome.storage.local.set({ trackerFrequency });
  } catch (e) {
    console.error('[隐私护盾] 更新追踪器频次失败:', e);
  }
}

// ============================================================
// 链接清理统计
// ============================================================

async function handleCleanLinkStats(data, sendResponse) {
  try {
    const { linkCleanStats } = await chrome.storage.local.get(['linkCleanStats']);
    const today = new Date().toDateString();

    const stats = linkCleanStats && linkCleanStats.todayDate === today
      ? linkCleanStats
      : { todayDate: today, todayCleaned: 0, totalCleaned: (linkCleanStats?.totalCleaned || 0) };

    stats.todayCleaned++;
    stats.totalCleaned = (stats.totalCleaned || 0) + 1;

    await chrome.storage.local.set({ linkCleanStats: stats });
  } catch (e) {
    console.error('[链接清理] 统计保存失败:', e);
  }
  sendResponse({ received: true });
}

// 启动广告拦截
initAdBlocker();
