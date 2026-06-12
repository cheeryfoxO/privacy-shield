/**
 * 第三方域名检测器
 * 使用双重策略：DOM 遍历 + Performance API
 */

(function() {
  'use strict';

  // 存储检测结果
  window.__PRIVACY_THIRD_PARTY_DOMAINS = null;

  /**
   * 从完整 URL 中提取 hostname
   */
  function extractHostname(urlString) {
    if (!urlString) return null;
    try {
      return new URL(urlString, window.location.origin).hostname;
    } catch (e) {
      return null;
    }
  }

  /**
   * DOM 遍历 — 收集所有资源元素的域名
   */
  function collectDomResources() {
    const firstPartyDomain = window.extractDomain
      ? window.extractDomain(window.location.hostname)
      : extractDomainSimple(window.location.hostname);

    const resourceMap = new Map(); // domain -> { resourceTypes: Set, urls: [] }

    /**
     * 记录资源
     */
    function recordResource(urlString, type) {
      if (!urlString) return;
      const hostname = extractHostname(urlString);
      if (!hostname || hostname === window.location.hostname) return;

      // 跳过 data: blob: javascript: 等非 HTTP URL
      if (urlString.startsWith('data:') || urlString.startsWith('blob:') ||
          urlString.startsWith('javascript:') || urlString.startsWith('about:')) {
        return;
      }

      if (!resourceMap.has(hostname)) {
        resourceMap.set(hostname, {
          resourceTypes: new Set(),
          urls: [],
          urlCount: 0
        });
      }

      const entry = resourceMap.get(hostname);
      if (entry.urls.length < 10) {
        entry.urls.push(urlString);
      }
      entry.resourceTypes.add(type);
      entry.urlCount++;
    }

    // 1. <script src="">
    document.querySelectorAll('script[src]').forEach(el => {
      recordResource(el.src, 'script');
    });

    // 2. <link> 元素（样式、图标等）
    document.querySelectorAll('link[href]').forEach(el => {
      const rel = (el.rel || '').toLowerCase();
      const type = rel === 'stylesheet' ? 'css' :
                   rel.includes('icon') ? 'icon' :
                   rel === 'dns-prefetch' ? 'dns-prefetch' :
                   rel === 'preconnect' ? 'preconnect' :
                   rel === 'preload' ? 'preload' : 'link';
      recordResource(el.href, type);
    });

    // 3. <img src="">
    document.querySelectorAll('img[src]').forEach(el => {
      recordResource(el.src, 'img');
    });

    // 4. <iframe src="">
    document.querySelectorAll('iframe[src]').forEach(el => {
      recordResource(el.src, 'iframe');
    });

    // 5. <video>, <audio>, <source>
    document.querySelectorAll('video[src], audio[src]').forEach(el => {
      recordResource(el.src || el.currentSrc, 'media');
    });
    document.querySelectorAll('source[src]').forEach(el => {
      recordResource(el.src, 'media');
    });

    // 6. <object data="">, <embed src="">
    document.querySelectorAll('object[data]').forEach(el => {
      recordResource(el.getAttribute('data'), 'plugin');
    });
    document.querySelectorAll('embed[src]').forEach(el => {
      recordResource(el.src, 'plugin');
    });

    // 7. <a href=""> 跨域链接
    document.querySelectorAll('a[href]').forEach(el => {
      const href = el.href;
      if (href && !href.startsWith('#') && !href.startsWith('javascript:') &&
          !href.startsWith('mailto:') && !href.startsWith('tel:')) {
        recordResource(href, 'link');
      }
    });

    // 8. <form action=""> 跨域表单
    document.querySelectorAll('form[action]').forEach(el => {
      const action = el.getAttribute('action');
      if (action) {
        try {
          const fullUrl = new URL(action, window.location.origin);
          recordResource(fullUrl.href, 'form');
        } catch (e) {}
      }
    });

    // 转换为报告格式
    return convertMapToReport(resourceMap);
  }

  /**
   * Performance API — 收集所有已加载资源
   */
  function collectPerformanceResources() {
    const firstPartyHostname = window.location.hostname;
    const resourceMap = new Map();

    try {
      const entries = performance.getEntriesByType('resource');

      for (const entry of entries) {
        let hostname;
        try {
          hostname = new URL(entry.name).hostname;
        } catch (e) {
          continue;
        }

        if (hostname === firstPartyHostname) continue;
        if (entry.name.startsWith('data:') || entry.name.startsWith('blob:')) continue;

        if (!resourceMap.has(hostname)) {
          resourceMap.set(hostname, {
            resourceTypes: new Set(),
            urls: [],
            urlCount: 0,
            totalTransferSize: 0
          });
        }

        const record = resourceMap.get(hostname);
        record.resourceTypes.add(entry.initiatorType);
        if (record.urls.length < 10) {
          record.urls.push(entry.name);
        }
        record.urlCount++;
        record.totalTransferSize += entry.transferSize || 0;
      }
    } catch (e) {
      // Performance API 不可用时静默失败
    }

    return convertMapToReport(resourceMap);
  }

  /**
   * 将 Map 结构转换为报告数组
   */
  function convertMapToReport(resourceMap) {
    const result = [];
    for (const [domain, entry] of resourceMap) {
      result.push({
        domain: domain,
        resourceTypes: Array.from(entry.resourceTypes),
        urls: entry.urls.slice(0, 10),
        urlCount: entry.urlCount || entry.urls.length,
        totalTransferSize: entry.totalTransferSize || 0
      });
    }
    return result;
  }

  /**
   * 简单域名提取（后备方案）
   */
  function extractDomainSimple(hostname) {
    if (!hostname) return '';
    const parts = hostname.replace(/^\.+/, '').split('.');
    if (parts.length <= 2) return hostname;
    // 简单取最后两级
    return parts.slice(-2).join('.');
  }

  /**
   * 合并两种检测结果
   */
  function mergeResults(domResults, perfResults) {
    const merged = new Map();

    // 先加入 DOM 结果
    for (const item of domResults) {
      merged.set(item.domain, { ...item, sources: ['DOM'] });
    }

    // 合并 Performance API 结果
    for (const item of perfResults) {
      if (merged.has(item.domain)) {
        const existing = merged.get(item.domain);
        existing.resourceTypes = [...new Set([...existing.resourceTypes, ...item.resourceTypes])];
        existing.urls = [...new Set([...existing.urls, ...item.urls])].slice(0, 10);
        existing.urlCount = Math.max(existing.urlCount, item.urlCount);
        existing.totalTransferSize = (existing.totalTransferSize || 0) + (item.totalTransferSize || 0);
        if (!existing.sources.includes('PerformanceAPI')) {
          existing.sources.push('PerformanceAPI');
        }
      } else {
        merged.set(item.domain, { ...item, sources: ['PerformanceAPI'] });
      }
    }

    return Array.from(merged.values());
  }

  /**
   * 执行完整的第三方域名扫描
   */
  function scanThirdPartyDomains() {
    const domResults = collectDomResources();
    const perfResults = collectPerformanceResources();
    const merged = mergeResults(domResults, perfResults);

    // 过滤掉第一方域名
    const firstPartyDomain = window.extractDomain
      ? window.extractDomain(window.location.hostname)
      : extractDomainSimple(window.location.hostname);

    const thirdPartyResults = merged.filter(item => {
      const itemDomain = window.extractDomain
        ? window.extractDomain(item.domain)
        : extractDomainSimple(item.domain);
      return itemDomain !== firstPartyDomain &&
             !itemDomain.endsWith('.' + firstPartyDomain) &&
             !firstPartyDomain.endsWith('.' + itemDomain);
    });

    // 标记已知追踪域名
    if (typeof lookupKnownTracker === 'function') {
      for (const item of thirdPartyResults) {
        const tracker = lookupKnownTracker(item.domain);
        if (tracker) {
          item.knownTracker = tracker;
        }
      }
    }

    window.__PRIVACY_THIRD_PARTY_DOMAINS = thirdPartyResults;
    return thirdPartyResults;
  }

  // 在页面加载完成后执行扫描
  if (document.readyState === 'complete') {
    setTimeout(scanThirdPartyDomains, 100);
  } else {
    window.addEventListener('load', () => {
      setTimeout(scanThirdPartyDomains, 100);
    });
  }

  // 同时设置 PerformanceObserver 以捕获动态加载的资源
  if (window.PerformanceObserver) {
    try {
      const observer = new PerformanceObserver((list) => {
        // 动态资源会被下一轮 getEntriesByType 捕获
        // 此 observer 主要用于维持观察
      });
      observer.observe({ type: 'resource', buffered: true });
    } catch (e) {}
  }
})();
