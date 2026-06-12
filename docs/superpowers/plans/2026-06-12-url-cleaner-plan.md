# URL 追踪参数清理 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 自动检测并剥离 URL 中的 80+ 追踪参数，复制链接时静默清理，popup 展示清理前后对比。

**Architecture:** Content script 监听 copy 事件拦截 URL → 调用 `lib/url-cleaner.js` 剥离参数 → 写入剪贴板 + 上报统计。Popup 展示当前页面 URL 清理前后对比。

**Tech Stack:** 纯 JavaScript (MV3), chrome.storage.local

---

## 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `lib/url-cleaner.js` | 创建 | URL 清理核心库：80+ 参数黑名单 + clean() + getRemovedParams() |
| `content/content-script.js` | 修改 | 新增 copy 事件监听 + URLCleaner 调用 |
| `popup/popup.html` | 修改 | 新增第五个 tab 按钮 + link-cleaner panel |
| `popup/popup.css` | 修改 | 新增链接清理面板样式 |
| `popup/popup.js` | 修改 | 新增 renderLinkCleanerTab() |
| `background/service-worker.js` | 修改 | 新增 CLEAN_LINK_STATS 消息处理 |

---

### Task 1: 创建 URL 清理核心库

**Files:**
- Create: `lib/url-cleaner.js`

- [ ] **Step 1: 创建 `lib/url-cleaner.js`**

```js
/**
 * URL 追踪参数清理器
 * 80+ 追踪参数黑名单，覆盖国内外主流平台
 */

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

const PREFIX_PARAMS = ['ref_', 'pd_rd_', 'pf_rd_', 'psc_'];

// 参数名 → 来源平台映射
const PARAM_SOURCES = {
  'fbclid': 'Facebook', 'gclid': 'Google', 'gclsrc': 'Google',
  'dclid': 'DoubleClick', 'msclkid': 'Microsoft', 'twclid': 'Twitter',
  '_ga': 'Google Analytics', '_gl': 'Google', 'gbraid': 'Google',
  'wbraid': 'Google', 'gad_source': 'Google Ads',
  'utm_source': 'Google Analytics', 'utm_medium': 'Google Analytics',
  'utm_campaign': 'Google Analytics', 'utm_term': 'Google Analytics',
  'utm_content': 'Google Analytics', 'utm_id': 'Google Analytics',
  'spm': '淘宝/天猫', 'scm': '淘宝/天猫', 'ali_trackid': '淘宝/天猫',
  'ali_refid': '淘宝/天猫', 'tracelog': '淘宝', 'lwfrom': '淘宝',
  'jd_pop': '京东', 'pps': '京东', 'ptag': '京东',
  'refer_page_name': '拼多多', 'refer_page_id': '拼多多',
  'enter_from': '抖音', 'previous_page': '抖音', 'traffic_source': '抖音',
  'zh_forcehybrid': '知乎', 'utm_oi': '知乎',
  'spm_id_from': 'B站', 'from_source': 'B站', 'from_spm_id': 'B站',
  'sudaref': '微博', 'cate_sudaref': '微博',
  'tag': 'Amazon', 'ref': '通用', 'referrer': '通用', 'source': '通用',
  'tracking': '通用', 'trk': '通用', 'si': 'Instagram',
  'igshid': 'Instagram', 'yclid': 'Yandex', '__nc_form_id': '国内站点'
};

const URLCleaner = {
  /**
   * 判断文本是否为 URL
   */
  isURL(text) {
    return /^https?:\/\/\S+/i.test(text.trim());
  },

  /**
   * 清理 URL 中的追踪参数
   * @param {string} url
   * @returns {string} 清理后的 URL
   */
  clean(url) {
    if (!url || !this.isURL(url)) return url;

    try {
      const u = new URL(url);
      const searchParams = new URLSearchParams(u.search);
      const removed = [];

      for (const [key] of searchParams) {
        const lowerKey = key.toLowerCase();
        let shouldRemove = false;

        // 精确匹配
        if (TRACKING_PARAMS.includes(lowerKey)) {
          shouldRemove = true;
        }
        // 前缀匹配
        if (!shouldRemove) {
          shouldRemove = PREFIX_PARAMS.some(prefix => lowerKey.startsWith(prefix));
        }

        if (shouldRemove) {
          removed.push(key);
        }
      }

      for (const key of removed) {
        searchParams.delete(key);
      }

      // 重建 URL
      const cleanSearch = searchParams.toString();
      let cleanUrl = u.origin + u.pathname;
      if (cleanSearch) cleanUrl += '?' + cleanSearch;
      if (u.hash) cleanUrl += u.hash;

      return cleanUrl;
    } catch (e) {
      return url;
    }
  },

  /**
   * 获取被移除的参数列表及其来源
   * @param {string} url
   * @returns {Array<{param: string, source: string}>}
   */
  getRemovedParams(url) {
    if (!url || !this.isURL(url)) return [];

    try {
      const u = new URL(url);
      const searchParams = new URLSearchParams(u.search);
      const removed = [];

      for (const [key] of searchParams) {
        const lowerKey = key.toLowerCase();
        let shouldRemove = false;

        if (TRACKING_PARAMS.includes(lowerKey)) {
          shouldRemove = true;
        }
        if (!shouldRemove) {
          shouldRemove = PREFIX_PARAMS.some(prefix => lowerKey.startsWith(prefix));
        }

        if (shouldRemove) {
          removed.push({
            param: key,
            source: PARAM_SOURCES[lowerKey] || '通用'
          });
        }
      }

      return removed;
    } catch (e) {
      return [];
    }
  },

  /**
   * 检查 URL 是否包含追踪参数
   * @param {string} url
   * @returns {boolean}
   */
  hasTrackingParams(url) {
    return this.getRemovedParams(url).length > 0;
  }
};
```

