# 广告拦截功能 - 设计规格

## 概述

在隐私护盾浏览器插件中新增标准级广告拦截功能。支持 EasyList China + EasyPrivacy 规则订阅，用户可添加自定义过滤规则，通过 Chrome Manifest V3 declarativeNetRequest (DNR) API 实现网络请求拦截，通过 Content Script 注入 CSS 实现元素隐藏。

## 技术方案（方案 C：DNR 混合 + Content Script 元素隐藏）

### 三类规则分工

| 规则类型 | 技术 | 容量 | 内容 |
|---------|------|------|------|
| 网络拦截 | DNR 静态 JSON | 20,000 条 | EasyList China + EasyPrivacy 高频网络规则 |
| 用户自定义 | DNR 动态 API | 5,000 条 | 用户手动添加的过滤规则 |
| 元素隐藏 | Content Script CSS | 无限制（~28,000 条） | `##.ad-banner` 等 CSS 选择器 |

## 架构

```
POPUP UI: 新增广告拦截面板（Tab 切换）
    ├── 总开关 / 拦截统计 / 自定义规则 / 站点白名单
    │
BACKGROUND SW:
    ├── DNR 静态规则 (easylist-compiled.json, 20K 条)
    ├── dynamicRulesManager: 用户自定义规则 CRUD
    └── 拦截计数器 + 存储
    │
CONTENT SCRIPT:
    └── ad-blocker.js
        ├── 注入 <style> 隐藏广告元素
        └── MutationObserver 监听动态插入
```

## 文件变更

| 文件 | 操作 | 说明 |
|------|------|------|
| `lib/easylist-compiled.json` | 新增 | 预编译 20,000 条 DNR 网络规则 |
| `lib/easylist-css-rules.json` | 新增 | ~28,000 条元素隐藏规则（CSS 选择器列表） |
| `content/detectors/ad-blocker.js` | 新增 | 注入隐藏样式 + MutationObserver + 拦截统计收集 |
| `lib/ad-rules-engine.js` | 新增 | 自定义规则解析、DNR 动态规则管理、站点白名单 |
| `manifest.json` | 修改 | 增加 `declarativeNetRequest` 权限、静态规则声明 |
| `background/service-worker.js` | 修改 | 动态规则初始化、拦截计数聚合 |
| `popup/popup.html` | 修改 | 新增广告拦截 Tab 面板 |
| `popup/popup.css` | 修改 | Tab 切换样式、面板内容样式 |
| `popup/popup.js` | 修改 | 广告拦截面板渲染逻辑 |
| `options/options.html` | 修改 | 广告拦截设置区 |
| `options/options.js` | 修改 | 规则订阅/更新逻辑 |

## EasyList 规则编译

### 源规则格式 (ABP)

```
||doubleclick.net^$third-party
||googleadservices.com/pagead/*
##.ad-banner
##div[id^="div-gpt-ad"]
```

### DNR 转换规则

1. `||domain^` → `urlFilter: "||domain^"`, 合并 `$third-party` → `domainType: "thirdParty"`
2. `$script/$image/$xmlhttprequest` → `resourceTypes` 白名单
3. 简单路径 `/ads/*` → `urlFilter`
4. `##selector` → 不计入 DNR，归入元素隐藏 JSON
5. 复杂正则 → 转换为 `regexFilter`（按优先级，超配额则跳过）

### 规则数量预估

| 类型 | 数量 |
|------|------|
| DNR 网络规则 | ~18,000-20,000 条 |
| 元素隐藏选择器 | ~28,000 条 |
| 无法转换（跳过） | ~2,000 条 |

## 拦截机制

### 网络请求拦截
- DNR 静态规则在请求阶段自动拦截，浏览器原生执行，零性能开销
- 动态规则（用户自定义）即时通过 `chrome.declarativeNetRequest.updateDynamicRules()` 生效

### 元素隐藏
- Content Script 注入合并后的 CSS（约 200KB 压缩后 ~50KB）
- MutationObserver 监听 DOM 变化，确保动态加载的广告也被隐藏
- 每 30 秒批量处理一次，避免性能影响

### 站点白名单
- 白名单域名存储于 `chrome.storage.sync`
- Background SW 检查当前标签页是否在白名单中
- 白名单站点：DNR 规则不生效 + 不注入元素隐藏样式

## Popup UI

```
┌──────────────────────────────┐
│ 🛡️  隐私评分 | 🛑 广告拦截  │  ← Tab 切换
├──────────────────────────────┤
│ 🛑 广告拦截  [● 开启]       │
│                              │
│ 📊 当前页面                  │
│ 已拦截: 8  今日: 142        │
│ 已隐藏元素: 3               │
│                              │
│ 📝 添加自定义规则            │
│ [||example.com/ads/*    ]  │
│ [添加]                      │
│                              │
│ 📋 自定义规则 (3)            │
│ · ||doubleclick.net^  [删] │
│ · ##.popup-ad        [删]  │
│                              │
│ ⬜ 对本网站放行              │
└──────────────────────────────┘
```

## 选项页

新增设置项：
- 广告拦截开关（与 Popup 同步）
- EasyList 订阅开关（是否启用内置规则）
- 自定义规则管理（批量查看/删除）
- 规则版本号显示
- 白名单域名管理（批量编辑）

## 错误处理

- 动态规则超过 5,000 条时提示用户删除旧规则
- DNR 规则加载失败时回退到仅元素隐藏
- CSS 选择器解析失败时跳过该条，记录警告
- Content Script 注入失败时不影响网络层拦截
