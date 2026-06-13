/**
 * 隐私护盾 - Popup 逻辑
 * 读取隐私报告，渲染分数仪表盘、分类详情
 */

document.addEventListener('DOMContentLoaded', init);

// ============================================================
// 全局状态
// ============================================================
let currentReport = null;
let isScanning = false;

// ============================================================
// 初始化
// ============================================================
async function init() {
  // 绑定按钮事件
  document.getElementById('btnRescan').addEventListener('click', rescan);
  document.getElementById('btnSettings').addEventListener('click', openSettings);

  // 获取当前标签页
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab || !tab.url ||
      tab.url.startsWith('chrome://') ||
      tab.url.startsWith('chrome-extension://') ||
      tab.url.startsWith('about:') ||
      tab.url.startsWith('devtools://')) {
    showUnsupportedPage();
    return;
  }

  // 先显示 UI 框架（Tab 立即可见）
  initTabs();
  renderReport(null); // 显示空状态，不显示加载遮罩

  // 并行加载所有数据，谁先回来谁先渲染
  loadReport(tab.id);           // 隐私评分
  initAdBlockPanel(tab.id);     // 广告拦截
  renderHistoryTab();           // 趋势
  renderFingerprintTab();       // 指纹
  renderLinkCleanerTab(tab);    // 链接清理
}

// ============================================================
// 加载报告
// ============================================================
async function loadReport(tabId) {
  try {
    // 直接从 storage 读取缓存报告（瞬间返回，无 SW 开销）
    const key = `report:${tabId}`;
    const result = await chrome.storage.local.get([key]);
    const cached = result[key];

    if (cached) {
      currentReport = cached;
      renderReport(currentReport);
    }

    // 后台触发刷新（content script 重新扫描）
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'REQUEST_REPORT' });
    } catch (e) {}

    // 等 1s 后读取更新后的报告
    setTimeout(async () => {
      const freshResult = await chrome.storage.local.get([key]);
      const fresh = freshResult[key];
      if (fresh && (!currentReport || fresh.timestamp > currentReport.timestamp)) {
        currentReport = fresh;
        renderReport(currentReport);
      }
    }, 1000);
  } catch (e) {
    console.error('[隐私护盾] 加载报告失败:', e);
  }
}

// ============================================================
// 渲染完整报告
// ============================================================
function renderReport(report) {
  if (!report) {
    // 无缓存数据时显示占位
    document.getElementById('scoreNumber').textContent = '--';
    document.getElementById('scoreLabel').textContent = '加载中';
    document.getElementById('summaryText').textContent = '正在获取隐私报告...';
    return;
  }

  // 渲染分数
  renderScore(report.overallScore, report.scoreBreakdown);

  // 渲染摘要
  renderSummary(report);

  // 渲染第三方域名
  renderThirdPartyDomains(report.thirdPartyDomains || [], report.scoreBreakdown);

  // 渲染 Cookie
  renderCookies(report.cookies || [], report.scoreBreakdown);

  // 渲染 Canvas 指纹
  renderCanvasFingerprinting(report.canvasFingerprinting || { detected: false, events: [] }, report.scoreBreakdown);

  // 渲染 WebRTC 泄漏
  renderWebRtcLeaks(report.webrtcLeaks || { detected: false, events: [] }, report.scoreBreakdown);
}

// ============================================================
// 渲染分数仪表盘
// ============================================================
function renderScore(score, breakdown) {
  const ring = document.getElementById('scoreRingProgress');
  const number = document.getElementById('scoreNumber');
  const label = document.getElementById('scoreLabel');

  if (score === null || score === undefined) {
    number.textContent = '--';
    label.textContent = '扫描中';
    ring.style.strokeDasharray = '0 377';
    return;
  }

  // 计算 SVG 圆环参数
  const radius = 60;
  const circumference = 2 * Math.PI * radius; // ≈ 377
  const offset = circumference - (score / 100) * circumference;

  // 设置颜色
  const color = getScoreColor(score);
  ring.style.strokeDasharray = `${circumference} ${circumference}`;
  ring.style.strokeDashoffset = offset;
  ring.style.stroke = color;
  number.style.fill = color;
  number.textContent = score;

  // 等级标签
  const tier = getScoreTier(score);
  const tierLabels = {
    excellent: '优秀 🟢',
    good: '良好 🟡',
    fair: '一般 🟠',
    poor: '较差 🔴',
    critical: '严重 ⚫'
  };
  label.textContent = tierLabels[tier] || '未知';
}