---

### Task 2: Content Script 添加 copy 事件监听

**Files:**
- Modify: `content/content-script.js`

- [ ] **Step 1: 在 content-script.js 末尾（IIFE 内部，`})();` 之前）添加 copy 监听**

在 `console.log('[隐私护盾] 初始化完成');` 之后，`})();` 之前插入：

```js
  // ============================================================
  // URL 追踪参数自动清理（复制拦截）
  // ============================================================
  let linkCleanEnabled = true;

  // 从 storage 读取开关状态
  chrome.storage.sync.get(['linkCleanEnabled'], (result) => {
    if (result.linkCleanEnabled !== undefined) {
      linkCleanEnabled = result.linkCleanEnabled;
    }
  });

  document.addEventListener('copy', (e) => {
    if (!linkCleanEnabled) return;

    const selection = window.getSelection().toString().trim();
    if (!selection || !URLCleaner.isURL(selection)) return;

    const cleaned = URLCleaner.clean(selection);
    if (cleaned === selection) return;

    e.preventDefault();
    e.clipboardData.setData('text/plain', cleaned);

    const removed = URLCleaner.getRemovedParams(selection);
    console.log('[隐私护盾] 已清理复制链接中的 ' + removed.length + ' 个追踪参数:', removed.map(r => r.param).join(', '));

    chrome.runtime.sendMessage({
      type: 'CLEAN_LINK_STATS',
      data: { domain: window.location.hostname, removedCount: removed.length, params: removed }
    }).catch(() => {});
  });
```

**注意**：popup.html 需要加载 `url-cleaner.js`（因为 content script 也需要？不——content script 在 manifest.json 中声明，url-cleaner.js 需要在 content_scripts 的 js 数组中加入，或者 content-script.js 中通过动态注入加载）。

**简化方案**：将 URLCleaner 代码直接 inline 到 content-script.js 中，避免额外的文件加载复杂度。

- [ ] **Step 2: 实际采用 inline 方案** — 将 Task 1 的 URLCleaner 代码整合进 content-script.js，同时 popup.html 引入独立的 `url-cleaner.js`。

