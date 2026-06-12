/**
 * 广告元素隐藏器
 * 注入 CSS 隐藏广告元素，MutationObserver 监听动态插入
 */
(function() {
  'use strict';

  const STYLE_ID = 'privacy-shield-ad-blocker';
  let hiddenCount = 0;
  let enabled = true;

  async function initAdBlocker() {
    try {
      const domain = window.location.hostname;
      const response = await chrome.runtime.sendMessage({
        type: 'AD_BLOCKER_STATUS', domain: domain
      });

      if (!response || !response.enabled || response.whitelisted) {
        enabled = false;
        return;
      }

      const selectors = response.cssSelectors || [];
      if (selectors.length > 0) {
        injectCSS(selectors);
        startObserver(selectors);
      }
    } catch (e) {
      setTimeout(initAdBlocker, 500);
    }
  }

  function injectCSS(selectors) {
    const existing = document.getElementById(STYLE_ID);
    if (existing) existing.remove();

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = selectors
      .map(s => `${s.selector}{display:none!important;visibility:hidden!important;height:0!important;overflow:hidden!important;}`)
      .join('\n');
    (document.head || document.documentElement).appendChild(style);

    for (const s of selectors) {
      try {
        hiddenCount += document.querySelectorAll(s.selector).length;
      } catch (e) {}
    }
    reportStats();
  }

  function startObserver(selectors) {
    let pending = false;
    const observer = new MutationObserver(() => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        scanNewElements(selectors);
      });
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function scanNewElements(selectors) {
    let newHidden = 0;
    for (const s of selectors) {
      try {
        for (const el of document.querySelectorAll(s.selector)) {
          if (el.__ad_hidden) continue;
          el.style.display = 'none';
          el.style.visibility = 'hidden';
          el.__ad_hidden = true;
          newHidden++;
        }
      } catch (e) {}
    }
    if (newHidden > 0) {
      hiddenCount += newHidden;
      reportStats();
    }
  }

  function reportStats() {
    chrome.runtime.sendMessage({
      type: 'AD_BLOCKER_STATS',
      data: { domain: window.location.hostname, hiddenElements: hiddenCount, timestamp: Date.now() }
    }).catch(() => {});
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAdBlocker);
  } else {
    initAdBlocker();
  }

  window.__AD_BLOCKER_ENABLED = () => enabled;
  window.__AD_BLOCKER_HIDDEN_COUNT = () => hiddenCount;
})();
