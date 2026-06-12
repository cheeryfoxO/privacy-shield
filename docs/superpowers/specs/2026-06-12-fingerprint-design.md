# 浏览器指纹一览 — 设计文档

> **目标**：展示用户当前浏览器的真实指纹信息，让用户了解自己的浏览器有多"独特"、多容易被追踪。8 个维度 + 熵值量化。

## 架构

```
popup/popup.js  ───  新增 renderFingerprintTab()
  │                    在 popup 上下文中直接采集所有指纹
  │                    navigator / screen / WebGL / AudioContext / Canvas
  │
  ▼                    无新 content script，无 background 依赖
  │                    全部数据仅在 popup 打开时实时采集
  │
lib/fingerprint-collector.js   指纹采集器独立模块
```

**设计原则**：所有指纹在 popup 自身上下文采集，不需要注入页面。90% 的指纹（UA、屏幕、时区、WebGL、AudioContext、Canvas、硬件并发）popup 直接可用，字体通过 `document.fonts` 检测。

## 新增文件

| 文件 | 操作 | 说明 |
|------|------|------|
| `lib/fingerprint-collector.js` | 创建 | 指纹采集器，8 个维度采集函数 + 常见值库 |
| `popup/popup.html` | 修改 | 新增第四个 tab 按钮 + fingerprint panel |
| `popup/popup.css` | 修改 | 新增指纹面板样式 |
| `popup/popup.js` | 修改 | 新增 `renderFingerprintTab()` + 渲染函数 |
| `_locales/zh_CN/messages.json` | 修改 | 新增指纹相关 i18n 字符串 |

## Popup UI 布局

新增第四个 tab「🖐️ 指纹」：

```
┌─────────────────────────────────┐
│  📊 隐私 │ 🛑 广告 │ 📈 趋势 │ 🖐️ 指纹 │
├─────────────────────────────────┤
│                                 │
│  综合熵值: ~18.5 bits           │
│  ████████████░░░░░░░░  偏高    │
│                                 │
│  ┌─────────────────────────────┐│
│  │ 🟢 User-Agent         ▼    ││  ← <details> 手风琴
│  │    Mozilla/5.0 ...          ││
│  │ 🟡 屏幕 & 视口        ▼    ││
│  │    1920×1080 · 24bit · 1x ││
│  │ 🔴 已安装字体 (48款)  ▼    ││
│  │    Arial, Calibri, ...      ││
│  │ 🟢 时区               ▼    ││
│  │    Asia/Shanghai            ││
│  │ 🟡 WebGL              ▼    ││
│  │    ANGLE (NVIDIA ...)       ││
│  │ 🟡 AudioContext       ▼    ││
│  │    采样率 48000 · 2通道    ││
│  │ 🟡 Canvas 指纹        ▼    ││
│  │    样本 hash: a3f8b2c...   ││
│  │ 🟢 硬件并发           ▼    ││
│  │    16 核                    ││
│  └─────────────────────────────┘│
└─────────────────────────────────┘
```

## 8 个指纹维度

### 1. User-Agent

采集：`navigator.userAgent` + `navigator.platform` + `navigator.languages` + `navigator.hardwareConcurrency`

独特性判定：
- 常见 🟢：主流浏览器（Chrome/Edge/Firefox/Safari 最近 3 个大版本）+ 主流 OS（Windows 10/11, macOS）
- 不常见 🟡：小众浏览器/旧版本/Linux
- 唯一 🔴：极其罕见的 UA 字符串

熵值：常见 2-4 bits，不常见 5-8 bits，唯一 9-12 bits

### 2. 屏幕 & 视口

采集：`screen.width/height` + `screen.colorDepth` + `devicePixelRatio` + `screen.availWidth/availHeight` + `window.innerWidth/innerHeight`

独特性判定（内置常见分辨率列表）：
- 常见 🟢：1920×1080, 2560×1440, 1366×768, 1536×864, 1440×900（前 5 常见）
- 不常见 🟡：3840×2160, 1280×720 等不在前 5 的
- 唯一 🔴：不在常见列表中的罕见分辨率

熵值：常见 1-2 bits，不常见 3-5 bits，唯一 6-8 bits

### 3. 时区

采集：`Intl.DateTimeFormat().resolvedOptions().timeZone`

独特性判定：
- 常见 🟢：Asia/Shanghai, America/New_York, America/Chicago, America/Los_Angeles, Europe/London, Europe/Berlin, Asia/Tokyo 等（覆盖 80%+ 互联网人口）
- 不常见 🟡：半小时偏移时区（如 Asia/Kolkata, Australia/Adelaide）
- 唯一 🔴：罕见时区

熵值：常见 0-1 bits，不常见 2-3 bits，唯一 4-5 bits

### 4. 字体列表

采集：用 120 款已知常见字体的列表，通过 `document.fonts.check('12px "FontName"')` 逐个检测。

阈值：
- 常见 🟢：< 50 款已安装字体（达到常见系统默认值）
- 不常见 🟡：50-150 款（安装了 Office、Adobe 等套件）
- 唯一 🔴：> 150 款（设计师/开发者，安装了大量字体）