后续实施时：content-script.js 中内联一个轻量版 `cleanURL()` 函数；popup 使用独立的 `lib/url-cleaner.js`。

---

### Task 3: Popup HTML 结构

**Files:**
- Modify: `popup/popup.html`

- [ ] **Step 1: 新增第五个 tab 按钮**

在 fingerprint tab 按钮之后追加：
```html
    <button class="tab-btn" data-tab="linkclean">🔗 链接清理</button>
```

- [ ] **Step 2: 新增链接清理面板（在指纹面板之后、overlay 之前）**

```html
  <!-- ====== 链接清理面板 ====== -->
  <div class="tab-panel" id="tab-linkclean">

    <!-- 链接对比区 -->
    <section class="lc-section">
      <label class="lc-section-label">当前页面链接</label>
      <div class="lc-url-box">
        <div class="lc-url-original" id="lcOriginalUrl"></div>
      </div>

      <div class="lc-arrow">⬇ 清理后</div>

      <div class="lc-url-box lc-url-box-clean">
        <div class="lc-url-cleaned" id="lcCleanedUrl"></div>
      </div>

      <button class="btn btn-primary lc-copy-btn" id="lcCopyBtn">📋 复制清理后的链接</button>
      <p class="lc-copy-hint" id="lcCopyHint" style="display:none;">✅ 已复制!</p>
    </section>

    <!-- 自动清理开关 + 统计 -->
    <section class="lc-section">
      <div class="lc-switch-row">
        <span class="lc-switch-label">🛡️ 复制时自动清理追踪参数</span>
        <label class="toggle-row" style="border:none;padding:0;">
          <input type="checkbox" id="lcAutoCleanToggle" checked>
          <span class="toggle-switch"></span>
        </label>
      </div>
      <div class="lc-stats">
        <span class="lc-stats-text">今日已清理: <strong id="lcTodayCleaned">0</strong> 个链接</span>
      </div>
    </section>

    <!-- 移除的参数列表 -->
    <section class="lc-section">
      <label class="lc-section-label">本次移除的追踪参数</label>
      <div class="lc-param-list" id="lcParamList">
        <p class="empty-hint">正在检测...</p>
      </div>
    </section>

    <!-- 底部提示 -->
    <section class="trend-footer">
      <span class="trend-footer-text">覆盖 Facebook、Google、淘宝、京东等 80+ 追踪参数</span>
    </section>

  </div>
  <!-- ====== 链接清理面板 END ====== -->
```

- [ ] **Step 3: 加载 url-cleaner.js**

在 `<script src="popup.js"></script>` 之前添加：
```html
  <script src="../lib/url-cleaner.js"></script>
```

---

### Task 4: Popup CSS 样式

**Files:**
- Modify: `popup/popup.css`

- [ ] **Step 1: 在 popup.css 末尾追加链接清理面板样式**