/**
 * 获取分数颜色
 */
function getScoreColor(score) {
  if (score >= 90) return '#22c55e';
  if (score >= 70) return '#84cc16';
  if (score >= 50) return '#eab308';
  if (score >= 30) return '#f97316';
  return '#ef4444';
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

// ============================================================
// 渲染摘要
// ============================================================
function renderSummary(report) {
  const summaryEl = document.getElementById('summaryText');
  const lines = [];

  const domains = report.thirdPartyDomains || [];
  const cookies = report.cookies || [];
  const canvas = report.canvasFingerprinting || { detected: false };
  const webrtc = report.webrtcLeaks || { detected: false };

  // 第三方域名
  if (domains.length > 0) {
    const trackerCount = domains.filter(d => d.knownTracker).length;
    if (trackerCount > 0) {
      lines.push(`🔍 ${domains.length} 个第三方域名（${trackerCount} 个已知追踪器）`);
    } else {
      lines.push(`🔍 ${domains.length} 个第三方域名`);
    }
  } else {
    lines.push('✅ 未检测到第三方域名');
  }

  // Cookie
  if (cookies.length > 0) {
    const thirdParty = cookies.filter(c => c.isThirdParty).length;
    const tracking = cookies.filter(c => c.category === 'tracking').length;
    if (tracking > 0) {
      lines.push(`🍪 ${cookies.length} 个 Cookie（${thirdParty} 第三方，${tracking} 追踪类）`);
    } else {
      lines.push(`🍪 ${cookies.length} 个 Cookie（${thirdParty} 第三方）`);
    }
  } else {
    lines.push('✅ 未检测到 Cookie');
  }

  // Canvas 指纹
  if (canvas.detected) {
    lines.push(`⚠️ 检测到 ${canvas.events.length} 次 Canvas 指纹行为`);
  } else {
    lines.push('✅ 未检测到 Canvas 指纹');
  }

  // WebRTC 泄漏
  if (webrtc.detected) {
    const uniqueIPs = new Set(webrtc.events.map(e => e.ipAddress)).size;
    lines.push(`⚠️ 检测到 WebRTC 泄漏（${uniqueIPs} 个 IP）`);
  } else {
    lines.push('✅ 未检测到 WebRTC 泄漏');
  }

  summaryEl.innerHTML = lines.join('<br>');
}

// ============================================================
// 渲染第三方域名
// ============================================================
function renderThirdPartyDomains(domains, breakdown) {
  const accordion = document.getElementById('accordionDomains');
  const countEl = document.getElementById('domainCount');
  const scoreEl = document.getElementById('domainScore');
  const listEl = document.getElementById('domainList');

  countEl.textContent = domains.length;

  if (breakdown && breakdown.thirdPartyDomains) {
    scoreEl.textContent = `▸ ${breakdown.thirdPartyDomains.weighted}分`;
  }

  if (domains.length === 0) {
    listEl.innerHTML = '<p class="empty-hint">✅ 未检测到第三方域名</p>';
    return;
  }

  // 排序：已知追踪器优先，然后按资源数量降序
  const sorted = [...domains].sort((a, b) => {
    if (a.knownTracker && !b.knownTracker) return -1;
    if (!a.knownTracker && b.knownTracker) return 1;
    return b.urlCount - a.urlCount;
  });

  listEl.innerHTML = sorted.map(domain => {
    const trackerBadge = domain.knownTracker
      ? `<span class="tracker-badge">⚠️ ${domain.knownTracker.category}</span>`
      : '';

    const typeTags = (domain.resourceTypes || []).slice(0, 4).map(t => {
      const typeNames = {
        script: 'JS', img: 'IMG', iframe: 'IFR', css: 'CSS',
        xmlhttprequest: 'XHR', fetch: 'FETCH', media: 'MED',
        link: 'LINK', font: 'FONT', plugin: 'PLUG',
        sub_frame: 'IFR', image: 'IMG', main_frame: 'DOC',
        stylesheet: 'CSS', font: 'FONT'
      };
      return `<span class="domain-type-tag">${typeNames[t] || t.toUpperCase()}</span>`;
    }).join('');

    return `
      <div class="domain-item">
        <span class="domain-name">${escapeHtml(domain.domain)}</span>
        <span class="domain-types">${typeTags}</span>
        <span class="domain-count">×${domain.urlCount}</span>
        ${trackerBadge}
      </div>
    `;
  }).join('');
}

// ============================================================
// 渲染 Cookie
// ============================================================
function renderCookies(cookies, breakdown) {
  const countEl = document.getElementById('cookieCount');
  const scoreEl = document.getElementById('cookieScore');
  const listEl = document.getElementById('cookieList');

  countEl.textContent = cookies.length;

  if (breakdown && breakdown.cookies) {
    scoreEl.textContent = `▸ ${breakdown.cookies.weighted}分`;
  }

  if (cookies.length === 0) {
    listEl.innerHTML = '<p class="empty-hint">✅ 未检测到 Cookie</p>';
    return;
  }

  // 排序：追踪类 > 第三方 > 其他
  const sorted = [...cookies].sort((a, b) => {
    const order = { tracking: 0, 'potential-tracking': 1, persistent: 2, session: 3, unknown: 4 };
    const aOrd = order[a.category] || 5;
    const bOrd = order[b.category] || 5;
    if (aOrd !== bOrd) return aOrd - bOrd;
    return (b.isThirdParty ? 1 : 0) - (a.isThirdParty ? 1 : 0);
  });

  listEl.innerHTML = sorted.map(cookie => {
    const tags = [];

    if (cookie.category === 'tracking') {
      tags.push('<span class="cookie-tag tracking">追踪</span>');
    } else if (cookie.category === 'potential-tracking') {
      tags.push('<span class="cookie-tag tracking">疑似追踪</span>');
    }

    if (cookie.isThirdParty) {
      tags.push('<span class="cookie-tag third-party">第三方</span>');
    } else {
      tags.push('<span class="cookie-tag session">第一方</span>');
    }

    if (cookie.isPersistent) {
      const days = cookie.expirationDays;
      const daysText = days > 365 ? `${Math.round(days/365)}年` :
                       days > 30 ? `${Math.round(days/30)}月` : `${days}天`;
      tags.push(`<span class="cookie-tag persistent">${daysText}</span>`);
    } else {
      tags.push('<span class="cookie-tag session">会话</span>');
    }

    return `
      <div class="cookie-item">
        <span class="cookie-name">${escapeHtml(cookie.name)}</span>
        <span class="cookie-meta">${tags.join('')}</span>
      </div>
    `;
  }).join('');
}

// ============================================================
// 渲染 Canvas 指纹
// ============================================================
function renderCanvasFingerprinting(canvasData, breakdown) {
  const statusEl = document.getElementById('canvasStatus');
  const scoreEl = document.getElementById('canvasScore');
  const listEl = document.getElementById('canvasList');

  if (breakdown && breakdown.canvasFingerprinting) {
    scoreEl.textContent = `▸ ${breakdown.canvasFingerprinting.weighted}分`;
  }

  if (!canvasData.detected || canvasData.events.length === 0) {
    statusEl.textContent = '安全';
    statusEl.className = 'accordion-badge';
    listEl.innerHTML = '<p class="empty-hint">✅ 未检测到 Canvas 指纹行为</p>';
    return;
  }

  statusEl.textContent = '检测到';
  statusEl.className = 'accordion-badge danger';

  listEl.innerHTML = canvasData.events.map((event, i) => {
    const tags = [];

    if (event.method === 'toDataURL') tags.push('<span class="canvas-event-tag">toDataURL</span>');
    if (event.method === 'toBlob') tags.push('<span class="canvas-event-tag">toBlob</span>');
    if (event.method === 'getImageData') tags.push('<span class="canvas-event-tag">getImageData</span>');

    if (event.canvasArea < 256) {
      tags.push('<span class="canvas-event-tag risk">极小画布</span>');
    } else if (event.canvasArea < 10000) {
      tags.push('<span class="canvas-event-tag">小画布</span>');
    }
    tags.push(`<span class="canvas-event-tag">${event.canvasWidth}×${event.canvasHeight}</span>`);

    if (event.addedToDOM === false) {
      tags.push('<span class="canvas-event-tag risk">未渲染到页面</span>');
    }
    if (event.exoticTextUsed) {
      tags.push('<span class="canvas-event-tag risk">异形文字</span>');
    }
    if (event.fontsUsed && event.fontsUsed.length > 1) {
      tags.push(`<span class="canvas-event-tag risk">字体枚举(${event.fontsUsed.length})</span>`);
    }

    return `
      <div class="canvas-event-item">
        <span class="canvas-event-method">事件 #${i + 1}</span>
        <div class="canvas-event-details">${tags.join('')}</div>
      </div>
    `;
  }).join('');
}

// ============================================================
// 渲染 WebRTC 泄漏
// ============================================================
function renderWebRtcLeaks(webrtcData, breakdown) {
  const statusEl = document.getElementById('webrtcStatus');
  const scoreEl = document.getElementById('webrtcScore');
  const listEl = document.getElementById('webrtcList');

  if (breakdown && breakdown.webrtcLeaks) {
    scoreEl.textContent = `▸ ${breakdown.webrtcLeaks.weighted}分`;
  }

  if (!webrtcData.detected || webrtcData.events.length === 0) {
    statusEl.textContent = '安全';
    statusEl.className = 'accordion-badge';
    listEl.innerHTML = '<p class="empty-hint">✅ 未检测到 WebRTC 泄漏</p>';
    return;
  }

  statusEl.textContent = '泄漏';
  statusEl.className = 'accordion-badge danger';

  listEl.innerHTML = webrtcData.events.map((event, i) => {
    const tags = [];

    if (event.candidateType === 'srflx') {
      tags.push('<span class="webrtc-event-tag risk">公网IP(srflx)</span>');
    } else if (event.candidateType === 'host') {
      if (event.ipClassification === 'host-private') {
        tags.push('<span class="webrtc-event-tag risk">私有IP泄漏</span>');
      } else if (event.ipClassification === 'host-public') {
        tags.push('<span class="webrtc-event-tag risk">公网IP暴露</span>');
      } else if (event.ipClassification === 'host-link-local') {
        tags.push('<span class="webrtc-event-tag">链路本地</span>');
      }
    } else {
      tags.push(`<span class="webrtc-event-tag">${event.candidateType}</span>`);
    }

    return `
      <div class="webrtc-event-item">
        <span class="webrtc-ip">${escapeHtml(event.ipAddress)}</span>
        <div class="webrtc-event-details">${tags.join('')}</div>
      </div>
    `;
  }).join('');
}

// ============================================================
// 显示加载/错误状态
// ============================================================
function showLoading(show, text) {
  const overlay = document.getElementById('overlay');
  const overlayText = document.getElementById('overlayText');
  const overlaySpinner = document.getElementById('overlaySpinner');

  if (show) {
    overlay.style.display = 'flex';
    overlayText.textContent = text || '正在扫描...';
    overlaySpinner.style.display = text && text.includes('失败') ? 'none' : 'block';
  } else {
    overlay.style.display = 'none';
  }
}

// ============================================================
// 显示不支持的页面
// ============================================================
function showUnsupportedPage() {
  document.getElementById('scoreSection').innerHTML = `
    <div style="text-align:center; padding:30px 0;">
      <div style="font-size:48px; margin-bottom:12px;">🔒</div>
      <p style="color:var(--text-secondary); font-size:13px;">此页面不支持扫描</p>
      <p style="color:var(--text-muted); font-size:11px; margin-top:4px;">Chrome 内部页面无法注入检测脚本</p>
    </div>
  `;
  document.getElementById('summaryText').textContent = '';
  document.getElementById('detailsSection').style.display = 'none';
}

// ============================================================
// 按钮操作
// ============================================================
async function rescan() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  showLoading(true, '正在重新扫描...');

  try {
    // 请求 Content Script 重新发送报告
    await chrome.tabs.sendMessage(tab.id, { type: 'REQUEST_REPORT' });
  } catch (e) {
    // Content Script 可能不响应
  }

  // 等待 Background 处理
  setTimeout(async () => {
    await loadReport(tab.id);
  }, 800);
}

