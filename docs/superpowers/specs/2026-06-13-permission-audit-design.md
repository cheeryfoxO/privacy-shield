# 权限审计 — 设计文档

> **目标**：扫描当前页面调用了哪些浏览器敏感权限/API，用红黄绿灯标记风险等级。7 项权限维度 + 调用时机分析。

## 架构

```
content/content-script.js
  │  新增 permission-auditor 模块（内联 IIFE）
  │  document_start 阶段 Monkey-patch 7 个敏感 API 族
  │  记录调用状态 + 首次调用时间戳
  │  页面 load 后发送 PERMISSION_AUDIT 到 background
  │
  ▼
background/service-worker.js
  │  新增 PERMISSION_AUDIT 消息处理 → 存储到 chrome.storage.local
  │
  ▼
popup/popup.js  ─── 新增 renderPermissionTab()
  │  读取审计结果 → 渲染 7 项权限清单 + 摘要
  │
  ▼
popup/popup.html  ─── 新增第六个 tab「🔐 权限」+ 双行 tab 导航
```

## 风险判定规则

- 🔴 **高风险**：API 被调用过，且首次调用发生在页面加载后 3 秒内（自动/悄悄调用）
- 🟡 **中风险**：API 被调用过，首次调用在 3 秒之后
- 🟢 **无风险**：未检测到调用

时间窗口从 `performance.timeOrigin`（页面导航开始）起算。

## 7 个监控的 API

| # | 权限 | Hook 的目标 | 风险说明 |
|---|------|-----------|---------|
| 1 | 📷 摄像头 | `MediaDevices.prototype.getUserMedia`（检测 video 约束） | 偷拍 |
| 2 | 🎤 麦克风 | `MediaDevices.prototype.getUserMedia`（检测 audio 约束） | 窃听 |
| 3 | 📍 位置 | `Geolocation.prototype.getCurrentPosition` + `watchPosition` | 定位追踪 |
| 4 | 🔔 通知 | `Notification.requestPermission` + `Notification` 构造函数 | 垃圾推送 |
| 5 | 📋 剪贴板 | `Clipboard.prototype.readText` + `writeText` + `read` + `write` | 窃取/篡改剪贴板 |
| 6 | 🖥️ 屏幕捕获 | `MediaDevices.prototype.getDisplayMedia` | 录屏 |
| 7 | 💾 永久存储 | `StorageManager.prototype.persist` | 申请永久存储空间（追踪持久化） |

### Monkey-patch 模式

每个 Hook 在 `document_start` 阶段（页面脚本执行前）执行：

```js
// 以 Geolocation 为例
const origGetCurrentPosition = Geolocation.prototype.getCurrentPosition;
Geolocation.prototype.getCurrentPosition = function(success, error, options) {
  reportCall('geo', 'getCurrentPosition', Date.now());
  return origGetCurrentPosition.call(this, success, error, options);
};
```

所有 Hook 记录到一个全局对象 `window.__PRIVACY_PERMISSION_AUDIT`。

## 存储

chrome.storage.local 新增 key：`permissionAudit:{tabId}`

```json
{
  "permissionAudit:123": {
    "url": "https://example.com",
    "timestamp": 1718123456789,
    "calls": [
      { "permission": "geo", "api": "getCurrentPosition", "time": 15234, "risk": "medium" },
      { "permission": "camera", "api": "getUserMedia", "time": 1200, "risk": "high" }
    ]
  }
}
```

time 的单位是页面加载后的毫秒数（相对于 performance.timeOrigin）。

## Popup「🔐 权限」Tab 布局

Tab 导航改为双行（第一行 4 个，第二行 2 个）：

```
│  📊 隐私 │ 🛑 广告 │ 📈 趋势 │ 🖐️ 指纹 │
│  🔗 链接 │ 🔐 权限                     │
```

面板内容（从上到下）：

### 1. 摘要栏

```
⚠️ 检测到 3 项敏感权限调用
🔴 高风险: 1  🟡 中风险: 2  🟢 安全: 4
```

### 2. 7 项权限清单

按风险排序（红 > 黄 > 绿），每项显示：
- 风险灯 + 图标 + 权限名
- 检测状态（"页面加载后 X.Xs 调用"）
- 具体调用的 API 名

每项使用类似手风琴的折叠样式（可展开查看 API 详情）。

空状态：「✅ 未检测到任何敏感权限调用」

## 数据流

```
1. content script 在 document_start 阶段 Hook 7 个 API
2. 页面脚本调用 API → Hook 拦截 → 记录调用信息
3. 页面 load 后 → 发送 PERMISSION_AUDIT 消息 → background 存储
4. 用户打开 popup → 切换到「🔐 权限」tab → 读取存储 → 渲染
```

## 需要修改/新增的文件

| 文件 | 操作 | 说明 |
|------|------|------|
| `content/content-script.js` | 修改 | 新增 permission auditor Monkey-patch 模块 |
| `popup/popup.html` | 修改 | 双行 tab 导航 + 第六个 tab panel |
| `popup/popup.css` | 修改 | 新增权限审计样式 + 双行 tab 样式 |
| `popup/popup.js` | 修改 | 新增 renderPermissionTab() |
| `background/service-worker.js` | 修改 | 新增 PERMISSION_AUDIT 消息处理 |

## 复用现有资产

- Tab 切换逻辑（自动支持第 6 个 tab）
- 暗色模式 CSS 变量
- `escapeHtml()` 工具函数
- `.accordion` / `.accordion-header` 样式