```css
/* ============================================================
   链接清理面板
   ============================================================ */

.lc-section {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color);
}

.lc-section:last-child {
  border-bottom: none;
}

.lc-section-label {
  display: block;
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 8px;
}

.lc-url-box {
  background: var(--bg-secondary);
  border-radius: var(--radius-sm);
  padding: 10px 12px;
  word-break: break-all;
  font-family: monospace;
  font-size: 11px;
  line-height: 1.6;
  max-height: 80px;
  overflow-y: auto;
}

.lc-url-box-clean {
  border: 1px solid #22c55e;
}

.lc-url-original {
  color: var(--text-secondary);
}

.lc-url-original .tracking-param {
  color: var(--color-red);
  background: var(--color-red-bg);
  padding: 1px 3px;
  border-radius: 2px;
}

.lc-url-cleaned {
  color: #22c55e;
}

.lc-arrow {
  text-align: center;
  font-size: 14px;
  padding: 6px 0;
  color: var(--text-muted);
}

.lc-copy-btn {
  margin-top: 8px;
  width: 100%;
}

.lc-copy-hint {
  text-align: center;
  font-size: 12px;
  color: #22c55e;
  margin-top: 6px;
}

.lc-switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.lc-switch-label {
  font-size: 13px;
  font-weight: 600;
}

.lc-stats {
  margin-top: 8px;
  padding: 8px 10px;
  background: var(--bg-secondary);
  border-radius: var(--radius-sm);
}

.lc-stats-text {
  font-size: 12px;
  color: var(--text-secondary);
}

.lc-stats-text strong {
  color: #3b82f6;
  font-size: 16px;
}

.lc-param-list {
  max-height: 150px;
  overflow-y: auto;
}

.lc-param-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 0;
  border-bottom: 1px solid var(--border-color);
  font-size: 11px;
}

.lc-param-item:last-child {
  border-bottom: none;
}

.lc-param-name {
  font-family: monospace;
  font-weight: 600;
  color: var(--color-red);
}

.lc-param-source {
  font-size: 10px;
  color: var(--text-muted);
  background: var(--bg-hover);
  padding: 1px 6px;
  border-radius: 3px;
  margin-left: auto;
}
```

---

### Task 5: Popup JS 渲染逻辑

**Files:**
- Modify: `popup/popup.js`

- [ ] **Step 1: 在 init() 中追加链接清理面板初始化**

找到 `await renderFingerprintTab();`，在其后追加：
```js
  // 初始化链接清理面板
  await renderLinkCleanerTab(tab);
```

- [ ] **Step 2: 在 popup.js 末尾追加链接清理面板函数**

