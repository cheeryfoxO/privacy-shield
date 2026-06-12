/**
 * 隐私评分算法
 * 加权扣分模型：从 100 分开始，按四个维度扣分
 * 每维度有上限，保证评分平衡
 */

/**
 * 计算综合隐私评分
 * @param {Object} report - 完整隐私报告
 * @returns {Object} { overallScore, breakdown, tier }
 */
function calculatePrivacyScore(report) {
  const weights = {
    thirdPartyDomains: 35,
    cookies: 30,
    canvasFingerprinting: 25,
    webrtcLeaks: 10
  };

  // 各项扣分
  const tpdScore = scoreThirdPartyDomains(report.thirdPartyDomains || []);
  const cookieScore = scoreCookies(report.cookies || []);
  const canvasScore = scoreCanvasFingerprinting(report.canvasFingerprinting || { detected: false, events: [] });
  const webrtcScore = scoreWebRtcLeaks(report.webrtcLeaks || { detected: false, events: [] });

  // 应用权重上限
  const breakdown = {
    thirdPartyDomains: {
      raw: tpdScore,
      weighted: Math.min(tpdScore, weights.thirdPartyDomains),
      max: weights.thirdPartyDomains
    },
    cookies: {
      raw: cookieScore,
      weighted: Math.min(cookieScore, weights.cookies),
      max: weights.cookies
    },
    canvasFingerprinting: {
      raw: canvasScore,
      weighted: Math.min(canvasScore, weights.canvasFingerprinting),
      max: weights.canvasFingerprinting
    },
    webrtcLeaks: {
      raw: webrtcScore,
      weighted: Math.min(webrtcScore, weights.webrtcLeaks),
      max: weights.webrtcLeaks
    }
  };

  // 计算总分
  const totalDeduction = Object.values(breakdown).reduce(
    (sum, item) => sum + item.weighted, 0
  );

  const overallScore = Math.max(0, Math.min(100, 100 - totalDeduction));

  return {
    overallScore: Math.round(overallScore),
    breakdown,
    tier: getScoreTier(overallScore)
  };
}

/**
 * 评分第三方域名（权重：35分）
 */
function scoreThirdPartyDomains(domains) {
  if (!domains || domains.length === 0) return 0;

  let score = 0;
  let numUniqueDomains = 0;
  let trackingDomains = 0;
  let thirdPartyScripts = 0;
  let thirdPartyIframes = 0;

  for (const item of domains) {
    numUniqueDomains++;

    // 检查是否为已知追踪域名
    if (typeof lookupKnownTracker === 'function') {
      const tracker = lookupKnownTracker(item.domain);
      if (tracker) trackingDomains++;
    }

    // 检查资源类型
    const types = item.resourceTypes || [];
    if (types.includes('script') || types.includes('xmlhttprequest')) {
      thirdPartyScripts++;
    }
    if (types.includes('iframe') || types.includes('sub_frame')) {
      thirdPartyIframes++;
    }
  }

  // 基础扣分：每个第三方域名 3 分
  score += Math.min(numUniqueDomains * 3, 30);

  // 已知追踪器加分
  score += Math.min(trackingDomains * 5, 20);

  // 第三方脚本额外扣分
  score += Math.min(thirdPartyScripts * 2, 10);

  // 第三方 iframe 额外扣分
  score += Math.min(thirdPartyIframes * 4, 10);

  return score;
}

/**
 * 评分 Cookie（权重：30分）
 */
function scoreCookies(cookies) {
  if (!cookies || cookies.length === 0) return 0;

  let score = 0;
  let thirdPartyCount = 0;
  let trackingCount = 0;
  let persistentThirdPartyCount = 0;
  let sessionThirdPartyCount = 0;

  for (const cookie of cookies) {
    if (cookie.isThirdParty) {
      thirdPartyCount++;

      if (cookie.category === 'tracking') {
        trackingCount++;
      }
      if (cookie.isPersistent) {
        persistentThirdPartyCount++;
      }
      if (cookie.isSession) {
        sessionThirdPartyCount++;
      }
    }
  }

  // 每个第三方 Cookie 扣 4 分
  score += Math.min(thirdPartyCount * 4, 24);

  // 追踪类 Cookie 额外扣分
  score += Math.min(trackingCount * 5, 20);

  // 持久性第三方 Cookie 额外扣分
  score += Math.min(persistentThirdPartyCount * 3, 12);

  // 会话第三方 Cookie
  score += Math.min(sessionThirdPartyCount * 2, 10);

  return score;
}

/**
 * 评分 Canvas 指纹（权重：25分）
 */
function scoreCanvasFingerprinting(canvasData) {
  if (!canvasData || !canvasData.events || canvasData.events.length === 0) {
    return 0;
  }

  let score = 0;

  for (const event of canvasData.events) {
    if (event.method === 'toDataURL' || event.method === 'toBlob') {
      // 基于 Canvas 大小
      if (event.canvasArea < 256) {
        score += 15;  // 小于 16x16
      } else if (event.canvasArea < 10000) {
        score += 8;   // 小于 100x100
      } else {
        score += 3;
      }

      // 未添加到 DOM
      if (event.addedToDOM === false) {
        score += 10;
      }

      // 使用了异形文字
      if (event.usedExoticText) {
        score += 8;
      }

      // 多种字体
      if (event.fontsUsed && event.fontsUsed.length > 1) {
        score += 5;
      }
    }

    if (event.method === 'getImageData') {
      if (event.canvasArea < 10000) {
        score += 10;
      }
    }
  }

  return score;
}

/**
 * 评分 WebRTC 泄漏（权重：10分）
 */
function scoreWebRtcLeaks(webrtcData) {
  if (!webrtcData || !webrtcData.events || webrtcData.events.length === 0) {
    return 0;
  }

  let score = 0;

  for (const event of webrtcData.events) {
    if (event.candidateType === 'srflx') {
      score += 5;  // 公网 IP 泄漏（可能绕过 VPN）
    } else if (event.candidateType === 'host') {
      if (event.ipClassification === 'host-private') {
        score += 8;  // 私有 IP 泄漏
      } else if (event.ipClassification === 'host-public') {
        score += 6;  // 非回环 host candidate
      }
      // 链路本地和回环不计分
    }
  }

  return score;
}

/**
 * 获取评分等级
 */
function getScoreTier(score) {
  if (score >= 90) return 'excellent';
  if (score >= 70) return 'good';
  if (score >= 50) return 'fair';
  if (score >= 30) return 'poor';
  return 'critical';
}

/**
 * 获取评分对应的颜色
 */
function getScoreColor(score) {
  if (score >= 90) return '#22c55e';  // green
  if (score >= 70) return '#84cc16';  // light green
  if (score >= 50) return '#eab308';  // yellow
  if (score >= 30) return '#f97316';  // orange
  return '#ef4444';                    // red
}

/**
 * 获取评分对应的背景颜色（浅色）
 */
function getScoreBgColor(score) {
  if (score >= 90) return '#f0fdf4';
  if (score >= 70) return '#f7fee7';
  if (score >= 50) return '#fefce8';
  if (score >= 30) return '#fff7ed';
  return '#fef2f2';
}

// 在 content script 和 service worker 上下文均可使用
if (typeof window !== 'undefined') {
  window.calculatePrivacyScore = calculatePrivacyScore;
  window.getScoreColor = getScoreColor;
  window.getScoreBgColor = getScoreBgColor;
  window.getScoreTier = getScoreTier;
}
