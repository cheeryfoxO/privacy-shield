# 权限审计 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为隐私护盾新增第六个 tab「🔐 权限」，扫描当前页面调用了哪些浏览器敏感 API，红黄绿灯标记风险等级。

**Architecture:** Content script 在 document_start 阶段 Monkey-patch 7 个敏感 API 族，记录调用状态和时间戳，页面加载后发送审计结果到 background，popup 读取并渲染权限清单。

**Tech Stack:** 纯 JavaScript (MV3), Monkey-patch, chrome.storage.local

---

## 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `content/content-script.js` | 修改 | 新增 permission auditor Monkey-patch 模块（7 个 API 族） |
| `popup/popup.html` | 修改 | 双行 tab 导航 + 第六个 tab panel |
| `popup/popup.css` | 修改 | 双行 tab 样式 + 权限审计样式 |
| `popup/popup.js` | 修改 | 新增 renderPermissionTab() |
| `background/service-worker.js` | 修改 | 新增 PERMISSION_AUDIT 消息处理 |

---

### Task 1: Content Script 权限 Monkey-patch

**Files:**
- Modify: `content/content-script.js`

- [ ] **Step 1: 在 content-script.js 的 IIFE 内部、copy 事件监听之前，添加 permission auditor**

找到 `// ============================================================\n  // 内联 URL 清理` 注释，在其**之前**插入以下完整代码：

```js
  // ============================================================
  // 权限审计 Monkey-patch（document_start 阶段执行）
  // ============================================================

  const permissionAudit = {
    calls: [],
    _report(permission, api, detail) {
      const entry = {
        permission, api, detail,
        time: Date.now() - performance.timeOrigin
      };
      this.calls.push(entry);
    }
  };

  // Hook 辅助函数
  function hookMethod(obj, prop, permission, api, getDetail) {
    try {
      const orig = obj[prop];
      if (typeof orig !== 'function') return;
      obj[prop] = function(...args) {
        const detail = getDetail ? getDetail(args) : '';
        permissionAudit._report(permission, api, detail);
        return orig.apply(this, args);
      };
    } catch (e) {}
  }

  // ---- 1 & 2: 摄像头/麦克风 ----
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    const origGetUserMedia = MediaDevices.prototype.getUserMedia;
    MediaDevices.prototype.getUserMedia = function(constraints) {
      const hasVideo = constraints && constraints.video !== undefined && constraints.video !== false;
      const hasAudio = constraints && constraints.audio !== undefined && constraints.audio !== false;
      if (hasVideo) permissionAudit._report('camera', 'getUserMedia', 'video');
      if (hasAudio) permissionAudit._report('mic', 'getUserMedia', 'audio');
      return origGetUserMedia.call(this, constraints);
    };
  }

  // ---- 3: 位置 ----
  if (navigator.geolocation) {
    const origGetPos = Geolocation.prototype.getCurrentPosition;
    Geolocation.prototype.getCurrentPosition = function(success, error, options) {
      permissionAudit._report('geo', 'getCurrentPosition', '');
      return origGetPos.call(this, success, error, options);
    };
    const origWatch = Geolocation.prototype.watchPosition;
    Geolocation.prototype.watchPosition = function(success, error, options) {
      permissionAudit._report('geo', 'watchPosition', '');
      return origWatch.call(this, success, error, options);
    };
  }

  // ---- 4: 通知 ----
  if (window.Notification) {
    const origReq = Notification.requestPermission;
    Notification.requestPermission = function(callback) {
      permissionAudit._report('notification', 'requestPermission', '');
      const result = origReq.call(this, callback);
      if (result && result.then) return result; else return Promise.resolve(result);
    };
    const OrigNotification = window.Notification;
    window.Notification = function(title, options) {
      permissionAudit._report('notification', 'new Notification', title || '');
      return new OrigNotification(title, options);
    };
    window.Notification.prototype = OrigNotification.prototype;
  }

  // ---- 5: 剪贴板 ----
  if (navigator.clipboard) {
    const methods = ['readText', 'writeText', 'read', 'write'];
    for (const m of methods) {
      const orig = navigator.clipboard[m];
      if (typeof orig === 'function') {
        navigator.clipboard[m] = function(...args) {
          permissionAudit._report('clipboard', m, '');
          return orig.apply(this, args);
        };
      }
    }
  }

  // ---- 6: 屏幕捕获 ----
  if (navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) {
    const origGDM = MediaDevices.prototype.getDisplayMedia;
    MediaDevices.prototype.getDisplayMedia = function(constraints) {
      permissionAudit._report('screen', 'getDisplayMedia', '');
      return origGDM.call(this, constraints);
    };
  }

  // ---- 7: 永久存储 ----
  if (navigator.storage && navigator.storage.persist) {
    const origPersist = StorageManager.prototype.persist;
    StorageManager.prototype.persist = function() {
      permissionAudit._report('storage', 'persist', '');
      return origPersist.call(this);
    };
  }

  // ---- 发送审计结果到 background ----
  function sendPermissionAudit() {
    const riskLevel = (entry) => {
      if (entry.time < 0) return 'low';        // 异常时间，忽略
      if (entry.time <= 3000) return 'high';    // 3秒内 = 高风险
      return 'medium';                          // 3秒后 = 中风险
    };

    const report = permissionAudit.calls.map(c => ({
      ...c,
      risk: riskLevel(c)
    }));

    chrome.runtime.sendMessage({
      type: 'PERMISSION_AUDIT',
      data: { url: window.location.href, calls: report }
    }).catch(() => {});
  }

  // 页面加载后发送
  if (document.readyState === 'complete') {
    setTimeout(sendPermissionAudit, 3000);
  } else {
    window.addEventListener('load', () => {
      setTimeout(sendPermissionAudit, 3000);
    });
  }
```

