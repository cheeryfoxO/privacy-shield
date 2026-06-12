# 跨站点历史仪表盘 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为隐私护盾新增第三个 tab「📈 趋势」，展示 7 天隐私评分折线图、统计卡片和追踪器排行榜。

**Architecture:** Background SW 在处理每次隐私报告后自动记录历史到 chrome.storage.local，Popup 直接从 storage 读取并渲染纯 SVG 折线图（零依赖）。数据保留 7 天，上限 500 条。

**Tech Stack:** 纯 JavaScript (MV3), SVG 手绘, chrome.storage.local

---

## 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `background/service-worker.js` | 修改 | 新增 `recordHistory()` 和 `updateTrackerFrequency()` |
| `popup/popup.html` | 修改 | 新增第三个 tab 按钮 + trend panel 结构 |
| `popup/popup.css` | 修改 | 新增趋势 tab 全部样式 |
| `popup/popup.js` | 修改 | 新增 `renderHistoryTab()`、SVG 绘图、统计、排行 |

---

### Task 1: Background 历史记录逻辑

**Files:**
- Modify: `background/service-worker.js`

- [ ] **Step 1: 在 handlePrivacyReport 末尾追加 recordHistory 调用**

在 `background/service-worker.js` 的 `handlePrivacyReport()` 函数中，找到：
```js
  // 持久化到 storage
  await StorageManager.saveReport(tabId, report);
```
替换为：
```js
  // 持久化到 storage
  await StorageManager.saveReport(tabId, report);

  // 记录跨站点历史
  await recordHistory(report);
```

- [ ] **Step 2: 新增 recordHistory 和 updateTrackerFrequency 函数**

在 `background/service-worker.js` 末尾（`initAdBlocker();` 之前）插入以下代码：

```js
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

    // 清理 7 天前的记录
    const cutoff = Date.now() - 7 * 24 * 3600 * 1000;
    const trimmed = history.filter(h => h.timestamp > cutoff);

    // 上限 500 条
    if (trimmed.length > 500) {
      trimmed.splice(0, trimmed.length - 500);
    }

    await chrome.storage.local.set({ history: trimmed });

    // 更新追踪器频次
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

    // 每 24 小时做一次全量重新统计（简化：检查上次重置时间）
    const lastReset = await chrome.storage.local.get(['trackerLastReset']);
    const now = Date.now();
    if (!lastReset.trackerLastReset || (now - lastReset.trackerLastReset) > 24 * 3600 * 1000) {
      // 超过 24 小时，重新从 history 统计
      const { history = [] } = await chrome.storage.local.get(['history']);
      const fresh = {};
      for (const h of history) {
        // history 记录里没有逐个追踪器信息，保留现有计数但减半衰减
      }
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
```

- [ ] **Step 3: 验证**

在 `chrome://extensions` 重新加载插件，访问任意网站，然后在 DevTools Console（Service Worker 页面）执行：
```js
chrome.storage.local.get(['history', 'trackerFrequency'], console.log);
```
预期：`history` 数组包含刚访问站点的记录，包含 domain/score/timestamp 等字段。

---

### Task 2: Popup HTML 结构

**Files:**
- Modify: `popup/popup.html`

- [ ] **Step 1: 新增第三个 tab 按钮**

在 `popup/popup.html` 的 `<nav class="tab-nav">` 中，现有两个 button 之后追加：
```html
    <button class="tab-btn" data-tab="trends">📈 趋势</button>
```

- [ ] **Step 2: 新增趋势面板（放在广告拦截面板之后、overlay 之前）**

在 `<!-- ====== 广告拦截面板 END ====== -->` 之后、`<!-- 加载/错误遮罩 -->` 之前插入：

```html
  <!-- ====== 趋势面板 ====== -->
  <div class="tab-panel" id="tab-trends">

    <!-- 统计卡片行 -->
    <section class="trend-stats">
      <div class="trend-stat-card">
        <span class="trend-stat-value" id="trendAvgScore">--</span>
        <span class="trend-stat-label">7天平均分</span>
      </div>
      <div class="trend-stat-card">
        <span class="trend-stat-value" id="trendSiteCount">--</span>
        <span class="trend-stat-label">访问站点</span>
      </div>
      <div class="trend-stat-card">
        <span class="trend-stat-value" id="trendTrackerTotal">--</span>
        <span class="trend-stat-label">拦截追踪器</span>
      </div>
    </section>

    <!-- SVG 折线图 -->
    <section class="trend-chart-section">
      <h3 class="trend-section-title">7天隐私趋势</h3>
      <div class="trend-chart-container" id="trendChartContainer">
        <svg class="trend-chart" id="trendChartSvg" viewBox="0 0 300 160" xmlns="http://www.w3.org/2000/svg"></svg>
      </div>
    </section>

    <!-- 追踪器排行榜 -->
    <section class="trend-ranking-section">
      <h3 class="trend-section-title">🔝 最常见追踪器</h3>
      <div class="trend-ranking-list" id="trendRankingList">
        <p class="empty-hint">暂无追踪器数据</p>
      </div>
    </section>

    <!-- 底部提示 -->
    <section class="trend-footer">
      <span class="trend-footer-text">仅保留最近 7 天数据</span>
    </section>

  </div>
  <!-- ====== 趋势面板 END ====== -->
```

