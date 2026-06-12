# 跨站点历史仪表盘 — 设计文档

> **目标**：为用户提供跨站点隐私趋势视图，展示 7 天隐私评分折线图、统计卡片和追踪器排行榜。

## 架构

```
background/service-worker.js
  │  handlePrivacyReport() 末尾自动调用 recordHistory()
  │
  ▼
chrome.storage.local
  ├── history: [{ domain, score, timestamp, thirdPartyCount, trackerCount, cookieCount, cookieTrackingCount }]
  └── trackerFrequency: { "doubleclick.net": { count, category }, ... }
  │
  ▼
popup/popup.js
  │  renderHistoryTab() 读取数据 → 统计卡片 → SVG 折线图 → 排行列表
  │
  ▼
popup/popup.html
  └── 新增 <div id="tab-trends" class="tab-panel">
```

## 存储设计

### `history` 数组

每条记录对应一次页面访问（一次 PRIVACY_REPORT 处理）：

```json
{
  "domain": "example.com",
  "score": 85,
  "timestamp": 1718123456789,
  "thirdPartyCount": 8,
  "trackerCount": 3,
  "cookieCount": 12,
  "cookieTrackingCount": 5
}
```

**清理策略**：
- 每次写入时删除 7 天前（`Date.now() - 7 * 86400000`）的记录
- 上限 500 条（双重保险，防止极端情况）
- 估算存储量：每条约 200 字节，500 条 = 100KB

### `trackerFrequency` 对象

跨站点聚合已知追踪器出现频次：

```json
{
  "doubleclick.net": { "count": 42, "category": "广告" },
  "google-analytics.com": { "count": 38, "category": "分析" }
}
```

**更新策略**：每次 recordHistory 时合并更新。保留最近 30 天数据（每次合并时检查计数是否过期——简化处理：不清零，随历史记录自然衰减。每 24 小时做一次全量重新统计）。

## Popup UI 布局

新增第三个 tab「📈 趋势」，与其他两个 tab 并列。

```
┌─────────────────────────────────┐
│  📊 隐私评分 │ 🛑 广告拦截 │ 📈 趋势  │
├─────────────────────────────────┤
│                                 │
│  ┌────────┬────────┬─────────┐  │  统计卡片行
│  │ 平均分  │ 访问站点 │ 拦截追踪器 │  │  flexbox 三列
│  │  78    │  24    │   156   │  │
│  │  7天   │  去重   │  30天   │  │
│  └────────┴────────┴─────────┘  │
│                                 │
│  ┌─────────────────────────────┐│  SVG 折线图
│  │  7天隐私趋势               ││  300×160 viewBox
│  │  (SVG 折线图 + 渐变填充)   ││  自适应宽度
│  └─────────────────────────────┘│
│                                 │
│  🔝 最常见追踪器                │  排行列表
│  ┌─────────────────────────────┐│  最多 8 条
│  │ 1. doubleclick.net     42次 ││  带类别标签
│  │ 2. google-analytics.com 38次││
│  │ ...                        ││
│  └─────────────────────────────┘│
│                                 │
│  仅保留最近 7 天数据             │  灰色提示
└─────────────────────────────────┘
```

## SVG 折线图方案

零依赖纯 SVG 手绘，不使用任何图表库。

### 布局参数

| 参数 | 值 |
|------|-----|
| viewBox | `0 0 300 160` |
| 画布内边距 | top: 10, right: 16, bottom: 24, left: 32 |
| 绘图区 | x: 32-284, y: 10-136 |
| Y 轴刻度 | 0, 25, 50, 75, 100 |
| X 轴标签 | 最近 7 天，MM/DD 格式 |
| 数据点半径 | 3.5px |
| 折线宽度 | 2px |
| 折线颜色 | #3b82f6 |

### 绘图元素

- **网格线**：4 条水平虚线，`stroke-dasharray="4,4"`，颜色取 CSS 变量 `--border-color`
- **Y 轴标签**：4 个 `<text>` 元素，font-size 10px，颜色 `--text-muted`
- **X 轴标签**：7 个 `<text>` 元素，font-size 9px，颜色 `--text-muted`
- **数据点**：`<circle>` 元素，蓝色填充 + 白色描边。hover 时 `<title>` 显示 tooltip
- **折线**：`<polyline>`，连接 7 个数据点
- **渐变填充**：`<linearGradient>` + `<polygon>`，从 rgba(59,130,246,0.2) 到 rgba(59,130,246,0)
- **空数据日**：无访问 → 数据点不画，折线在该处断开

### 日均分计算

1. 遍历 `history` 数组
2. 按日期分组（`new Date(h.timestamp).toLocaleDateString()`）
3. 每组求平均分
4. 无数据的日期留空（不补零、不连线）
5. 按日期排序输出 7 个值

## 统计卡片

三个并排卡片，每个包含：

| 卡片 | 数据来源 | 计算方式 |
|------|---------|---------|
| 平均分 | history | `sum(scores) / history.length`，空数据显示 `--` |
| 访问站点 | history | `new Set(domains).size` |
| 拦截追踪器 | trackerFrequency | `sum(count)`，所有追踪器的总出现次数 |

样式：大数字（22px 加粗）+ 小字标签（11px 灰色），整体背景 `--bg-secondary`。

## 追踪器排行榜

- 从 `trackerFrequency` 读取
- 按 `count` 降序排列
- 最多显示 8 条
- 每条显示：序号、域名、类别标签、出现次数
- 空数据显示 "暂无追踪器数据"
- 样式复用 popup 已有的 `.domain-item` 结构

## 数据流

```
1. 用户浏览网页 → content script 检测 → 发送 PRIVACY_REPORT
2. Background: handlePrivacyReport() 聚合 → calculatePrivacyScore()
3. Background: recordHistory() 自动追加
   - 读取现有 history + trackerFrequency
   - 追加新记录
   - 清理 7 天前数据
   - 限制 500 条上限
   - 更新 trackerFrequency
   - 写入 chrome.storage.local
4. 用户打开 popup → 切换到「趋势」tab → renderHistoryTab()
   - 读取 history + trackerFrequency
   - 计算统计卡片值
   - 构建 SVG 折线图
   - 渲染排行榜
```

## 需要修改/新增的文件

| 文件 | 操作 | 说明 |
|------|------|------|
| `background/service-worker.js` | 修改 | 新增 `recordHistory()` 和 `updateTrackerFrequency()` |
| `popup/popup.html` | 修改 | 新增第三个 tab 按钮 + tab-panel 结构 |
| `popup/popup.js` | 修改 | 新增 `renderHistoryTab()`、SVG 折线图渲染等 |
| `popup/popup.css` | 修改 | 新增趋势 tab、统计卡片、图表、排行样式 |
| `lib/storage-manager.js` | 修改 | 新增 `getHistory()`、`getTrackerFrequency()` 方法（或 popup 直接读 storage） |

## SW 休眠兼容

- 所有数据写入 `chrome.storage.local`，Service Worker 休眠后不丢失
- `history` 和 `trackerFrequency` 每次在处理报告时增量更新，不依赖内存状态
- Popup 打开时直接从 storage 读取历史数据，不依赖 Service Worker 保持唤醒