function openSettings() {
  if (chrome.runtime.openOptionsPage) {
    chrome.runtime.openOptionsPage();
  } else {
    window.open(chrome.runtime.getURL('options/options.html'));
  }
}

// ============================================================
// Tab 切换
// ============================================================
function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    });
  });
}

// ============================================================
// 广告拦截面板
// ============================================================
let adWhitelistState = false;

async function initAdBlockPanel(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    const domain = new URL(tab.url).hostname;

    const response = await chrome.runtime.sendMessage({ type: 'AD_GET_RULES' });
    if (!response) return;

    const { rules, whitelist, stats } = response;

    document.getElementById('adBlockedToday').textContent = stats.todayTotal;
    document.getElementById('adDNRCount').textContent = stats.dnrRuleCount;

    const toggle = document.getElementById('adToggle');
    toggle.checked = stats.enabled;

    // 当前页面拦截数（暂时显示 0，等 content script 上报后更新）
    document.getElementById('adBlockedPage').textContent = '...';

    renderAdRules(rules);
    adWhitelistState = whitelist.some(d => domain === d || domain.endsWith('.' + d));
    updateWhitelistBtn();
    bindAdEvents(domain);
  } catch (e) {
    console.error('[广告拦截] 面板初始化失败:', e);
  }
}