---

### Task 2: Popup HTML 结构

**Files:**
- Modify: `popup/popup.html`

- [ ] **Step 1: 双行 tab 导航**

将现有的单行 tab-nav 改为双行布局——不需要改 HTML 结构，只改 CSS（Task 3）。但需要让 tab 按钮的父元素支持 flex-wrap。

- [ ] **Step 2: 新增第六个 tab 按钮**

在 `linkclean` tab 按钮之后追加：
```html
    <button class="tab-btn" data-tab="permission">🔐 权限</button>
```

- [ ] **Step 3: 新增权限面板（在链接清理面板之后、overlay 之前）**

```html
  <!-- ====== 权限审计面板 ====== -->
  <div class="tab-panel" id="tab-permission">

    <!-- 摘要栏 -->
    <section class="perm-summary" id="permSummary">
      <div class="perm-summary-icon">⏳</div>
      <div class="perm-summary-text">正在检测权限调用...</div>
    </section>

    <!-- 权限清单 -->
    <section class="perm-list-section">
      <div class="perm-list" id="permList"></div>
    </section>

    <!-- 底部提示 -->
    <section class="trend-footer">
      <span class="trend-footer-text">仅对当前页面有效 · 刷新后重置</span>
    </section>

  </div>
  <!-- ====== 权限审计面板 END ====== -->
```

---

### Task 3: Popup CSS 样式

**Files:**
- Modify: `popup/popup.css`

- [ ] **Step 1: 双行 tab 导航样式**

修改 `.tab-nav`：
```css
.tab-nav {
  display: flex;
  flex-wrap: wrap;
  border-bottom: 2px solid var(--border-color);
  padding: 0 4px;
}
```
修改 `.tab-btn`：
```css
.tab-btn {
  flex: 0 0 auto;
  min-width: fit-content;
  padding: 8px 6px;
  border: none;
  background: none;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  color: var(--text-muted);
  border-bottom: 2px solid transparent;
  margin-bottom: -2px;
  transition: all 0.15s ease;
  font-family: inherit;
}
```

- [ ] **Step 2: 权限审计面板样式**（追加到文件末尾）

