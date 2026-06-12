/**
 * 已知追踪域名库
 * 包含 ~200 个常见追踪/广告/分析/指纹域名
 * 分为四大类：分析、广告、社交 Pixel、指纹
 */

const KNOWN_TRACKER_DOMAINS = new Set([
  // ========== 分析类 (Analytics) ==========
  'google-analytics.com',
  'googletagmanager.com',
  'googletagservices.com',
  'hotjar.com',
  'hotjar.io',
  'matomo.cloud',
  'matomo.org',
  'amplitude.com',
  'mixpanel.com',
  'heap.io',
  'heapanalytics.com',
  'segment.io',
  'segment.com',
  'fullstory.com',
  'logrocket.com',
  'mouseflow.com',
  'crazyegg.com',
  'optimizely.com',
  'vwo.com',
  'chartbeat.com',
  'chartbeat.net',
  'parsely.com',
  'scorecardresearch.com',
  'comscore.com',
  'statcounter.com',
  'clicky.com',
  'quantcast.com',
  'quantcount.com',
  'baidu.com',               // 百度统计
  'hm.baidu.com',
  'tongji.baidu.com',
  'cnzz.com',                 // 友盟/CNZZ
  'umeng.com',
  '51.la',
  'sensorsdata.cn',           // 神策数据
  'zhugeio.com',              // 诸葛IO
  'growingio.com',            // GrowingIO
  'pstatp.com',               // 字节跳动/火山引擎
  'bytecdn.cn',
  'bytedance.com',
  'alibaba.com',              // 阿里
  'tanx.com',

  // ========== 广告类 (Advertising) ==========
  'doubleclick.net',
  'doubleclick.com',
  'googlesyndication.com',
  'googleadservices.com',
  'adsense.com',
  'adservice.google.com',
  'criteo.com',
  'criteo.net',
  'outbrain.com',
  'taboola.com',
  'pubmatic.com',
  'openx.net',
  'rubiconproject.com',
  'appnexus.com',
  'adsrvr.org',
  'casalemedia.com',
  'moatads.com',
  'yieldmo.com',
  'adsafeprotected.com',
  'bluekai.com',
  'exelator.com',
  'demdex.net',
  'adnxs.com',
  'rlcdn.com',
  'tidaltv.com',
  'contextweb.com',
  'sovrn.com',
  'indexww.com',
  'sharethrough.com',
  'bidswitch.net',
  'dataxu.com',
  'turn.com',
  'advertising.com',
  'adzerk.net',
  'adroll.com',
  'cpx.to',
  'lijit.com',
  'monetate.net',
  'adsymptotic.com',
  'amazon-adsystem.com',
  'aaxads.com',
  'media.net',
  'quantserve.com',
  'addthis.com',
  'addthisedge.com',
  'zemanta.com',
  'revcontent.com',
  'mgid.com',
  'popads.net',
  'propellerads.com',
  'adcash.com',
  'exoclick.com',

  // ========== 社交 Pixel (Social Media) ==========
  'facebook.net',
  'facebook.com',
  'fbcdn.net',
  'atdmt.com',               // Facebook/Atlas
  'twitter.com',
  'twimg.com',
  'linkedin.com',
  'licdn.com',
  'snapchat.com',
  'sc-static.net',
  'tiktok.com',
  'tiktokcdn.com',
  'pinterest.com',
  'pinimg.com',
  'reddit.com',
  'redditstatic.com',
  'redditmedia.com',
  'weibo.com',               // 新浪微博
  'weibo.cn',
  'weixin.qq.com',           // 微信
  'mp.weixin.qq.com',
  'xiaohongshu.com',         // 小红书
  'xhscdn.com',
  'douyin.com',              // 抖音
  'kuaishou.com',            // 快手
  'bilibili.com',            // B站
  'zhihu.com',               // 知乎

  // ========== 指纹类 (Fingerprinting) ==========
  'fingerprintjs.com',
  'fingerprint.com',
  'clientjs.org',
  'evercookie.js',
  'canvasfingerprint.com',
  'browserleaks.com',
  'deviceatlas.com',
  'threatmetrix.com',
  'iovation.com',
  'maxmind.com',
  'ipinfo.io',
]);

/**
 * 根据域名查找是否为已知追踪域名
 * @returns {Object|null} { category, domain } 或 null
 */
function lookupKnownTracker(hostname) {
  if (!hostname) return null;

  hostname = hostname.replace(/^\.+/, '').toLowerCase();

  // 精确匹配
  if (KNOWN_TRACKER_DOMAINS.has(hostname)) {
    return {
      category: guessCategory(hostname),
      domain: hostname
    };
  }

  // 子域名匹配 (e.g., www.doubleclick.net -> doubleclick.net)
  const parts = hostname.split('.');
  for (let i = 1; i < parts.length; i++) {
    const parentDomain = parts.slice(i).join('.');
    if (KNOWN_TRACKER_DOMAINS.has(parentDomain)) {
      return {
        category: guessCategory(parentDomain),
        domain: parentDomain
      };
    }
  }

  return null;
}

/**
 * 根据域名猜测追踪类别
 */
function guessCategory(domain) {
  const analyticsDomains = [
    'analytics', 'analysis', 'stat', 'track', 'metrics', 'telemetry',
    'chartbeat', 'comscore', 'quantcast', 'hotjar', 'matomo',
    'amplitude', 'mixpanel', 'heap', 'segment', 'fullstory',
    'logrocket', 'mouseflow', 'crazyegg', 'optimizely', 'vwo',
    'parsely', 'tongji', 'cnzz', 'umeng', 'sensorsdata',
    'zhugeio', 'growingio', 'pstatp'
  ];
  const adDomains = [
    'ad', 'ads', 'advert', 'doubleclick', 'syndication', 'criteo',
    'outbrain', 'taboola', 'pubmatic', 'openx', 'appnexus',
    'adsrvr', 'casalemedia', 'moatads', 'yieldmo', 'bluekai',
    'exelator', 'demdex', 'adnxs', 'rlcdn', 'bidswitch',
    'adroll', 'adcash', 'mgid', 'revcontent', 'popads',
    'propellerads', 'exoclick', 'tanx'
  ];
  const socialDomains = [
    'facebook', 'fbcdn', 'twitter', 'twimg', 'linkedin', 'licdn',
    'snapchat', 'tiktok', 'pinterest', 'reddit', 'weibo',
    'weixin', 'xiaohongshu', 'douyin', 'kuaishou', 'bilibili',
    'zhihu'
  ];

  if (analyticsDomains.some(k => domain.includes(k))) return 'analytics';
  if (adDomains.some(k => domain.includes(k))) return 'advertising';
  if (socialDomains.some(k => domain.includes(k))) return 'social';
  return 'fingerprinting';
}

// 在 content script 和 service worker 上下文均可使用
if (typeof window !== 'undefined') {
  window.KNOWN_TRACKER_DOMAINS = KNOWN_TRACKER_DOMAINS;
  window.lookupKnownTracker = lookupKnownTracker;
}