function renderAdRules(rules) {
  const container = document.getElementById('adRuleList');
  const count = document.getElementById('adRuleCount');
  const allRules = [
    ...rules.network.map(r => ({ id: r.id, type: 'network', text: r.condition.urlFilter || r.condition.regexFilter || '(规则)' })),
    ...rules.cosmetic.map(r => ({ id: r.id, type: 'cosmetic', text: `##${r.selector}` }))
  ];

  count.textContent = allRules.length;
  if (allRules.length === 0) {
    container.innerHTML = '<p class="empty-hint">暂无自定义规则</p>';
    return;
  }
  container.innerHTML = allRules.map(r => `
    <div class="ad-rule-item">
      <span class="ad-rule-text">${escapeHtml(r.text)}</span>
      <button class="ad-rule-delete" data-id="${r.id}" data-type="${r.type}">删除</button>
    </div>
  `).join('');
}

function bindAdEvents(domain) {
  document.getElementById('adToggle').addEventListener('change', async (e) => {
    await chrome.runtime.sendMessage({ type: 'AD_TOGGLE', enabled: e.target.checked });
  });

  document.getElementById('adRuleAdd').addEventListener('click', async () => {
    const input = document.getElementById('adRuleInput');
    const rule = input.value.trim();
    if (!rule) return;
    const result = await chrome.runtime.sendMessage({ type: 'AD_ADD_RULE', rule });
    if (result.success) {
      input.value = '';
      const resp = await chrome.runtime.sendMessage({ type: 'AD_GET_RULES' });
      renderAdRules(resp.rules);
    } else {
      alert('添加失败: ' + result.error);
    }
  });

  document.getElementById('adRuleList').addEventListener('click', async (e) => {
    if (!e.target.classList.contains('ad-rule-delete')) return;
    const id = parseInt(e.target.dataset.id);
    const type = e.target.dataset.type;
    await chrome.runtime.sendMessage({ type: 'AD_REMOVE_RULE', ruleId: id, type });
    const resp = await chrome.runtime.sendMessage({ type: 'AD_GET_RULES' });
    renderAdRules(resp.rules);
  });

  document.getElementById('adWhitelistBtn').addEventListener('click', async () => {
    const action = adWhitelistState ? 'remove' : 'add';
    await chrome.runtime.sendMessage({ type: 'AD_WHITELIST', action, domain });
    adWhitelistState = !adWhitelistState;
    updateWhitelistBtn();
  });
}

