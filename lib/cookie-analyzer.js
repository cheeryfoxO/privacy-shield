/**
 * Cookie 分析器
 * 分类 Cookie：会话/持久/追踪/第一方/第三方
 */

/**
 * 追踪 Cookie 名称模式
 * 匹配已知追踪/分析服务设置的 Cookie
 */
const TRACKING_COOKIE_PATTERNS = [
  // Google Analytics
  /^_ga$/,
  /^_gid$/,
  /^_gat/,
  /^_gac_/,
  /^_gaexp/,
  /^_ga_/,
  /^_gcl_/,
  /^_gcl_aw/,
  /^_gcl_dc/,

  // Google Analytics Legacy (Urchin)
  /^__utma$/,
  /^__utmb$/,
  /^__utmc$/,
  /^__utmz$/,
  /^__utmt/,
  /^__utmv$/,

  // Facebook
  /^_fbp$/,
  /^fbc$/,
  /^fbclid$/,

  // Hotjar
  /^_hj/,
  /^_hjid$/,
  /^_hjTLDTest$/,

  // Microsoft / Bing
  /^_uet/,
  /^_uetsid/,
  /^MUID$/,

  // Matomo (formerly Piwik)
  /^_pk_/,

  // Optimizely
  /^optimizely/,

  // Mixpanel
  /^mp_/,

  // Intercom
  /^intercom-/,

  // HubSpot
  /^hubspotutk$/,
  /^__hstc$/,
  /^__hssrc$/,
  /^__hssc$/,

  // Cloudflare
  /^__cf/,

  // Stripe
  /^__stripe/,

  // Segment
  /^ajs_/,

  // Reddit
  /^_rdt/,

  // TikTok
  /^_ttp$/,

  // LogRocket
  /^_lr_/,

  // Amplitude
  /^amplitude_/,

  // Adalyser
  /^__adal/,

  // Snapchat
  /^_scid$/,

  // LinkedIn
  /^li_sugr$/,
  /^bcookie$/,
  /^bscookie$/,
  /^lidc$/,

  // Twitter
  /^personalization_id$/,

  // Pinterest
  /^_pinterest/,

  // Criteo
  /^cto_/,

  // Outbrain
  /^obuid$/,

  // Quantserve
  /^_qca$/,

  // Webtrends
  /^WT_FPC$/,

  // Schema
  /^_an_/,

  // 其他追踪模式
  /^_anon_id$/,
  /^_tld$/,
  /^__distillery$/,
  /^_sp_/,
  /^_trs$/,
];

/**
 * 已知追踪域名集合（来自 known-trackers.js）
 */
function getTrackerDomains() {
  if (typeof KNOWN_TRACKER_DOMAINS !== 'undefined') {
    return KNOWN_TRACKER_DOMAINS;
  }
  return new Set();
}

/**
 * 分析单个 Cookie
 * @param {Object} cookie - Chrome Cookie API 返回的对象
 * @param {string} firstPartyDomain - 当前页面的注册域名
 * @returns {Object} 分析结果
 */
function analyzeCookie(cookie, firstPartyDomain) {
  const cookieDomain = (cookie.domain || '').replace(/^\./, '');
  const isThirdParty = determineThirdParty(cookieDomain, firstPartyDomain);
  const isSession = cookie.session || !cookie.expirationDate;
  const isPersistent = !isSession && !!cookie.expirationDate;
  const isSecure = !!cookie.secure;
  const isHttpOnly = !!cookie.httpOnly;

  // 计算过期天数
  let expirationDays = null;
  if (isPersistent && cookie.expirationDate) {
    expirationDays = Math.round(
      (cookie.expirationDate * 1000 - Date.now()) / 86400000
    );
  }

  // 分类
  const category = classifyCookie(cookie, {
    isThirdParty,
    isSession,
    isPersistent,
    expirationDays,
    cookieDomain
  });

  return {
    name: cookie.name,
    domain: cookie.domain,
    path: cookie.path || '/',
    value: '[已隐藏]', // 永不暴露 Cookie 值
    isThirdParty,
    isSession,
    isPersistent,
    isSecure,
    isHttpOnly,
    sameSite: cookie.sameSite || 'unspecified',
    expirationDays,
    category
  };
}

/**
 * 判定是否为第三方 Cookie
 */
function determineThirdParty(cookieDomain, firstPartyDomain) {
  if (!cookieDomain || !firstPartyDomain) return true;

  cookieDomain = cookieDomain.replace(/^\./, '').toLowerCase();
  firstPartyDomain = firstPartyDomain.toLowerCase();

  // 完全匹配
  if (cookieDomain === firstPartyDomain) return false;

  // cookie domain 是第一方域名的子域名
  if (cookieDomain.endsWith('.' + firstPartyDomain)) return false;

  // 第一方域名是 cookie domain 的子域名
  if (firstPartyDomain.endsWith('.' + cookieDomain)) return false;

  return true;
}

/**
 * 分类 Cookie
 */
function classifyCookie(cookie, meta) {
  // 1. 名称模式匹配
  for (const pattern of TRACKING_COOKIE_PATTERNS) {
    if (pattern.test(cookie.name)) {
      return 'tracking';
    }
  }

  // 2. 域名匹配已知追踪域名
  const trackerDomains = getTrackerDomains();
  const domainToCheck = meta.cookieDomain.replace(/^\./, '').toLowerCase();
  if (trackerDomains.has(domainToCheck)) {
    return 'tracking';
  }

  // 检查父域名
  const parts = domainToCheck.split('.');
  for (let i = 1; i < parts.length; i++) {
    const parentDomain = parts.slice(i).join('.');
    if (trackerDomains.has(parentDomain)) {
      return 'tracking';
    }
  }

  // 3. 启发式检测
  // 第三方 + 持久性 + 超长过期
  if (meta.isThirdParty && meta.isPersistent && meta.expirationDays > 180) {
    return 'potential-tracking';
  }

  // 第三方 + 随机长名称
  if (meta.isThirdParty && cookie.name.length > 25) {
    return 'potential-tracking';
  }

  // 4. 基本分类
  if (meta.isSession) return 'session';
  if (meta.isPersistent) return 'persistent';

  return 'unknown';
}

/**
 * 汇总 Cookie 分析结果
 */
function summarizeCookies(cookies) {
  const summary = {
    total: cookies.length,
    firstParty: 0,
    thirdParty: 0,
    tracking: 0,
    potentialTracking: 0,
    session: 0,
    persistent: 0,
    secure: 0,
    httpOnly: 0
  };

  for (const cookie of cookies) {
    if (cookie.isThirdParty) summary.thirdParty++;
    else summary.firstParty++;

    if (cookie.category === 'tracking') summary.tracking++;
    if (cookie.category === 'potential-tracking') summary.potentialTracking++;

    if (cookie.isSession) summary.session++;
    if (cookie.isPersistent) summary.persistent++;

    if (cookie.isSecure) summary.secure++;
    if (cookie.isHttpOnly) summary.httpOnly++;
  }

  return summary;
}

// 在 content script 和 service worker 上下文均可使用
if (typeof window !== 'undefined') {
  window.analyzeCookie = analyzeCookie;
  window.summarizeCookies = summarizeCookies;
}