---

### Task 3: Popup CSS 样式

**Files:**
- Modify: `popup/popup.css`

- [ ] **Step 1: 在 popup.css 末尾追加趋势面板全部样式**

```css
/* ============================================================
   趋势面板
   ============================================================ */

/* 统计卡片行 */
.trend-stats {
  display: flex;
  gap: 8px;
  padding: 12px 16px;
}

.trend-stat-card {
  flex: 1;
  background: var(--bg-secondary);
  border-radius: var(--radius-sm);
  padding: 12px 8px;
  text-align: center;
}

.trend-stat-value {
  display: block;
  font-size: 22px;
  font-weight: 800;
  color: #3b82f6;
  line-height: 1.2;
}

.trend-stat-value.low {
  color: var(--color-red);
}

.trend-stat-label {
  display: block;
  font-size: 11px;
  color: var(--text-muted);
  margin-top: 2px;
}

/* 图表区域 */
.trend-chart-section {
  padding: 0 16px 8px;
}

.trend-section-title {
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 6px;
  color: var(--text-secondary);
}

.trend-chart-container {
  background: var(--bg-secondary);
  border-radius: var(--radius-sm);
  padding: 4px;
}

.trend-chart {
  display: block;
  width: 100%;
  height: auto;
}

/* 网格线 */
.trend-chart .grid-line {
  stroke: var(--border-color);
  stroke-dasharray: 4, 4;
  stroke-width: 0.5;
}

/* Y 轴标签 */
.trend-chart .y-label {
  font-size: 10px;
  fill: var(--text-muted);
}

/* X 轴标签 */
.trend-chart .x-label {
  font-size: 9px;
  fill: var(--text-muted);
  text-anchor: middle;
}

.trend-chart .x-label.empty {
  fill: var(--text-muted);
  opacity: 0.4;
}

/* 折线 */
.trend-chart .trend-line {
  fill: none;
  stroke: #3b82f6;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

/* 渐变填充 */
.trend-chart .trend-fill {
  fill: url(#trendGradient);
}

/* 数据点 */
.trend-chart .trend-dot {
  fill: #3b82f6;
  stroke: var(--bg-primary);
  stroke-width: 2;
}

/* 排行榜 */
.trend-ranking-section {
  padding: 4px 16px 0;
}

.trend-ranking-list {
  max-height: 180px;
  overflow-y: auto;
}

.trend-ranking-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 0;
  border-bottom: 1px solid var(--border-color);
  font-size: 11px;
}

.trend-ranking-item:last-child {
  border-bottom: none;
}

.trend-ranking-rank {
  font-weight: 700;
  color: var(--text-muted);
  min-width: 16px;
  text-align: center;
}

.trend-ranking-domain {
  flex: 1;
  font-family: monospace;
  font-size: 11px;
  word-break: break-all;
}

.trend-ranking-cat {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 3px;
  background: var(--bg-hover);
  color: var(--text-secondary);
  white-space: nowrap;
}

.trend-ranking-count {
  font-weight: 600;
  color: var(--text-secondary);
  min-width: 32px;
  text-align: right;
}

/* 底部提示 */
.trend-footer {
  text-align: center;
  padding: 12px 16px 8px;
}

.trend-footer-text {
  font-size: 10px;
  color: var(--text-muted);
  opacity: 0.7;
}
```

---

### Task 4: Popup JS 趋势面板渲染逻辑

**Files:**
- Modify: `popup/popup.js`

- [ ] **Step 1: 在 init() 中追加趋势面板初始化调用**

在 `popup/popup.js` 的 `init()` 函数中，找到：
```js
  // 初始化广告拦截面板
  await initAdBlockPanel(tab.id);
```
在其后追加：
```js
  // 初始化趋势面板
  await renderHistoryTab();
```

- [ ] **Step 2: 在 popup.js 末尾追加全部趋势面板渲染函数**

