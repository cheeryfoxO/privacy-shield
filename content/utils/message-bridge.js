/**
 * Content Script 与 Background 通信桥接
 * 处理消息发送、重试、队列
 */

(function() {
  'use strict';

  const MessageBridge = {
    /**
     * 向 Background 发送消息
     * 带重试机制
     */
    async sendMessage(type, data) {
      try {
        const response = await chrome.runtime.sendMessage({
          type: type,
          data: data
        });
        return response;
      } catch (e) {
        // Service Worker 可能已终止，重试一次
        console.warn('[隐私护盾] 消息发送失败，重试中...', e);
        try {
          await sleep(200);
          const response = await chrome.runtime.sendMessage({
            type: type,
            data: data
          });
          return response;
        } catch (retryError) {
          console.error('[隐私护盾] 消息重试失败:', retryError);
          return { error: retryError.message };
        }
      }
    },

    /**
     * 发送隐私报告
     */
    async sendPrivacyReport(report) {
      return this.sendMessage('PRIVACY_REPORT', report);
    },

    /**
     * 请求最新报告
     */
    async requestReport() {
      try {
        const response = await chrome.runtime.sendMessage({
          type: 'GET_REPORT',
          tabId: null // Background 会从 sender.tab.id 获取
        });
        return response;
      } catch (e) {
        console.error('[隐私护盾] 请求报告失败:', e);
        return null;
      }
    }
  };

  /**
   * 收集 Content Script 所有检测结果并发送
   */
  async function collectAndSendReport() {
    // 等待短暂延迟确保所有检测器都运行完成
    await sleep(500);

    const report = {
      tabId: null, // Background 从 sender.tab.id 获取
      url: window.location.href,
      timestamp: Date.now(),
      domain: window.extractDomain
        ? window.extractDomain(window.location.hostname)
        : window.location.hostname
    };

    // 收集第三方域名
    if (window.__PRIVACY_THIRD_PARTY_DOMAINS) {
      report.thirdPartyDomains = window.__PRIVACY_THIRD_PARTY_DOMAINS;
    } else {
      // 如果还没扫描，手动触发
      if (typeof scanThirdPartyDomains === 'function') {
        report.thirdPartyDomains = scanThirdPartyDomains();
      } else {
        report.thirdPartyDomains = [];
      }
    }

    // 收集 Canvas 指纹事件
    if (window.__PRIVACY_GET_CANVAS_REPORT) {
      report.canvasFingerprinting = window.__PRIVACY_GET_CANVAS_REPORT();
    } else {
      report.canvasFingerprinting = { detected: false, events: [] };
    }

    // 收集 WebRTC 泄漏事件
    if (window.__PRIVACY_GET_WEBRTC_REPORT) {
      report.webrtcLeaks = window.__PRIVACY_GET_WEBRTC_REPORT();
    } else {
      report.webrtcLeaks = { detected: false, events: [] };
    }

    // 发送到 Background
    return MessageBridge.sendPrivacyReport(report);
  }

  /**
   * 处理来自 Background 的消息
   */
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'REQUEST_REPORT') {
      collectAndSendReport().then(result => {
        sendResponse({ received: true, result });
      }).catch(err => {
        sendResponse({ error: err.message });
      });
      return true; // 异步响应
    }
  });

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // 导出
  window.MessageBridge = MessageBridge;
})();