```js
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
    const regex = new RegExp(`([?&])(${escaped}=[^&#]*)`, 'gi');
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
  // 自动清理开关
  const toggle = document.getElementById('lcAutoCleanToggle');
  if (toggle) {
    chrome.storage.sync.get(['linkCleanEnabled'], (result) => {
      toggle.checked = result.linkCleanEnabled !== false;
    });
    toggle.addEventListener('change', () => {
      chrome.storage.sync.set({ linkCleanEnabled: toggle.checked });
    });
  }

  // 复制清理后的链接
  const copyBtn = document.getElementById('lcCopyBtn');
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      const cleaned = URLCleaner.clean(originalUrl);
      try {
        await navigator.clipboard.writeText(cleaned);
        const hint = document.getElementById('lcCopyHint');
        if (hint) { hint.style.display = 'block'; setTimeout(() => { hint.style.display = 'none'; }, 2000); }
      } catch (e) {
        // fallback
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
```

---

### Task 6: Background 统计处理

**Files:**
- Modify: `background/service-worker.js`

- [ ] **Step 1: 在消息处理 switch 中新增 CLEAN_LINK_STATS case**

在 `handleMessage` 函数的 switch 中添加（与其他 case 并列）：

```js
    case 'CLEAN_LINK_STATS':
      handleCleanLinkStats(message.data, sendResponse);
      break;
```

- [ ] **Step 2: 新增 handleCleanLinkStats 函数**

在 background/service-worker.js 末尾合适位置添加：

```js
// ============================================================
// 链接清理统计
// ============================================================

async function handleCleanLinkStats(data, sendResponse) {
  try {
    const { linkCleanStats } = await chrome.storage.local.get(['linkCleanStats']);
    const today = new Date().toDateString();

    const stats = linkCleanStats && linkCleanStats.todayDate === today
      ? linkCleanStats
      : { todayDate: today, todayCleaned: 0, totalCleaned: (linkCleanStats?.totalCleaned || 0) };

    stats.todayCleaned++;
    stats.totalCleaned = (stats.totalCleaned || 0) + 1;

    await chrome.storage.local.set({ linkCleanStats: stats });
  } catch (e) {
    console.error('[链接清理] 统计保存失败:', e);
  }
  sendResponse({ received: true });
}
```

---

### Task 7: Content Script 中内联 URLCleaner

**Files:**
- Modify: `content/content-script.js`

因为 content script 不能直接引用 `lib/url-cleaner.js`（需要改 manifest.json），实际实施时采用以下方案：

- 在 `content/content-script.js` 中内联一个轻量版 `cleanURL()` 和 `isURL()` 函数（约 30 行）
- popup 使用独立的 `lib/url-cleaner.js`（完整版，含 `getRemovedParams()`）

内联代码放在 content-script.js 的 IIFE 内部：

```js
  // ============================================================
  // 内联 URL 清理（轻量版，避免额外文件加载）
  // ============================================================

  const TRACKING_PARAMS_SET = new Set([
    'fbclid','gclid','gclsrc','dclid','msclkid','twclid',
    '_ga','_gl','gbraid','wbraid','gad_source','gad_medium',
    'utm_source','utm_medium','utm_campaign','utm_term','utm_content',
    'utm_id','utm_source_platform','utm_creative_format',
    'utm_marketing_tactic','utm_audience',
    'spm','scm','ali_trackid','ali_refid','tracelog','lwfrom',
    'jd_pop','pps','ptag','_t_t_t',
    'refer_page_name','refer_page_id','refer_page_sn',
    'enter_from','previous_page','traffic_source',
    'zh_forcehybrid','utm_oi',
    'spm_id_from','from_source','from_spm_id',
    'sudaref','cate_sudaref',
    'ref_','pd_rd_','pf_rd_','tag',
    'utm_name','utm_term',
    'ref','referrer','source','tracking','trk','trkCampaign',
    'mc_cid','mc_eid','mc_tc',
    'hmb_campaign','hmb_medium','hmb_source',
    'oly_anon_id','oly_enc_id','otc','oicd',
    'vero_conv','vero_id','yclid','_openstat',
    'wickedid','wickedcampaign','igshid','si',
    'nrs_host','nsukey','__nc_form_id','format'
  ]);

  const PREFIX_PARAMS_LIST = ['ref_', 'pd_rd_', 'pf_rd_', 'psc_'];

  function isURL(text) {
    return /^https?:\/\/\S+/i.test(text.trim());
  }

  function cleanURLInPlace(url) {
    if (!url) return url;
    try {
      const u = new URL(url);
      const sp = new URLSearchParams(u.search);
      const toRemove = [];
      for (const [key] of sp) {
        const lk = key.toLowerCase();
        if (TRACKING_PARAMS_SET.has(lk) || PREFIX_PARAMS_LIST.some(p => lk.startsWith(p))) {
          toRemove.push(key);
        }
      }
      for (const k of toRemove) sp.delete(k);
      const cleanSearch = sp.toString();
      let result = u.origin + u.pathname;
      if (cleanSearch) result += '?' + cleanSearch;
      if (u.hash) result += u.hash;
      return result;
    } catch (e) { return url; }
  }
```

---

### Task 8: 集成验证

- [ ] **Step 1: 重新加载插件**

在 `chrome://extensions` 刷新隐私护盾。

- [ ] **Step 2: 测试复制清理**

1. 打开一个带追踪参数的链接，比如：
   `https://www.example.com/page?fbclid=test123&utm_source=facebook&spm=abc`
2. 选中地址栏 URL 并 Ctrl+C 复制
3. 粘贴到记事本 → 应该只有 `https://www.example.com/page`
4. 打开 popup → 切换到「🔗 链接清理」tab
5. 检查：原始 URL 显示红色高亮参数，清理后 URL 显示绿色
6. 点击「📋 复制清理后的链接」按钮
7. 测试开关：关闭 toggle，复制原始 URL → 不应被清理

---

### Task 9: Commit

- [ ] **Step 1: 提交所有变更**

```bash
git add lib/url-cleaner.js content/content-script.js popup/popup.html popup/popup.css popup/popup.js background/service-worker.js
git commit -m "feat: 新增URL追踪参数自动清理（80+参数黑名单+复制拦截）"
```
