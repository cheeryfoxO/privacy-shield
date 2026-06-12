# URL 追踪参数清理 — 设计文档

> **目标**：自动检测并剥离 URL 中的追踪参数（fbclid、gclid、utm_*、spm 等 80+ 参数）。用户复制链接时静默清理，popup 展示清理前后对比。

## 架构

```
content/content-script.js
  │  监听 copy 事件 → 检测复制的文本是否为 URL
  │  → 调用 url-cleaner 清理参数 → 写入剪贴板
  │  → 统计被清理的参数 → 发送给 background
  │
  ▼
lib/url-cleaner.js              参数黑名单（80+ 参数）+ URL 解析 + 清理逻辑
  │                              纯函数库，popup 和 content script 共用
  │
  ▼
popup/popup.js                  新增 renderLinkCleanerTab()
  │                              展示清理前后对比 + 一键复制 + 统计
  │
  ▼
popup/popup.html                新增第五个 tab「🔗 链接清理」
```

## 新增/修改文件

| 文件 | 操作 | 说明 |
|------|------|------|
| `lib/url-cleaner.js` | 创建 | URL 清理核心库：黑名单 + 参数剥离 + URL 标准化 |
| `content/content-script.js` | 修改 | 初始化 copy 事件监听，调用 url-cleaner |
| `popup/popup.html` | 修改 | 新增「🔗 链接清理」tab |
| `popup/popup.css` | 修改 | 新增链接清理面板样式 |
| `popup/popup.js` | 修改 | 新增 renderLinkCleanerTab() |
| `background/service-worker.js` | 修改 | 新增 CLEAN_LINK_STATS 消息处理，持久化清理统计 |

## 追踪参数黑名单（80+ 参数）

```js
const TRACKING_PARAMS = [
  // Google / Facebook / Microsoft
  'fbclid', 'gclid', 'gclsrc', 'dclid', 'msclkid', 'twclid',
  '_ga', '_gl', 'gbraid', 'wbraid', 'gad_source', 'gad_medium',
  // UTM
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'utm_id', 'utm_source_platform', 'utm_creative_format',
  'utm_marketing_tactic', 'utm_audience',
  // 淘宝/天猫
  'spm', 'scm', 'ali_trackid', 'ali_refid', 'tracelog', 'lwfrom',
  // 京东
  'jd_pop', 'pps', 'ptag', '_t_t_t',
  // 拼多多
  'refer_page_name', 'refer_page_id', 'refer_page_sn',
  // 抖音/头条
  'enter_from', 'previous_page', 'traffic_source',
  // 知乎
  'zh_forcehybrid', 'utm_oi',
  // B站
  'spm_id_from', 'from_source', 'from_spm_id',
  // 微博
  'sudaref', 'cate_sudaref',
  // Amazon
  'ref_', 'pd_rd_', 'pf_rd_', 'tag',
  // Reddit
  'utm_name', 'utm_term',
  // 通用追踪
  'ref', 'referrer', 'source', 'tracking', 'trk', 'trkCampaign',
  'mc_cid', 'mc_eid', 'mc_tc',
  'hmb_campaign', 'hmb_medium', 'hmb_source',
  'oly_anon_id', 'oly_enc_id',
  'otc', 'oicd',
  'vero_conv', 'vero_id',
  'yclid', '_openstat',
  'wickedid', 'wickedcampaign',
  'igshid', 'si',
  // 国内特有
  'nrs_host', 'nsukey', '__nc_form_id', 'format'
];

// 前缀匹配的参数名（Amazon 等平台的动态参数）
const PREFIX_PARAMS = ['ref_', 'pd_rd_', 'pf_rd_', 'psc_'];
```

## 清理规则

1. 参数名精确匹配（大小写不敏感）
2. `PREFIX_PARAMS` 中的前缀 → `startsWith` 匹配
3. 不修改 URL hash（# 后面的内容）
4. 保留路径、协议、hostname 不变
5. 多个连续 `&` 合并为一个
6. 清理后如果末尾是 `?`，移除 `?`

## Content Script：拦截复制事件

在 `content-script.js` 中注册 `copy` 事件监听：

```js
// 监听 copy 事件，当复制文本是 URL 时自动清理追踪参数
document.addEventListener('copy', (e) => {
  const selection = window.getSelection().toString().trim();
  if (!selection || !isURL(selection)) return;
  
  const cleaned = URLCleaner.clean(selection);
  if (cleaned === selection) return; // 无变更
  
  // 重写剪贴板
  e.preventDefault();
  e.clipboardData.setData('text/plain', cleaned);
  
  // 报告统计
  const removed = URLCleaner.getRemovedParams(selection);
  chrome.runtime.sendMessage({
    type: 'CLEAN_LINK_STATS',
    data: { original: selection, cleaned, removed }
  });
});
```

## Popup「🔗 链接清理」Tab 布局

三个模块从上到下：

### 1. 链接对比区

- 当前页面 URL（追踪参数红色高亮）
- 清理后的 URL（绿色显示）
- 「📋 复制清理后的链接」按钮

### 2. 自动清理开关 + 统计

- Toggle 开关：启用/停用复制时自动清理
- 统计数字：「今日已清理: N 个链接」

### 3. 本次移除的参数列表

- 列出当前页面 URL 中被移除的参数名 + 来源平台标注
- 空数据显示「当前页面无追踪参数 ✅」

## 数据流

```
1. 用户复制含追踪参数的 URL
2. content script copy 事件 → URLCleaner.clean() → 剥离参数
3. e.clipboardData.setData() → 剪贴板得到清理后的链接
4. 发送 CLEAN_LINK_STATS → background 持久化统计
5. 用户打开 popup → 切换到「🔗」tab → 看到清理前后对比
```

## 存储

chrome.storage.local 新增：

```json
{
  "linkCleanStats": {
    "todayDate": "2026-06-12",
    "todayCleaned": 12,
    "totalCleaned": 156
  }
}
```

## 选项

options 页面新增：
- 启用/停用自动清理（默认开启）
- 自定义额外追踪参数（一行一个）

## 复用现有资产

- Tab 切换逻辑（自动支持第 5 个 tab）
- 暗色模式 CSS 变量
- `escapeHtml()` 工具函数
- `.btn` / `.toggle-switch` / `.accordion` 样式