function updateWhitelistBtn() {
  const btn = document.getElementById('adWhitelistBtn');
  btn.textContent = adWhitelistState ? '✅ 已放行本网站（点击取消）' : '⬜ 对本网站放行';
}

// ============================================================
// 工具函数
// ============================================================
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ============================================================
// 趋势面板
// ============================================================

async function renderHistoryTab() {
  try {
    const { history = [], trackerFrequency = {} } =
      await chrome.storage.local.get(['history', 'trackerFrequency']);

    renderTrendStats(history, trackerFrequency);
    renderTrendChart(history);
    renderTrendRanking(trackerFrequency);
  } catch (e) {
    console.error('[趋势面板] 渲染失败:', e);
    document.getElementById('trendAvgScore').textContent = '--';
    document.getElementById('trendSiteCount').textContent = '--';
    document.getElementById('trendTrackerTotal').textContent = '--';
  }
}

function renderTrendStats(history, trackerFrequency) {
  if (history.length > 0) {
    const avgScore = Math.round(history.reduce((s, h) => s + h.score, 0) / history.length);
    const avgEl = document.getElementById('trendAvgScore');
    avgEl.textContent = avgScore;
    if (avgScore < 50) avgEl.classList.add('low');
    else avgEl.classList.remove('low');
  }
  const siteCount = new Set(history.map(h => h.domain)).size;
  document.getElementById('trendSiteCount').textContent = siteCount;
  const totalTrackers = Object.values(trackerFrequency).reduce((s, t) => s + t.count, 0);
  document.getElementById('trendTrackerTotal').textContent = totalTrackers;
}