```css
/* ============================================================
   权限审计面板
   ============================================================ */

.perm-summary {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
  background: var(--bg-secondary);
  margin: 12px 16px;
  border-radius: var(--radius-sm);
}

.perm-summary.warn {
  background: var(--color-yellow-bg);
  border: 1px solid var(--color-yellow);
}

.perm-summary.danger {
  background: var(--color-red-bg);
  border: 1px solid var(--color-red);
}

.perm-summary-icon {
  font-size: 24px;
}

.perm-summary-text {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.perm-summary-sub {
  font-size: 11px;
  color: var(--text-secondary);
  margin-top: 2px;
}

.perm-list-section {
  padding: 0 12px 8px;
}

.perm-item {
  margin-bottom: 4px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  background: var(--bg-secondary);
  overflow: hidden;
}

.perm-item[open] {
  background: var(--bg-primary);
}

.perm-item-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  cursor: pointer;
  user-select: none;
  list-style: none;
}

.perm-item-header::-webkit-details-marker {
  display: none;
}

.perm-item-header:hover {
  background: var(--bg-hover);
}

.perm-risk-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.perm-risk-dot.high { background: #ef4444; }
.perm-risk-dot.medium { background: #eab308; }
.perm-risk-dot.low { background: #22c55e; }

.perm-item-icon {
  font-size: 16px;
}

.perm-item-name {
  font-size: 12px;
  font-weight: 600;
}

.perm-item-status {
  font-size: 11px;
  color: var(--text-secondary);
  margin-left: auto;
}

.perm-item-body {
  padding: 0 12px 10px;
  border-top: 1px solid var(--border-color);
  margin: 0 8px;
  font-size: 11px;
}

.perm-detail-row {
  display: flex;
  justify-content: space-between;
  padding: 3px 0;
}

.perm-detail-label {
  color: var(--text-muted);
}

.perm-detail-value {
  color: var(--text-primary);
  font-family: monospace;
}
```

---

### Task 4: Popup JS 渲染逻辑

**Files:**
- Modify: `popup/popup.js`

- [ ] **Step 1: 在 init() 中追加权限面板初始化**

```js
  // 初始化权限面板
  await renderPermissionTab(tab.id);
```

- [ ] **Step 2: 在 popup.js 末尾追加权限面板函数**

```js
// ============================================================
// 权限审计面板
// ============================================================

const PERMISSION_LIST = [
  { id: 'camera', name: '摄像头', icon: '📷', desc: '检测 getUserMedia({video}) 调用' },
  { id: 'mic', name: '麦克风', icon: '🎤', desc: '检测 getUserMedia({audio}) 调用' },
  { id: 'geo', name: '位置', icon: '📍', desc: '检测 getCurrentPosition/watchPosition 调用' },
  { id: 'notification', name: '通知', icon: '🔔', desc: '检测 Notification API 调用' },
  { id: 'clipboard', name: '剪贴板', icon: '📋', desc: '检测 clipboard.read/write 调用' },
  { id: 'screen', name: '屏幕捕获', icon: '🖥️', desc: '检测 getDisplayMedia 调用' },
  { id: 'storage', name: '永久存储', icon: '💾', desc: '检测 storage.persist() 调用' }
];

async function renderPermissionTab(tabId) {
  try {
    const key = `permissionAudit:${tabId}`;
    const result = await chrome.storage.local.get([key]);
    const audit = result[key];

    if (!audit || !audit.calls || audit.calls.length === 0) {
      renderPermissionEmpty();
      return;
    }

    renderPermissionSummary(audit.calls);
    renderPermissionItems(audit.calls);
  } catch (e) {
    console.error('[权限审计] 渲染失败:', e);
    renderPermissionEmpty();
  }
}

function renderPermissionEmpty() {
  const summary = document.getElementById('permSummary');
  summary.className = 'perm-summary';
  summary.innerHTML = '<div class="perm-summary-icon">✅</div><div><div class="perm-summary-text">未检测到敏感权限调用</div><div class="perm-summary-sub">7 项权限均安全</div></div>';

  const listEl = document.getElementById('permList');
  listEl.innerHTML = PERMISSION_LIST.map(p => `
    <div class="perm-item">
      <div class="perm-item-header">
        <span class="perm-risk-dot low"></span>
        <span class="perm-item-icon">${p.icon}</span>
        <span class="perm-item-name">${p.name}</span>
        <span class="perm-item-status">未调用</span>
      </div>
    </div>
  `).join('');
}

function renderPermissionSummary(calls) {
  const highCount = calls.filter(c => c.risk === 'high').length;
  const mediumCount = calls.filter(c => c.risk === 'medium').length;
  const total = calls.length;
  const cls = highCount > 0 ? 'danger' : mediumCount > 0 ? 'warn' : '';

  const summary = document.getElementById('permSummary');
  summary.className = 'perm-summary ' + cls;
  summary.innerHTML = `
    <div class="perm-summary-icon">${highCount > 0 ? '🚨' : '⚠️'}</div>
    <div>
      <div class="perm-summary-text">检测到 ${total} 项敏感权限调用</div>
      <div class="perm-summary-sub">🔴 高风险: ${highCount}  🟡 中风险: ${mediumCount}  🟢 安全: ${7 - total}</div>
    </div>`;
}

function renderPermissionItems(calls) {
  const listEl = document.getElementById('permList');
  if (!listEl) return;

  const calledMap = new Map();
  for (const c of calls) {
    if (!calledMap.has(c.permission) || c.risk === 'high') {
      calledMap.set(c.permission, c);
    }
  }

  const riskOrder = { high: 0, medium: 1, low: 2 };
  const sorted = [...PERMISSION_LIST].sort((a, b) => {
    const ca = calledMap.get(a.id);
    const cb = calledMap.get(b.id);
    const ra = ca ? riskOrder[ca.risk] : 2;
    const rb = cb ? riskOrder[cb.risk] : 2;
    return ra - rb;
  });

  listEl.innerHTML = sorted.map(p => {
    const call = calledMap.get(p.id);
    if (!call) {
      return `<div class="perm-item">
        <div class="perm-item-header">
          <span class="perm-risk-dot low"></span>
          <span class="perm-item-icon">${p.icon}</span>
          <span class="perm-item-name">${p.name}</span>
          <span class="perm-item-status">未调用</span>
        </div>
      </div>`;
    }

    const riskLabel = call.risk === 'high' ? '高风险' : '中风险';
    const timeLabel = call.time ? `${(call.time / 1000).toFixed(1)}s` : '未知';

    return `<details class="perm-item">
      <summary class="perm-item-header">
        <span class="perm-risk-dot ${call.risk}"></span>
        <span class="perm-item-icon">${p.icon}</span>
        <span class="perm-item-name">${escapeHtml(p.name)}</span>
        <span class="perm-item-status">${riskLabel} · ${timeLabel}</span>
      </summary>
      <div class="perm-item-body">
        <div class="perm-detail-row">
          <span class="perm-detail-label">API:</span>
          <span class="perm-detail-value">${escapeHtml(call.api)}</span>
        </div>
        <div class="perm-detail-row">
          <span class="perm-detail-label">调用时机:</span>
          <span class="perm-detail-value">页面加载后 ${timeLabel}</span>
        </div>
        <div class="perm-detail-row">
          <span class="perm-detail-label">说明:</span>
          <span class="perm-detail-value">${escapeHtml(p.desc)}</span>
        </div>
      </div>
    </details>`;
  }).join('');
}
```

