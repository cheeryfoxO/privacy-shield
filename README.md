# 🛡️ 隐私护盾 (Privacy Shield)

> 浏览器隐私扫描插件 — 实时检测第三方域名、追踪 Cookie、Canvas 指纹、WebRTC 泄漏，智能评分守护你的浏览器隐私。

[![Manifest](https://img.shields.io/badge/Manifest-V3-blue)](manifest.json)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)
[![Edge](https://img.shields.io/badge/Microsoft-Edge-0078D7?logo=microsoft-edge)](https://microsoftedge.microsoft.com/addons/)

## ✨ 功能

| 功能 | 说明 |
|------|------|
| 🌐 **第三方域名检测** | DOM 扫描 + Performance API + webRequest，内置 200+ 追踪域名库 |
| 🍪 **Cookie 深度分析** | 区分第一方/第三方，25+ 追踪模式识别（_ga, _fbp, _hj* 等） |
| 🎨 **Canvas 指纹检测** | document_start 阶段 Hook 6 个 Canvas API，识别隐藏指纹行为 |
| 📡 **WebRTC 泄漏检测** | 拦截 ICE Candidates，分类私有/公网 IP 泄漏 |
| 📊 **智能隐私评分** | 四维加权扣分模型（0-100分），五级颜色分级 |

## 📸 截图

![隐私护盾主界面](store/screenshot-main.png)

## 🔧 安装方法

### Microsoft Edge
1. 访问 [Edge 插件商店](https://microsoftedge.microsoft.com/addons/) 搜索「隐私护盾」
2. 或手动安装：打开 `edge://extensions` → 开启「开发人员模式」 → 「加载解压缩的扩展」 → 选择项目文件夹

### Google Chrome
1. 访问 Chrome Web Store 搜索「隐私护盾」
2. 或手动安装：打开 `chrome://extensions` → 开启「开发者模式」 → 「加载已解压的扩展程序」 → 选择项目文件夹

## 🏗 项目结构

```
├── manifest.json                  # Chrome MV3 配置
├── background/
│   └── service-worker.js          # 后台 Service Worker
├── content/
│   ├── content-script.js          # 页面注入入口
│   ├── detectors/
│   │   ├── third-party-domains.js # 第三方域名检测
│   │   ├── canvas-fingerprinting.js # Canvas 指纹检测
│   │   └── webrtc-leak.js         # WebRTC 泄漏检测
│   └── utils/
│       └── message-bridge.js      # 通信桥接
├── popup/
│   ├── popup.html/css/js          # 弹出界面（SVG 仪表盘）
├── options/
│   ├── options.html/css/js        # 设置页面
├── lib/
│   ├── url-parser.js              # 域名解析（eTLD+1）
│   ├── known-trackers.js          # 已知追踪域名库
│   ├── cookie-analyzer.js         # Cookie 分类分析
│   ├── privacy-score.js           # 隐私评分算法
│   └── storage-manager.js         # Storage API 封装
└── _locales/zh_CN/
    └── messages.json              # 中文本地化
```

## 🛠 技术栈

- **纯 JavaScript** — 无框架，零依赖
- **Manifest V3** — 最新的 Chrome/Edge 扩展标准
- **Service Worker** — 后台处理，按需唤醒
- **Monkey-Patching** — document_start 阶段注入，在页面脚本之前 Hook API
- **SVG 仪表盘** — CSS 驱动的手风琴 UI，支持暗色模式

## 📄 隐私

**所有数据处理均在本地浏览器中进行，不上传任何数据到服务器。** 详见 [隐私政策](store/privacy-policy.html)。

## 📜 许可证

MIT License — 欢迎 Fork、修改和贡献！

## 👤 作者

如有问题或建议，欢迎提 [Issue](https://github.com/yourusername/privacy-shield/issues)。