function renderTrendChart(history) {
  const svg = document.getElementById('trendChartSvg');
  if (!svg) return;

  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push({
      dateStr: d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }),
      isoDate: d.toLocaleDateString('zh-CN')
    });
  }

  const dailyScores = new Map();
  for (const h of history) {
    const dateStr = new Date(h.timestamp).toLocaleDateString('zh-CN');
    if (!dailyScores.has(dateStr)) {
      dailyScores.set(dateStr, { total: 0, count: 0 });
    }
    const entry = dailyScores.get(dateStr);
    entry.total += h.score;
    entry.count++;
  }

  const points = days.map(d => {
    const entry = dailyScores.get(d.isoDate);
    if (entry && entry.count > 0) {
      return { ...d, hasData: true, avgScore: Math.round(entry.total / entry.count), count: entry.count };
    }
    return { ...d, hasData: false, avgScore: null, count: 0 };
  });

  const padLeft = 32, padRight = 16, padTop = 10, padBottom = 24;
  const width = 300, height = 160;
  const plotLeft = padLeft, plotRight = width - padRight;
  const plotTop = padTop, plotBottom = height - padBottom;

  let html = '<defs><linearGradient id="trendGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#3b82f6" stop-opacity="0.25"/><stop offset="100%" stop-color="#3b82f6" stop-opacity="0"/></linearGradient></defs>';

  const yValues = [0, 25, 50, 75, 100];
  for (const yVal of yValues) {
    const y = plotBottom - (yVal / 100) * (plotBottom - plotTop);
    html += `<line class="grid-line" x1="${plotLeft}" y1="${y}" x2="${plotRight}" y2="${y}"/>`;
    html += `<text class="y-label" x="${plotLeft - 4}" y="${y + 3}" text-anchor="end">${yVal}</text>`;
  }

  const xGap = (plotRight - plotLeft) / 6;
  for (let i = 0; i < points.length; i++) {
    const x = plotLeft + i * xGap;
    const cls = points[i].hasData ? 'x-label' : 'x-label empty';
    html += `<text class="${cls}" x="${x}" y="${height - 4}">${points[i].dateStr}</text>`;
  }

  const dataPoints = [];
  for (let i = 0; i < points.length; i++) {
    if (points[i].hasData) {
      const x = plotLeft + i * xGap;
      const y = plotBottom - (points[i].avgScore / 100) * (plotBottom - plotTop);
      dataPoints.push({ x, y, ...points[i] });
    }
  }

  if (dataPoints.length >= 1) {
    let fillPath = `M ${dataPoints[0].x} ${plotBottom}`;
    for (const pt of dataPoints) {
      fillPath += ` L ${pt.x} ${pt.y}`;
    }
    fillPath += ` L ${dataPoints[dataPoints.length - 1].x} ${plotBottom} Z`;
    html += `<path class="trend-fill" d="${fillPath}"/>`;
    html += `<polyline class="trend-line" points="${dataPoints.map(pt => `${pt.x},${pt.y}`).join(' ')}"/>`;
  }

  for (const pt of dataPoints) {
    html += `<circle class="trend-dot" cx="${pt.x}" cy="${pt.y}" r="3.5"><title>${pt.dateStr} · ${pt.count}个站点 · 均分${pt.avgScore}</title></circle>`;
  }

  svg.innerHTML = html;
}