熵值：常见 3-5 bits，不常见 6-10 bits，唯一 11-16 bits

### 5. WebGL

采集：
```js
const canvas = document.createElement('canvas');
const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
debugInfo.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);  // GPU 型号
debugInfo.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL);    // 厂商
```

独特性判定（内置常见 GPU 列表）：
- 常见 🟢：Intel UHD/Iris, NVIDIA GeForce RTX 3060/4060, AMD Radeon 集成显卡（覆盖 80%+）
- 不常见 🟡：其他独立显卡/旧型号
- 唯一 🔴：罕见 GPU/专业显卡

熵值：常见 2-3 bits，不常见 4-6 bits，唯一 7-10 bits

### 6. AudioContext

采集：
```js
const ctx = new (window.AudioContext || window.webkitAudioContext)();
ctx.sampleRate;          // 采样率
ctx.destination.maxChannelCount;  // 最大通道数
ctx.baseLatency;         // 基础延迟
ctx.outputLatency;       // 输出延迟
```

独特性判定：
- 常见 🟢：采样率 44100/48000，2 通道（最普遍组合）
- 不常见 🟡：非标采样率或非 2 通道
- 唯一 🔴：非常见组合

熵值：常见 1-2 bits，不常见 3-5 bits，唯一 6-8 bits

### 7. Canvas 哈希

采集：在离屏 canvas 绘制测试文本 + 图形 → toDataURL() → CRC32 哈希

```js
const canvas = document.createElement('canvas');
canvas.width = 280; canvas.height = 60;
const ctx = canvas.getContext('2d');
ctx.textBaseline = 'top';
ctx.font = '14px Arial';
ctx.fillStyle = '#f60';
ctx.fillRect(125, 1, 62, 20);
ctx.fillStyle = '#069';
ctx.fillText('BrowserLeaks,com <canvas> 1.0', 2, 15);
ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
ctx.fillText('BrowserLeaks,com <canvas> 1.0', 4, 17);
const hash = crc32(canvas.toDataURL());
```

独特性判定：同一浏览器同 OS 下哈希相同，但不同浏览器/OS/GPU 产生不同哈希 → 与内置已知常见哈希对比
- 常见 🟢：5 个以上用户共享同一哈希 → 容易混淆
- 不常见 🟡：2-5 个
- 唯一 🔴：唯一哈希

注意：popup 环境下的 canvas 渲染与页面环境完全一致（同一浏览器引擎）。

熵值：常见 2-3 bits，不常见 4-6 bits，唯一 7-9 bits

### 8. 硬件并发

采集：`navigator.hardwareConcurrency`

独特性判定：
- 常见 🟢：4, 8, 16 核
- 不常见 🟡：2, 6, 12, 24 核
- 唯一 🔴：其他数值

熵值：常见 1-2 bits，不常见 3-4 bits，唯一 5-6 bits

## 熵值模型

参考 EFF Panopticlick 方法论，每个维度按独特性等级贡献不同 bits：

| 维度 | 常见 | 不常见 | 唯一 |
|------|------|--------|------|
| User-Agent | 3 | 7 | 11 |
| 屏幕 & 视口 | 2 | 5 | 8 |
| 时区 | 1 | 3 | 5 |
| 字体列表 | 4 | 9 | 14 |
| WebGL | 3 | 5 | 9 |
| AudioContext | 2 | 4 | 7 |
| Canvas 哈希 | 3 | 5 | 8 |
| 硬件并发 | 2 | 4 | 6 |

总熵值范围：~12-68 bits

### 熵值条形图 + 解读

```
██████████████░░░░░░  22 bits — 偏高（前30%）
```

- 0-15 bits → 🟢 "低 — 你的浏览器很普通，不易被追踪"
- 16-25 bits → 🟡 "偏高 — 有一定识别度"
- 26+ bits → 🔴 "高 — 你的浏览器高度独特，容易被精确追踪"

## 数据流

```
1. 用户打开 popup → 切换到「🖐️ 指纹」tab
2. renderFingerprintTab() 调用 FingerprintCollector 采集 8 个维度
3. 每个维度返回 { value, level, detail, entropyBits }
4. 计算总熵值 → 渲染条形图
5. 渲染 8 项手风琴列表
6. 可选：对比上次快照（chrome.storage.local 缓存）
```

## 常见值库

`lib/fingerprint-collector.js` 中维护：
- 常见屏幕分辨率列表（~20个）
- 常见时区列表（~30个）
- 常见 GPU 列表（~15个）
- 常见字体列表（~120个用于检测）
- 常见 Canvas 哈希（运行时累积，初期为空）
- 常见 UA 模式（正则匹配 Chrome/Edge/Firefox/Safari 大版本）

## 复用现有资产

- `.accordion` / `.accordion-header` / `.accordion-body` 样式（手风琴列表）
- `.empty-hint` 样式（空数据提示）
- `escapeHtml()` 工具函数
- 暗色模式 CSS 变量
- Tab 切换逻辑（自动支持第 4 个 tab）