```js
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

// ---- 统计卡片 ----

function renderTrendStats(history, trackerFrequency) {
  // 平均分
  if (history.length > 0) {
    const avgScore = Math.round(history.reduce((s, h) => s + h.score, 0) / history.length);
    const avgEl = document.getElementById('trendAvgScore');
    avgEl.textContent = avgScore;
    if (avgScore < 50) avgEl.classList.add('low');
    else avgEl.classList.remove('low');
  }

  // 访问站点数
  const siteCount = new Set(history.map(h => h.domain)).size;
  document.getElementById('trendSiteCount').textContent = siteCount;

  // 拦截追踪器总计
  const totalTrackers = Object.values(trackerFrequency).reduce((s, t) => s + t.count, 0);
  document.getElementById('trendTrackerTotal').textContent = totalTrackers;
}

// ---- SVG 折线图 ----

function renderTrendChart(history) {
  const svg = document.getElementById('trendChartSvg');
  if (!svg) return;

  // 生成最近 7 天的日期列表
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push({
      dateStr: d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }),
      isoDate: d.toLocaleDateString('zh-CN') // 用于匹配
    });
  }

  // 按日期分组求日均分
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

  // 构建数据点
  const points = days.map(d => {
    const entry = dailyScores.get(d.isoDate);
    if (entry && entry.count > 0) {
      return {
        ...d,
        hasData: true,
        avgScore: Math.round(entry.total / entry.count),
        count: entry.count
      };
    }
    return { ...d, hasData: false, avgScore: null, count: 0 };
  });

  // SVG 参数
  const padLeft = 32, padRight = 16, padTop = 10, padBottom = 24;
  const width = 300, height = 160;
  const plotLeft = padLeft, plotRight = width - padRight;
  const plotTop = padTop, plotBottom = height - padBottom;

  let html = '';

  // 渐变定义
  html += `<defs>
    <linearGradient id="trendGradient" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#3b82f6" stop-opacity="0.25"/>
      <stop offset="100%" stop-color="#3b82f6" stop-opacity="0"/>
    </linearGradient>
  </defs>`;

  // 网格线 (Y: 0, 25, 50, 75, 100)
  const yValues = [0, 25, 50, 75, 100];
  for (const yVal of yValues) {
    const y = plotBottom - (yVal / 100) * (plotBottom - plotTop);
    html += `<line class="grid-line" x1="${plotLeft}" y1="${y}" x2="${plotRight}" y2="${y}"/>`;
    html += `<text class="y-label" x="${plotLeft - 4}" y="${y + 3}" text-anchor="end">${yVal}</text>`;
  }

  // X 轴 + 标签
  const xGap = (plotRight - plotLeft) / (points.length - 1);
  for (let i = 0; i < points.length; i++) {
    const x = plotLeft + i * xGap;
    const cls = points[i].hasData ? 'x-label' : 'x-label empty';
    html += `<text class="${cls}" x="${x}" y="${height - 4}">${points[i].dateStr}</text>`;
  }

  // 收集有数据的点坐标
  const dataPoints = [];
  for (let i = 0; i < points.length; i++) {
    if (points[i].hasData) {
      const x = plotLeft + i * xGap;
      const y = plotBottom - (points[i].avgScore / 100) * (plotBottom - plotTop);
      dataPoints.push({ x, y, ...points[i] });
    }
  }

  // 渐变填充区域
  if (dataPoints.length >= 2) {
    let fillPath = `M ${dataPoints[0].x} ${plotBottom} L ${dataPoints[0].x} ${dataPoints[0].y}`;
    for (const pt of dataPoints) {
      fillPath += ` L ${pt.x} ${pt.y}`;
    }
    fillPath += ` L ${dataPoints[dataPoints.length - 1].x} ${plotBottom} Z`;
    html += `<path class="trend-fill" d="${fillPath}"/>`;
  }

  // 折线
  if (dataPoints.length >= 1) {
    const linePath = dataPoints.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x} ${pt.y}`).join(' ');
    html += `<polyline class="trend-line" points="${dataPoints.map(pt => `${pt.x},${pt.y}`).join(' ')}"/>`;
  }

  // 数据点
  for (const pt of dataPoints) {
    html += `<circle class="trend-dot" cx="${pt.x}" cy="${pt.y}" r="3.5">
      <title>${pt.dateStr} · ${pt.count}个站点 · 均分${pt.avgScore}</title>
    </circle>`;
  }

  svg.innerHTML = html;
}

// ---- 追踪器排行榜 ----

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
```

---

### Task 5: Popup HTML JS 集成 — Tab 切换适配三个 Tab

**Files:**
- Modify: `popup/popup.js` (initTabs 函数无需改动，已经通用于 N 个 tab)

**验证点**：`initTabs()` 函数使用 `document.querySelectorAll('.tab-btn')` 遍历，自动支持第三个 tab，无需修改。

- [ ] **Step 1: 在 chrome://extensions 重新加载插件**

打开 `chrome://extensions`，点击隐私护盾的刷新按钮。

- [ ] **Step 2: 访问几个测试网站**

依次访问：
1. `https://www.wikipedia.org` — 预期高分
2. `https://www.baidu.com` — 预期中等分
3. 任意新闻聚合网站

每次访问后在插件图标上点开 popup。

- [ ] **Step 3: 验证趋势面板**

切换到「📈 趋势」tab，检查：
- 统计卡片显示平均分（数字）、访问站点数、拦截追踪器数
- 折线图显示最近几天的数据点，hover 数据点应出现 tooltip
- 追踪器排行榜按频次降序，最多 8 条
- 暗色模式下颜色正常

- [ ] **Step 4: 验证空数据状态**

首次安装插件时，趋势面板应显示：
- 平均分 `--`，访问站点 `0`，拦截追踪器 `0`
- 折线图有坐标轴但无数据点
- 排行榜显示 "暂无追踪器数据"

---

### Task 6: Commit

- [ ] **Step 1: 提交所有变更**

```bash
git add background/service-worker.js popup/popup.html popup/popup.css popup/popup.js
git commit -m "feat: 新增跨站点历史仪表盘（趋势Tab、SVG折线图、追踪器排行）"
```