function renderTrendRanking(trackerFrequency) {
  const listEl = document.getElementById('trendRankingList');
  if (!listEl) return;

  const entries = Object.entries(trackerFrequency)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 8);

  if (entries.length === 0) {
    listEl.innerHTML = '<p class="empty-hint">暂无追踪器数据</p>';
    return;
  }

  listEl.innerHTML = entries.map(([domain, info], i) => `
    <div class="trend-ranking-item">
      <span class="trend-ranking-rank">${i + 1}.</span>
      <span class="trend-ranking-domain">${escapeHtml(domain)}</span>
      <span class="trend-ranking-cat">${escapeHtml(info.category || '追踪')}</span>
      <span class="trend-ranking-count">${info.count}次</span>
    </div>
  `).join('');
}

// ============================================================
// 指纹面板
// ============================================================

async function renderFingerprintTab() {
  try {
    const results = await FingerprintCollector.collectAll();
    const totalEntropy = FingerprintCollector.calculateTotalEntropy(results);
    const entropyLevel = FingerprintCollector.getEntropyLevel(totalEntropy);

    renderFingerprintEntropy(totalEntropy, entropyLevel);
    renderFingerprintItems(results);
  } catch (e) {
    console.error('[指纹面板] 渲染失败:', e);
    document.getElementById('fpEntropyValue').textContent = '-- bits';
    document.getElementById('fpEntropyDesc').textContent = '采集失败，请重新打开 popup';
  }
}

function renderFingerprintEntropy(totalBits, entropyLevel) {
  const valueEl = document.getElementById('fpEntropyValue');
  const barEl = document.getElementById('fpEntropyBar');
  const descEl = document.getElementById('fpEntropyDesc');

  if (valueEl) valueEl.textContent = totalBits.toFixed(1) + ' bits';
  if (barEl) {
    const pct = Math.min(100, (totalBits / 68) * 100);
    barEl.style.width = pct + '%';
    barEl.style.background = entropyLevel.color;
  }
  const levelEmoji = entropyLevel.level === 'low' ? '🟢' : entropyLevel.level === 'medium' ? '🟡' : '🔴';
  if (descEl) descEl.textContent = levelEmoji + ' ' + entropyLevel.label;
}