---

### Task 5: Background 消息处理

**Files:**
- Modify: `background/service-worker.js`

- [ ] **Step 1: 在 handleMessage switch 中新增 PERMISSION_AUDIT case**

```js
    case 'PERMISSION_AUDIT':
      handlePermissionAudit(message.data, sender, sendResponse);
      break;
```

- [ ] **Step 2: 新增 handlePermissionAudit 函数**

```js
// ============================================================
// 权限审计
// ============================================================

async function handlePermissionAudit(data, sender, sendResponse) {
  try {
    const tabId = sender.tab ? sender.tab.id : null;
    if (!tabId) { sendResponse({ received: true }); return; }

    const key = `permissionAudit:${tabId}`;
    await chrome.storage.local.set({
      [key]: {
        url: data.url,
        timestamp: Date.now(),
        calls: data.calls
      }
    });
  } catch (e) {
    console.error('[权限审计] 存储失败:', e);
  }
  sendResponse({ received: true });
}
```

---

### Task 6: 集成验证

- [ ] **Step 1: 重新加载插件**

打开 `chrome://extensions`，刷新隐私护盾。

- [ ] **Step 2: 测试权限检测**

1. 访问 `https://browserleaks.com/webrtc`（该站会请求摄像头/麦克风权限）
2. 点插件图标 → 切换到「🔐 权限」tab
3. 应该检测到摄像头和麦克风的权限调用
4. 访问一个普通网站（如 Wikipedia）→ 权限 tab 应显示全部绿色

- [ ] **Step 3: 验证 tab 导航**

确保 6 个 tab 在双行布局下正常切换。

---

### Task 7: Commit

- [ ] **Step 1: 提交**

```bash
git add content/content-script.js popup/popup.html popup/popup.css popup/popup.js background/service-worker.js
git commit -m "feat: 新增权限审计面板（7项敏感API监控+红黄绿风险灯）"
```