function renderFingerprintItems(results) {
  const container = document.getElementById('fpDetailsSection');
  if (!container) return;

  container.innerHTML = results.map(item => `
    <details class="fp-accordion">
      <summary class="fp-accordion-header">
        <span class="fp-level-dot ${item.level}"></span>
        <span class="fp-item-icon">${item.icon}</span>
        <span class="fp-item-name">${escapeHtml(item.name)}</span>
        <span class="fp-item-value">${escapeHtml(item.value)}</span>
      </summary>
      <div class="fp-accordion-body">
        ${(item.detail || []).map(d => `
          <div class="fp-detail-row">
            <span class="fp-detail-label">${escapeHtml(d.label)}:</span>
            <span class="fp-detail-value">${escapeHtml(d.value)}</span>
          </div>
        `).join('')}
      </div>
    </details>
  `).join('');
}

// ============================================================
// 链接清理面板
// ============================================================

async function renderLinkCleanerTab(tab) {
  try {
    const url = tab.url || '';
    const cleaned = URLCleaner.clean(url);
    const removed = URLCleaner.getRemovedParams(url);
    const hasParams = removed.length > 0;

    // 链接对比
    if (hasParams) {
      document.getElementById('lcOriginalUrl').innerHTML = highlightTrackingParams(url, removed);
      document.getElementById('lcCleanedUrl').textContent = cleaned;
    } else {
      document.getElementById('lcOriginalUrl').textContent = url;
      document.getElementById('lcCleanedUrl').textContent = '✅ 此链接无需清理';
    }

    // 参数列表
    renderCleanedParams(removed);

    // 统计
    await renderCleanStats();

    // 绑定事件
    bindLinkCleanEvents(tab, url);
  } catch (e) {
    console.error('[链接清理] 渲染失败:', e);
  }
}

function highlightTrackingParams(url, removed) {
  let html = escapeHtml(url);
  for (const r of removed) {
    const escaped = escapeHtml(r.param);
    const regex = new RegExp(`([?&])(${escaped.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}=[^&#]*)`, 'gi');
    html = html.replace(regex, `$1<span class="tracking-param">$2</span>`);
  }
  return html;
}

function renderCleanedParams(removed) {
  const container = document.getElementById('lcParamList');
  if (!container) return;

  if (removed.length === 0) {
    container.innerHTML = '<p class="empty-hint">✅ 当前页面无追踪参数</p>';
    return;
  }

  container.innerHTML = removed.map(r => `
    <div class="lc-param-item">
      <span class="lc-param-name">${escapeHtml(r.param)}</span>
      <span class="lc-param-source">${escapeHtml(r.source)}</span>
    </div>
  `).join('');
}

async function renderCleanStats() {
  try {
    const { linkCleanStats } = await chrome.storage.local.get(['linkCleanStats']);
    const todayCleaned = linkCleanStats && linkCleanStats.todayDate === new Date().toDateString()
      ? linkCleanStats.todayCleaned : 0;
    document.getElementById('lcTodayCleaned').textContent = todayCleaned;
  } catch (e) {
    document.getElementById('lcTodayCleaned').textContent = '0';
  }
}

function bindLinkCleanEvents(tab, originalUrl) {
  const toggle = document.getElementById('lcAutoCleanToggle');
  if (toggle) {
    chrome.storage.sync.get(['linkCleanEnabled'], (result) => {
      toggle.checked = result.linkCleanEnabled !== false;
    });
    toggle.addEventListener('change', () => {
      chrome.storage.sync.set({ linkCleanEnabled: toggle.checked });
    });
  }

  const copyBtn = document.getElementById('lcCopyBtn');
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      const cleaned = URLCleaner.clean(originalUrl);
      try {
        await navigator.clipboard.writeText(cleaned);
        const hint = document.getElementById('lcCopyHint');
        if (hint) { hint.style.display = 'block'; setTimeout(() => { hint.style.display = 'none'; }, 2000); }
      } catch (e) {
        const ta = document.createElement('textarea');
        ta.value = cleaned;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
    });
  }
}
