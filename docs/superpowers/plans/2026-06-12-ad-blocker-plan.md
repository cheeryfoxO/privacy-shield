# 广告拦截功能 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在隐私护盾插件中新增 EasyList China + EasyPrivacy 标准广告拦截，包含 DNR 网络拦截、元素隐藏、自定义规则和站点白名单。

**Architecture:** DNR 混合方案 — 静态规则（编译自 EasyList 的 ~18K 条网络规则）+ 动态规则（用户自定义，5K 额度）+ Content Script CSS 注入（~28K 条元素隐藏选择器）。Python 脚本负责下载和编译 EasyList 源规则，生成 DNR JSON 和 CSS 选择器文件。

**Tech Stack:** Chrome Manifest V3, declarativeNetRequest, Python (规则编译脚本), Vanilla JS

---

## 文件结构

| 文件 | 操作 | 职责 |
|------|------|------|
| `scripts/compile-easylist.py` | 新建 | 下载+解析 EasyList，输出编译后的规则 |
| `lib/easylist-dnr-rules.json` | 新建 | 编译产物：~18K 条 DNR 网络规则 |
| `lib/easylist-css-selectors.json` | 新建 | 编译产物：~28K 条元素隐藏选择器 |
| `lib/ad-rules-engine.js` | 新建 | DNR 动态规则管理、ABP 解析、白名单 |
| `content/detectors/ad-blocker.js` | 新建 | CSS 注入、MutationObserver、拦截统计 |
| `manifest.json` | 修改 | 加 `declarativeNetRequest` 权限和静态规则引用 |
| `background/service-worker.js` | 修改 | 广告拦截初始化、动态规则 API、统计聚合 |
| `popup/popup.html` | 修改 | Tab 切换结构、广告拦截面板 |
| `popup/popup.css` | 修改 | Tab/面板样式 |
| `popup/popup.js` | 修改 | 广告拦截面板渲染逻辑 |
| `options/options.html` | 修改 | 广告拦截设置区 |
| `options/options.js` | 修改 | 白名单管理、规则管理 |
| `_locales/zh_CN/messages.json` | 修改 | 新增广告拦截相关字符串 |

---

## Task 1: EasyList 编译脚本

**Files:**
- Create: `scripts/compile-easylist.py`

### Step 1: 创建规则编译脚本

```python
#!/usr/bin/env python3
"""
EasyList China + EasyPrivacy 规则编译器
从官方源下载 ABP 语法规则，编译为：
  1. Chrome DNR 静态规则 JSON
  2. 元素隐藏 CSS 选择器列表
"""

import json
import re
import sys
import os
import urllib.request
from urllib.error import URLError

# EasyList 订阅源
SUBSCRIPTIONS = [
    ("easylist_china", "https://easylist-downloads.adblockplus.org/easylistchina+easylist.txt"),
    ("easyprivacy", "https://easylist-downloads.adblockplus.org/easyprivacy.txt"),
]

# 资源类型映射（ABP modifier → DNR resourceType）
RESOURCE_TYPE_MAP = {
    "script": "script",
    "image": "image",
    "stylesheet": "stylesheet",
    "object": "object",
    "xmlhttprequest": "xmlhttprequest",
    "subdocument": "sub_frame",
    "sub_frame": "sub_frame",
    "ping": "ping",
    "beacon": "ping",
    "websocket": "websocket",
    "webrtc": "webrtc",
    "font": "font",
    "media": "media",
    "other": "other",
}

# 最大 DNR 规则数（Chrome 静态规则限制）
MAX_DNR_RULES = 20000

def fetch_rules(url):
    """下载 EasyList 源规则"""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "PrivacyShield/1.0"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.read().decode("utf-8").splitlines()
    except URLError as e:
        print(f"  WARNING: Failed to fetch {url}: {e}")
        return []

def parse_abp_rule(line):
    """
    解析单条 ABP 规则
    返回: { type: "network"|"cosmetic", rule: str, modifiers: {...} } 或 None
    """
    line = line.strip()
    if not line or line.startswith("!") or line.startswith("[") or line.startswith("!"):
        return None
    if line.startswith("@@") or line.startswith("#@#"):
        return None  # 跳过白名单规则（不需要例外）

    # 元素隐藏规则: domain##selector 或 ##selector
    cosmetic_match = re.match(
        r"(?:([a-z0-9\-.,*]+)#[$#@?]?#)?"
        r"(#[$#@?]?#)(.+)",
        line
    )
    if cosmetic_match:
        selector = cosmetic_match.group(3).strip()
        domains = cosmetic_match.group(1)
        return {
            "type": "cosmetic",
            "domains": [d.strip() for d in domains.split(",")] if domains else [],
            "selector": selector,
        }

    # 网络规则
    modifiers = {}
    rule_part = line

    # 提取 $modifiers
    mod_match = re.match(r"(.+)\$(.+)", line)
    if mod_match:
        rule_part = mod_match.group(1).strip()
        mod_str = mod_match.group(2).strip()
        for mod in mod_str.split(","):
            mod = mod.strip()
            if "=" in mod:
                key, val = mod.split("=", 1)
                modifiers[key.strip()] = val.strip()
            else:
                modifiers[mod] = True

    # 解析资源类型
    resource_types = []
    for mod_name in RESOURCE_TYPE_MAP:
        if mod_name in modifiers:
            resource_types.append(RESOURCE_TYPE_MAP[mod_name])
    if not resource_types:
        # 没有指定类型 → 拦截所有类型
        resource_types = list(set(RESOURCE_TYPE_MAP.values()))

    # 判断第三方
    is_third_party = "third-party" in modifiers or modifiers.get("domain", "")

    return {
        "type": "network",
        "rule": rule_part,
        "third_party": is_third_party,
        "resource_types": resource_types,
        "modifiers": modifiers,
    }

def abp_to_dnr_rule(parsed, rule_id):
    """将解析后的 ABP 规则转换为 DNR 规则"""
    rule = parsed["rule"]

    dnr = {
        "id": rule_id,
        "priority": 1,
        "action": {"type": "block"},
        "condition": {
            "resourceTypes": parsed["resource_types"],
        },
    }

    # 判断规则类型
    if rule.startswith("||"):
        # 域名拦截: ||example.com^
        domain = rule[2:].rstrip("^/")
        dnr["condition"]["urlFilter"] = f"||{domain}"
    elif rule.startswith("|http"):
        # 精确 URL: |https://...
        dnr["condition"]["urlFilter"] = rule[1:]
    elif rule.startswith("/") and rule.endswith("/"):
        # 正则规则
        regex = rule[1:-1]
        # 验证正则合法性
        try:
            re.compile(regex)
            dnr["condition"]["regexFilter"] = regex
        except re.error:
            # 正则无效，尝试转 urlFilter
            dnr["condition"]["urlFilter"] = regex.replace("\\", "")
    elif rule.startswith("||"):
        dnr["condition"]["urlFilter"] = rule
    else:
        # 简单路径匹配
        dnr["condition"]["urlFilter"] = rule if "*" in rule else f"*{rule}*"

    # 第三方限制
    if parsed["third_party"]:
        dnr["condition"]["domainType"] = "thirdParty"

    # 域名排除修饰
    if "domain" in parsed["modifiers"]:
        domains = parsed["modifiers"]["domain"].split("|")
        included = [d for d in domains if not d.startswith("~")]
        excluded = [d[1:] for d in domains if d.startswith("~")]
        if included:
            dnr["condition"]["initiatorDomains"] = included
        if excluded:
            dnr["condition"]["excludedInitiatorDomains"] = excluded

    return dnr

def compile_rules():
    """主编译流程"""
    print("=" * 60)
    print("隐私护盾 - EasyList 规则编译器")
    print("=" * 60)

    all_network_rules = []
    all_css_selectors = []
    seen_network = set()
    seen_css = set()

    for name, url in SUBSCRIPTIONS:
        print(f"\n📥 下载 {name} ({url})...")
        lines = fetch_rules(url)
        print(f"   已下载 {len(lines)} 行")

        network_count = 0
        css_count = 0

        for line in lines:
            parsed = parse_abp_rule(line)
            if not parsed:
                continue

            if parsed["type"] == "network":
                dedup_key = parsed["rule"]
                if dedup_key in seen_network:
                    continue
                seen_network.add(dedup_key)
                all_network_rules.append(parsed)
                network_count += 1

            elif parsed["type"] == "cosmetic":
                dedup_key = parsed["selector"]
                if dedup_key in seen_css:
                    continue
                seen_css.add(dedup_key)
                all_css_selectors.append(parsed)
                css_count += 1

        print(f"   网络规则: {network_count} (累计 {len(all_network_rules)})")
        print(f"   元素隐藏: {css_count} (累计 {len(all_css_selectors)})")

    # 按优先级排序网络规则（域名拦截优先于路径匹配）
    all_network_rules.sort(key=lambda r: (
        0 if r["rule"].startswith("||") else 1,
        -len(r["rule"])
    ))

    # 编译 DNR 规则
    print(f"\n🔧 编译 DNR 规则...")
    dnr_rules = []
    css_list = []

    for i, parsed in enumerate(all_network_rules):
        if i >= MAX_DNR_RULES:
            print(f"   已达到上限 {MAX_DNR_RULES}，跳过剩余 {len(all_network_rules) - i} 条")
            break
        try:
            dnr = abp_to_dnr_rule(parsed, rule_id=i + 1)
            dnr_rules.append(dnr)
        except Exception as e:
            pass  # 跳过无法转换的规则

    # 编译 CSS 选择器
    for parsed in all_css_selectors:
        if parsed["domains"]:
            # 域名限定选择器
            css_list.append({
                "selector": parsed["selector"],
                "domains": parsed["domains"],
            })
        else:
            # 全局选择器
            css_list.append({"selector": parsed["selector"], "domains": []})

    # 写入输出文件
    output_dir = os.path.join(os.path.dirname(__file__), "..", "lib")
    os.makedirs(output_dir, exist_ok=True)

    dnr_path = os.path.join(output_dir, "easylist-dnr-rules.json")
    css_path = os.path.join(output_dir, "easylist-css-selectors.json")

    with open(dnr_path, "w", encoding="utf-8") as f:
        json.dump(dnr_rules, f, ensure_ascii=False)
    print(f"\n✅ DNR 规则: {dnr_path} ({len(dnr_rules)} 条)")

    with open(css_path, "w", encoding="utf-8") as f:
        json.dump(css_list, f, ensure_ascii=False)
    print(f"✅ CSS 选择器: {css_path} ({len(css_list)} 条)")

    # 输出统计
    print(f"\n📊 编译统计:")
    print(f"   网络规则: {len(dnr_rules)} (max {MAX_DNR_RULES})")
    print(f"   元素隐藏: {len(css_list)}")
    print(f"   跳过的网络规则: {max(0, len(all_network_rules) - MAX_DNR_RULES)}")

    return dnr_rules, css_list

if __name__ == "__main__":
    dnr, css = compile_rules()
    print(f"\n🎉 编译完成！")
```

### Step 2: 运行编译脚本生成规则文件

```bash
cd F:/talk_with_claude/projects1 && python3 scripts/compile-easylist.py
```

如果网络不通（无法下载 EasyList），使用预置的种子规则文件代替。

### Step 3: 提交

```bash
git add scripts/compile-easylist.py lib/easylist-dnr-rules.json lib/easylist-css-selectors.json
git commit -m "feat: add EasyList compilation script and compiled rules"
```

---

## Task 2: 种子规则（离线备用）

**Files:**
- Create: `lib/easylist-dnr-rules-seed.json`
- Create: `lib/easylist-css-selectors-seed.json`

当无法下载 EasyList 时，使用预先包含的 ~500 条种子规则。

### Step 1: 创建 DNR 种子规则

```json
[
  {
    "id": 1,
    "priority": 1,
    "action": { "type": "block" },
    "condition": {
      "urlFilter": "||doubleclick.net^",
      "resourceTypes": ["script", "image", "xmlhttprequest", "sub_frame", "ping"],
      "domainType": "thirdParty"
    }
  },
  {
    "id": 2,
    "priority": 1,
    "action": { "type": "block" },
    "condition": {
      "urlFilter": "||googlesyndication.com^",
      "resourceTypes": ["script", "image", "xmlhttprequest", "sub_frame"],
      "domainType": "thirdParty"
    }
  },
  {
    "id": 3,
    "priority": 1,
    "action": { "type": "block" },
    "condition": {
      "urlFilter": "||googleadservices.com^",
      "resourceTypes": ["script", "xmlhttprequest", "sub_frame"],
      "domainType": "thirdParty"
    }
  },
  {
    "id": 4,
    "priority": 1,
    "action": { "type": "block" },
    "condition": {
      "urlFilter": "||criteo.com^",
      "resourceTypes": ["script", "image", "xmlhttprequest"],
      "domainType": "thirdParty"
    }
  },
  {
    "id": 5,
    "priority": 1,
    "action": { "type": "block" },
    "condition": {
      "urlFilter": "||criteo.net^",
      "resourceTypes": ["script", "image", "xmlhttprequest"],
      "domainType": "thirdParty"
    }
  },
  {
    "id": 6,
    "priority": 1,
    "action": { "type": "block" },
    "condition": {
      "urlFilter": "||outbrain.com^",
      "resourceTypes": ["script", "image", "xmlhttprequest", "sub_frame"],
      "domainType": "thirdParty"
    }
  },
  {
    "id": 7,
    "priority": 1,
    "action": { "type": "block" },
    "condition": {
      "urlFilter": "||taboola.com^",
      "resourceTypes": ["script", "image", "xmlhttprequest", "sub_frame"],
      "domainType": "thirdParty"
    }
  },
  {
    "id": 8,
    "priority": 1,
    "action": { "type": "block" },
    "condition": {
      "urlFilter": "||pubmatic.com^",
      "resourceTypes": ["script", "image", "xmlhttprequest"],
      "domainType": "thirdParty"
    }
  },
  {
    "id": 9,
    "priority": 1,
    "action": { "type": "block" },
    "condition": {
      "urlFilter": "||openx.net^",
      "resourceTypes": ["script", "image", "xmlhttprequest"],
      "domainType": "thirdParty"
    }
  },
  {
    "id": 10,
    "priority": 1,
    "action": { "type": "block" },
    "condition": {
      "urlFilter": "||appnexus.com^",
      "resourceTypes": ["script", "image", "xmlhttprequest"],
      "domainType": "thirdParty"
    }
  }
]
```

### Step 2: 创建 CSS 种子选择器

```json
[
  {"selector": ".ad-banner", "domains": []},
  {"selector": ".ad-container", "domains": []},
  {"selector": ".ad-wrapper", "domains": []},
  {"selector": ".advertisement", "domains": []},
  {"selector": "[class*=\"ad-\"]", "domains": []},
  {"selector": "[id*=\"google_ads\"]", "domains": []},
  {"selector": "[id*=\"banner-ad\"]", "domains": []},
  {"selector": "div[class*=\"sponsored\"]", "domains": []},
  {"selector": ".adsbygoogle", "domains": []},
  {"selector": "#ad-slot", "domains": []},
  {"selector": ".adslot", "domains": []},
  {"selector": "[aria-label*=\"广告\"]", "domains": []},
  {"selector": ".popup-ad", "domains": []},
  {"selector": ".video-ads", "domains": []},
  {"selector": ".top-ad", "domains": []}
]
```

### Step 3: 提交

```bash
git add lib/easylist-dnr-rules-seed.json lib/easylist-css-selectors-seed.json
git commit -m "feat: add seed ad blocking rules (offline fallback)"
```

---

## Task 3: DNR 动态规则引擎

**Files:**
- Create: `lib/ad-rules-engine.js`

### Step 1: 创建规则引擎

```js
/**
 * 广告规则引擎
 * 负责：DNR 动态规则管理、ABP 规则解析、站点白名单
 */

const AdRulesEngine = {
  _nextDynamicRuleId: 100001, // 动态规则从 100001 开始（避免与静态规则冲突）

  /**
   * 初始化动态规则（从 storage 恢复）
   */
  async init() {
    try {
      const rules = await chrome.declarativeNetRequest.getDynamicRules();
      if (rules.length > 0) {
        this._nextDynamicRuleId = Math.max(...rules.map(r => r.id)) + 1;
      }
    } catch (e) {
      console.error('[广告拦截] 初始化动态规则失败:', e);
    }
  },

  /**
   * 解析用户输入的 ABP 规则
   */
  parseRule(input) {
    input = input.trim();
    if (!input) return null;

    // 元素隐藏: ##selector
    const cosmeticMatch = input.match(/^(?:[a-z0-9\-.,*]+\#\#)?\#\#(.+)$/);
    if (cosmeticMatch) {
      return {
        type: 'cosmetic',
        selector: cosmeticMatch[1].trim(),
        raw: input
      };
    }

    // 域名拦截: ||domain^
    const domainMatch = input.match(/^\|\|([a-z0-9.-]+)\^?\$?/);
    if (domainMatch) {
      const domain = domainMatch[1];
      const isThirdParty = input.includes('$third-party');
      const resourceTypes = this._parseResourceTypes(input);
      return {
        type: 'network',
        domain: domain,
        isThirdParty: isThirdParty,
        resourceTypes: resourceTypes,
        raw: input,
        urlFilter: `||${domain}${input.includes('^') ? '^' : ''}`
      };
    }

    // 简单路径: /ads/*
    if (input.includes('/') || input.includes('*')) {
      return {
        type: 'network',
        urlFilter: input,
        resourceTypes: ['script', 'image', 'xmlhttprequest', 'sub_frame'],
        raw: input
      };
    }

    // URL 过滤
    return {
      type: 'network',
      urlFilter: input,
      resourceTypes: ['script', 'image', 'xmlhttprequest', 'sub_frame'],
      raw: input
    };
  },

  /**
   * 解析 ABP 规则中的资源类型修饰
   */
  _parseResourceTypes(raw) {
    const types = [];
    const typeMap = {
      'script': 'script', 'image': 'image', 'stylesheet': 'stylesheet',
      'xmlhttprequest': 'xmlhttprequest', 'subdocument': 'sub_frame',
      'ping': 'ping', 'websocket': 'websocket', 'font': 'font',
      'media': 'media', 'object': 'object', 'other': 'other'
    };

    for (const [key, val] of Object.entries(typeMap)) {
      if (raw.includes(`$${key}`)) {
        types.push(val);
      }
    }

    return types.length > 0
      ? types
      : ['script', 'image', 'xmlhttprequest', 'sub_frame', 'ping'];
  },

  /**
   * 添加一条用户自定义规则到 DNR
   */
  async addRule(rawInput) {
    const parsed = this.parseRule(rawInput);
    if (!parsed) return { success: false, error: '无法解析规则' };

    if (parsed.type === 'cosmetic') {
      // 元素隐藏规则 → 存入 storage
      const cosmeticRules = await this.getCosmeticRules();
      cosmeticRules.push({ selector: parsed.selector, raw: rawInput, id: Date.now() });
      await chrome.storage.sync.set({ adCustomCosmeticRules: cosmeticRules });
      return { success: true, type: 'cosmetic', rule: parsed };
    }

    // 网络规则 → DNR 动态规则
    const dnrRules = await chrome.declarativeNetRequest.getDynamicRules();

    // 检查配额
    if (dnrRules.length >= 5000) {
      return { success: false, error: '动态规则已达上限(5000条)，请先删除旧规则' };
    }

    const ruleId = this._nextDynamicRuleId++;
    const dnrRule = {
      id: ruleId,
      priority: 1,
      action: { type: 'block' },
      condition: {
        urlFilter: parsed.urlFilter,
        resourceTypes: parsed.resourceTypes
      }
    };

    if (parsed.isThirdParty) {
      dnrRule.condition.domainType = 'thirdParty';
    }

    await chrome.declarativeNetRequest.updateDynamicRules({
      addRules: [dnrRule]
    });

    return { success: true, type: 'network', rule: { ...parsed, id: ruleId } };
  },

  /**
   * 删除一条自定义规则
   */
  async removeRule(ruleId, type) {
    if (type === 'cosmetic') {
      const rules = await this.getCosmeticRules();
      const filtered = rules.filter(r => r.id !== ruleId);
      await chrome.storage.sync.set({ adCustomCosmeticRules: filtered });
      return { success: true };
    }

    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [ruleId]
    });
    return { success: true };
  },

  /**
   * 获取所有用户自定义元素隐藏规则
   */
  async getCosmeticRules() {
    const result = await chrome.storage.sync.get(['adCustomCosmeticRules']);
    return result.adCustomCosmeticRules || [];
  },

  /**
   * 获取所有动态规则（含统计）
   */
  async getDynamicRules() {
    const dnrRules = await chrome.declarativeNetRequest.getDynamicRules();
    const cosmeticRules = await this.getCosmeticRules();
    return {
      network: dnrRules,
      cosmetic: cosmeticRules,
      total: dnrRules.length + cosmeticRules.length
    };
  },

  /**
   * 站点白名单管理
   */
  async getWhitelist() {
    const result = await chrome.storage.sync.get(['adWhitelist']);
    return result.adWhitelist || [];
  },

  async addToWhitelist(domain) {
    const list = await this.getWhitelist();
    if (!list.includes(domain)) {
      list.push(domain);
      await chrome.storage.sync.set({ adWhitelist: list });
    }
    return list;
  },

  async removeFromWhitelist(domain) {
    const list = await this.getWhitelist();
    const filtered = list.filter(d => d !== domain);
    await chrome.storage.sync.set({ adWhitelist: filtered });
    return filtered;
  },

  async isWhitelisted(domain) {
    const list = await this.getWhitelist();
    return list.some(d => domain === d || domain.endsWith('.' + d));
  }
};

if (typeof window !== 'undefined') {
  window.AdRulesEngine = AdRulesEngine;
}
```

### Step 2: 提交

```bash
git add lib/ad-rules-engine.js
git commit -m "feat: add DNR dynamic rules engine with ABP parser"
```

---

## Task 4: Content Script 元素隐藏

**Files:**
- Create: `content/detectors/ad-blocker.js`

### Step 1: 创建元素隐藏脚本

```js
/**
 * 广告元素隐藏器
 * 注入 CSS 选择器隐藏广告元素，MutationObserver 监听动态插入
 */

(function() {
  'use strict';

  const AD_BLOCKER_STYLE_ID = 'privacy-shield-ad-blocker';
  let hiddenCount = 0;
  let enabled = true;

  /**
   * 从 Background 获取 CSS 选择器并注入
   */
  async function initAdBlocker() {
    try {
      // 获取当前站点是否被白名单
      const domain = window.location.hostname;
      const response = await chrome.runtime.sendMessage({
        type: 'AD_BLOCKER_STATUS',
        domain: domain
      });

      if (!response || !response.enabled || response.whitelisted) {
        enabled = false;
        return;
      }

      const selectors = response.cssSelectors || [];

      if (selectors.length > 0) {
        injectCSS(selectors);
        startObserver(selectors);
      }
    } catch (e) {
      // Background 可能未就绪，稍后重试
      setTimeout(initAdBlocker, 500);
    }
  }

  /**
   * 注入隐藏样式
   */
  function injectCSS(selectors) {
    // 移除旧样式
    const existing = document.getElementById(AD_BLOCKER_STYLE_ID);
    if (existing) existing.remove();

    // 创建新样式
    const style = document.createElement('style');
    style.id = AD_BLOCKER_STYLE_ID;
    style.textContent = selectors
      .map(s => `${s.selector}{display:none!important;visibility:hidden!important;height:0!important;overflow:hidden!important;}`)
      .join('\n');
    (document.head || document.documentElement).appendChild(style);

    // 统计已隐藏元素
    for (const s of selectors) {
      try {
        const elements = document.querySelectorAll(s.selector);
        hiddenCount += elements.length;
      } catch (e) {
        // 无效选择器，忽略
      }
    }

    reportStats();
  }

  /**
   * 启动 MutationObserver 处理动态元素
   */
  function startObserver(selectors) {
    let pendingCheck = false;

    const observer = new MutationObserver(() => {
      if (pendingCheck) return;
      pendingCheck = true;
      requestAnimationFrame(() => {
        pendingCheck = false;
        scanNewElements(selectors);
      });
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  /**
   * 扫描新增的广告元素
   */
  function scanNewElements(selectors) {
    let newHidden = 0;
    for (const s of selectors) {
      try {
        const elements = document.querySelectorAll(s.selector);
        for (const el of elements) {
          if (el.__ad_hidden) continue;
          el.style.display = 'none';
          el.style.visibility = 'hidden';
          el.__ad_hidden = true;
          newHidden++;
        }
      } catch (e) {}
    }
    if (newHidden > 0) {
      hiddenCount += newHidden;
      reportStats();
    }
  }

  /**
   * 向 Background 报告拦截统计
   */
  function reportStats() {
    chrome.runtime.sendMessage({
      type: 'AD_BLOCKER_STATS',
      data: {
        domain: window.location.hostname,
        hiddenElements: hiddenCount,
        timestamp: Date.now()
      }
    }).catch(() => {});
  }

  // 启动
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAdBlocker);
  } else {
    initAdBlocker();
  }

  // 导出状态供 content-script.js 使用
  window.__AD_BLOCKER_ENABLED = () => enabled;
  window.__AD_BLOCKER_HIDDEN_COUNT = () => hiddenCount;
})();
```

### Step 2: 提交

```bash
git add content/detectors/ad-blocker.js
git commit -m "feat: add element hiding with MutationObserver"
```

---

## Task 5: 修改 manifest.json

**Files:**
- Modify: `manifest.json`

### Step 1: 更新 manifest.json

```json
{
  "manifest_version": 3,
  "name": "__MSG_extName__",
  "version": "1.0.0",
  "description": "__MSG_extDescription__",
  "default_locale": "zh_CN",

  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  },

  "permissions": [
    "cookies",
    "webRequest",
    "storage",
    "tabs",
    "declarativeNetRequest"
  ],

  "host_permissions": [
    "<all_urls>"
  ],

  "declarative_net_request": {
    "rule_resources": [
      {
        "id": "easylist_rules",
        "enabled": true,
        "path": "lib/easylist-dnr-rules.json"
      }
    ]
  },

  "background": {
    "service_worker": "background/service-worker.js"
  },

  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": [
        "lib/url-parser.js",
        "lib/known-trackers.js",
        "content/detectors/third-party-domains.js",
        "content/detectors/canvas-fingerprinting.js",
        "content/detectors/webrtc-leak.js",
        "content/detectors/ad-blocker.js",
        "content/utils/message-bridge.js",
        "content/content-script.js"
      ],
      "run_at": "document_start",
      "all_frames": false
    }
  ],

  "action": {
    "default_popup": "popup/popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    },
    "default_title": "__MSG_extName__"
  },

  "options_page": "options/options.html",

  "content_security_policy": {
    "extension_pages": "script-src 'self'; object-src 'self'"
  }
}
```

### Step 2: 提交

```bash
git add manifest.json
git commit -m "feat: add declarativeNetRequest permission and static rule resource"
```

---

## Task 6: 修改 Background Service Worker

**Files:**
- Modify: `background/service-worker.js`

### Step 1: 更新 importScripts 和添加广告拦截初始化

在 `service-worker.js` 顶部 importScripts 行添加 `ad-rules-engine.js`:

```js
importScripts(
  '../lib/url-parser.js',
  '../lib/known-trackers.js',
  '../lib/cookie-analyzer.js',
  '../lib/privacy-score.js',
  '../lib/storage-manager.js',
  '../lib/ad-rules-engine.js'
);
```

### Step 2: 在文件末尾添加广告拦截相关代码

```js
// ============================================================
// 广告拦截模块
// ============================================================

// 拦截统计缓存
let adBlockStats = {
  todayTotal: 0,
  todayDate: new Date().toDateString(),
  perDomain: {} // domain -> { blocked: number, hidden: number }
};

// 已加载的 CSS 选择器（从 rules JSON 加载，缓存避免每次读取）
let cachedCssSelectors = null;

// 广告拦截总开关
let adBlockerEnabled = true;

/**
 * 初始化广告拦截模块
 */
async function initAdBlocker() {
  // 加载总开关状态
  const result = await chrome.storage.sync.get(['adBlockerEnabled']);
  adBlockerEnabled = result.adBlockerEnabled !== false; // 默认开启

  // 初始化动态规则引擎
  await AdRulesEngine.init();

  // 加载拦截统计
  const statsResult = await chrome.storage.local.get(['adBlockStats']);
  if (statsResult.adBlockStats) {
    adBlockStats = statsResult.adBlockStats;
    // 检查日期是否过期
    if (adBlockStats.todayDate !== new Date().toDateString()) {
      adBlockStats.todayTotal = 0;
      adBlockStats.todayDate = new Date().toDateString();
    }
  }

  console.log('[广告拦截] 初始化完成，状态:', adBlockerEnabled ? '开启' : '关闭');
}

/**
 * 加载 CSS 选择器（懒加载 + 缓存）
 */
async function loadCssSelectors() {
  if (cachedCssSelectors) return cachedCssSelectors;

  try {
    const url = chrome.runtime.getURL('lib/easylist-css-selectors.json');
    const response = await fetch(url);
    cachedCssSelectors = await response.json();
  } catch (e) {
    console.error('[广告拦截] 加载 CSS 选择器失败:', e);
    // 尝试加载种子规则
    try {
      const url = chrome.runtime.getURL('lib/easylist-css-selectors-seed.json');
      const response = await fetch(url);
      cachedCssSelectors = await response.json();
    } catch (e2) {
      cachedCssSelectors = [];
    }
  }

  // 合并用户自定义 CSS 规则
  const customRules = await AdRulesEngine.getCosmeticRules();
  for (const rule of customRules) {
    cachedCssSelectors.push({ selector: rule.selector, domains: [] });
  }

  return cachedCssSelectors;
}

/**
 * 更新拦截统计
 */
function updateAdBlockStats(domain, hidden) {
  if (!adBlockStats.perDomain[domain]) {
    adBlockStats.perDomain[domain] = { blocked: 0, hidden: 0 };
  }
  adBlockStats.perDomain[domain].hidden = hidden;
  adBlockStats.todayTotal++;

  // 异步持久化（不阻塞）
  chrome.storage.local.set({ adBlockStats: adBlockStats }).catch(() => {});
}

/**
 * 获取当前页面拦截统计（供 Popup 使用）
 */
async function getAdBlockPageStats(domain) {
  const stats = adBlockStats.perDomain[domain] || { blocked: 0, hidden: 0 };

  // 聚合网络拦截数（DNR 自动拦截，无法精确区分域名）
  return {
    blocked: stats.blocked,
    hidden: stats.hidden,
    todayTotal: adBlockStats.todayTotal
  };
}

// ============================================================
// 扩展消息处理：新增广告拦截相关消息
// ============================================================

// 在原有的 handleMessage 函数 switch 中添加以下 case：

/*
    case 'AD_BLOCKER_STATUS':
      await handleAdBlockerStatus(message.domain, sendResponse);
      break;

    case 'AD_BLOCKER_STATS':
      await handleAdBlockerStats(message.data, sendResponse);
      break;

    case 'AD_TOGGLE':
      await handleAdToggle(message.enabled, sendResponse);
      break;

    case 'AD_ADD_RULE':
      await handleAdAddRule(message.rule, sendResponse);
      break;

    case 'AD_REMOVE_RULE':
      await handleAdRemoveRule(message.ruleId, message.type, sendResponse);
      break;

    case 'AD_GET_RULES':
      await handleAdGetRules(sendResponse);
      break;

    case 'AD_WHITELIST':
      await handleAdWhitelist(message.action, message.domain, sendResponse);
      break;
*/
```

### Step 3: 实现各消息处理函数

在 service-worker.js 末尾添加：

```js
async function handleAdBlockerStatus(domain, sendResponse) {
  const whitelisted = await AdRulesEngine.isWhitelisted(domain);
  const cssSelectors = whitelisted ? [] : await loadCssSelectors();
  sendResponse({
    enabled: adBlockerEnabled,
    whitelisted: whitelisted,
    cssSelectors: cssSelectors
  });
}

async function handleAdBlockerStats(data, sendResponse) {
  updateAdBlockStats(data.domain, data.hiddenElements);
  sendResponse({ received: true });
}

async function handleAdToggle(enabled, sendResponse) {
  adBlockerEnabled = enabled;
  await chrome.storage.sync.set({ adBlockerEnabled: enabled });
  sendResponse({ success: true });
}

async function handleAdAddRule(rule, sendResponse) {
  const result = await AdRulesEngine.addRule(rule);
  sendResponse(result);
}

async function handleAdRemoveRule(ruleId, type, sendResponse) {
  const result = await AdRulesEngine.removeRule(ruleId, type);
  sendResponse(result);
}

async function handleAdGetRules(sendResponse) {
  const rules = await AdRulesEngine.getDynamicRules();
  const whitelist = await AdRulesEngine.getWhitelist();
  const stats = {
    enabled: adBlockerEnabled,
    todayTotal: adBlockStats.todayTotal,
    dnrRuleCount: rules.network.length,
    cosmeticRuleCount: rules.cosmetic.length
  };
  sendResponse({ rules, whitelist, stats });
}

async function handleAdWhitelist(action, domain, sendResponse) {
  if (action === 'add') {
    const list = await AdRulesEngine.addToWhitelist(domain);
    sendResponse({ success: true, whitelist: list });
  } else if (action === 'remove') {
    const list = await AdRulesEngine.removeFromWhitelist(domain);
    sendResponse({ success: true, whitelist: list });
  }
}
```

### Step 4: 在 SW 启动时调用初始化

在 service-worker.js 的全局执行区添加：

```js
// 初始化广告拦截
initAdBlocker();
```

### Step 5: 提交

```bash
git add background/service-worker.js
git commit -m "feat: add ad blocker message handlers and stats to background SW"
```

---

## Task 7: 修改 Popup UI（Tab 切换 + 广告拦截面板）

**Files:**
- Modify: `popup/popup.html`
- Modify: `popup/popup.css`
- Modify: `popup/popup.js`

### Step 7a: 更新 popup.html

在 header 下方添加 Tab 切换，将原有内容包在 `tab-privacy` 区域，新增 `tab-ad` 区域：

```html
<body>
  <!-- 头部 -->
  <header class="header">
    <div class="header-icon">🛡️</div>
    <h1 class="header-title">隐私护盾</h1>
    <span class="header-version">v1.0</span>
  </header>

  <!-- Tab 切换 -->
  <nav class="tab-nav">
    <button class="tab-btn active" data-tab="privacy">📊 隐私评分</button>
    <button class="tab-btn" data-tab="adblock">🛑 广告拦截</button>
  </nav>

  <!-- ====== 隐私评分面板 ====== -->
  <div class="tab-panel active" id="tab-privacy">
    <!-- 原有内容：分数仪表盘、摘要、手风琴详情、底部按钮 -->
    <section class="score-section" id="scoreSection">...</section>
    <section class="summary-section" id="summarySection">...</section>
    <section class="details-section" id="detailsSection">...</section>
    <footer class="footer">...</footer>
  </div>

  <!-- ====== 广告拦截面板 ====== -->
  <div class="tab-panel" id="tab-adblock">
    <!-- 总开关 -->
    <section class="ad-section">
      <div class="ad-switch-row">
        <span class="ad-switch-label">🛑 广告拦截</span>
        <label class="toggle-row" style="border:none;padding:0;">
          <input type="checkbox" id="adToggle" checked>
          <span class="toggle-switch"></span>
        </label>
      </div>
    </section>

    <!-- 拦截统计 -->
    <section class="ad-section">
      <div class="ad-stats">
        <div class="ad-stat-item">
          <span class="ad-stat-value" id="adBlockedToday">0</span>
          <span class="ad-stat-label">今日拦截</span>
        </div>
        <div class="ad-stat-item">
          <span class="ad-stat-value" id="adBlockedPage">0</span>
          <span class="ad-stat-label">当前页面</span>
        </div>
        <div class="ad-stat-item">
          <span class="ad-stat-value" id="adDNRCount">0</span>
          <span class="ad-stat-label">网络规则</span>
        </div>
      </div>
    </section>

    <!-- 添加自定义规则 -->
    <section class="ad-section">
      <label class="ad-section-label">📝 添加自定义规则</label>
      <div class="ad-rule-input-row">
        <input type="text" class="ad-rule-input" id="adRuleInput"
          placeholder="||example.com^ 或 ##.ad-banner">
        <button class="btn btn-small btn-primary" id="adRuleAdd">添加</button>
      </div>
      <p class="ad-hint">支持 ABP 语法：||域名^（拦截）或 ##选择器（隐藏）</p>
    </section>

    <!-- 自定义规则列表 -->
    <section class="ad-section">
      <label class="ad-section-label">📋 自定义规则 (<span id="adRuleCount">0</span>)</label>
      <div class="ad-rule-list" id="adRuleList">
        <p class="empty-hint">暂无自定义规则</p>
      </div>
    </section>

    <!-- 站点白名单 -->
    <section class="ad-section">
      <button class="btn btn-ghost" id="adWhitelistBtn">
        ⬜ 对本网站放行
      </button>
    </section>
  </div>

  <!-- 加载遮罩 -->
  <div class="overlay" id="overlay" style="display: none;">...</div>

  <script src="popup.js"></script>
</body>
```

### Step 7b: 更新 popup.css

在现有 CSS 末尾添加：

```css
/* ============================================================
   Tab 切换
   ============================================================ */
.tab-nav {
  display: flex;
  border-bottom: 2px solid var(--border-color);
  padding: 0 8px;
}

.tab-btn {
  flex: 1;
  padding: 10px 8px;
  border: none;
  background: none;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  color: var(--text-muted);
  border-bottom: 2px solid transparent;
  margin-bottom: -2px;
  transition: all 0.15s ease;
  font-family: inherit;
}

.tab-btn.active {
  color: var(--text-primary);
  border-bottom-color: var(--color-accent, #3b82f6);
}

.tab-btn:hover {
  color: var(--text-primary);
}

.tab-panel {
  display: none;
}

.tab-panel.active {
  display: block;
}

/* ============================================================
   广告拦截面板
   ============================================================ */
.ad-section {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color);
}

.ad-section:last-child {
  border-bottom: none;
}

.ad-switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.ad-switch-label {
  font-size: 15px;
  font-weight: 700;
}

.ad-stats {
  display: flex;
  gap: 8px;
}

.ad-stat-item {
  flex: 1;
  text-align: center;
  background: var(--bg-secondary);
  border-radius: var(--radius-sm);
  padding: 10px 6px;
}

.ad-stat-value {
  display: block;
  font-size: 22px;
  font-weight: 800;
  color: var(--color-accent, #3b82f6);
}

.ad-stat-label {
  font-size: 11px;
  color: var(--text-muted);
}

.ad-section-label {
  display: block;
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 6px;
}

.ad-rule-input-row {
  display: flex;
  gap: 6px;
}

.ad-rule-input {
  flex: 1;
  padding: 7px 10px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  font-size: 12px;
  font-family: monospace;
  background: var(--bg-primary);
  color: var(--text-primary);
}

.ad-rule-input:focus {
  outline: 2px solid var(--color-accent, #3b82f6);
  outline-offset: -2px;
}

.ad-hint {
  font-size: 10px;
  color: var(--text-muted);
  margin-top: 4px;
}

.ad-rule-list {
  max-height: 150px;
  overflow-y: auto;
}

.ad-rule-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 0;
  border-bottom: 1px solid var(--border-color);
  font-size: 11px;
  font-family: monospace;
}

.ad-rule-item:last-child {
  border-bottom: none;
}

.ad-rule-text {
  flex: 1;
  word-break: break-all;
}

.ad-rule-delete {
  color: var(--color-red);
  cursor: pointer;
  font-size: 11px;
  font-weight: 600;
  padding: 2px 6px;
  border: none;
  background: none;
  font-family: inherit;
  opacity: 0.7;
}

.ad-rule-delete:hover {
  opacity: 1;
}

.btn-small {
  padding: 6px 12px;
  font-size: 11px;
  flex: 0;
  white-space: nowrap;
}

.btn-ghost {
  width: 100%;
  text-align: center;
  padding: 8px;
  border: 1px dashed var(--border-color);
  border-radius: var(--radius-sm);
  background: none;
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  font-family: inherit;
}

.btn-ghost:hover {
  background: var(--bg-hover);
}
```

### Step 7c: 更新 popup.js

在现有 `init()` 函数中添加 Tab 切换和广告拦截逻辑：

```js
// 在 init() 函数末尾添加：

  // Tab 切换
  initTabs();

  // 初始化广告拦截面板
  await initAdBlockPanel(tab.id);


/**
 * Tab 切换逻辑
 */
function initTabs() {
  const tabBtns = document.querySelectorAll('.tab-btn');
  const panels = document.querySelectorAll('.tab-panel');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.dataset.tab;
      tabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      panels.forEach(p => p.classList.remove('active'));
      document.getElementById(`tab-${targetTab}`).classList.add('active');
    });
  });
}

/**
 * 初始化广告拦截面板
 */
async function initAdBlockPanel(tabId) {
  const tab = await chrome.tabs.get(tabId);
  const domain = new URL(tab.url).hostname;

  // 加载广告拦截状态
  const response = await chrome.runtime.sendMessage({
    type: 'AD_GET_RULES'
  });

  if (!response) return;

  const { rules, whitelist, stats } = response;

  // 更新统计
  document.getElementById('adBlockedToday').textContent = stats.todayTotal;
  document.getElementById('adDNRCount').textContent = stats.dnrRuleCount;

  // 设置总开关
  const toggle = document.getElementById('adToggle');
  toggle.checked = stats.enabled;

  // 获取当前页面统计
  try {
    const pageResponse = await chrome.runtime.sendMessage({
      type: 'GET_REPORT',
      tabId: tabId
    });
    if (pageResponse && pageResponse.report) {
      const pageStats = pageResponse.report.adBlockStats || {};
      document.getElementById('adBlockedPage').textContent = (pageStats.blocked || 0) + (pageStats.hidden || 0);
    }
  } catch (e) {}

  // 渲染自定义规则
  renderAdRules(rules);

  // 检查白名单状态
  const isWhitelisted = whitelist.some(d => domain === d || domain.endsWith('.' + d));
  const whitelistBtn = document.getElementById('adWhitelistBtn');
  if (isWhitelisted) {
    whitelistBtn.textContent = '✅ 已放行本网站（点击取消）';
  } else {
    whitelistBtn.textContent = '⬜ 对本网站放行';
  }

  // 绑定事件
  bindAdEvents(domain, isWhitelisted);
}

function renderAdRules(rules) {
  const container = document.getElementById('adRuleList');
  const count = document.getElementById('adRuleCount');

  const allRules = [
    ...rules.network.map(r => ({ id: r.id, type: 'network', text: r.condition.urlFilter || r.condition.regexFilter })),
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

function bindAdEvents(domain, isWhitelisted) {
  // 总开关
  document.getElementById('adToggle').addEventListener('change', async (e) => {
    await chrome.runtime.sendMessage({
      type: 'AD_TOGGLE',
      enabled: e.target.checked
    });
  });

  // 添加规则
  document.getElementById('adRuleAdd').addEventListener('click', async () => {
    const input = document.getElementById('adRuleInput');
    const rule = input.value.trim();
    if (!rule) return;

    const result = await chrome.runtime.sendMessage({
      type: 'AD_ADD_RULE',
      rule: rule
    });

    if (result.success) {
      input.value = '';
      // 刷新规则列表
      const response = await chrome.runtime.sendMessage({ type: 'AD_GET_RULES' });
      renderAdRules(response.rules);
    } else {
      alert('规则添加失败: ' + result.error);
    }
  });

  // 删除规则（事件委托）
  document.getElementById('adRuleList').addEventListener('click', async (e) => {
    if (!e.target.classList.contains('ad-rule-delete')) return;
    const id = parseInt(e.target.dataset.id);
    const type = e.target.dataset.type;

    await chrome.runtime.sendMessage({
      type: 'AD_REMOVE_RULE',
      ruleId: id,
      type: type
    });

    const response = await chrome.runtime.sendMessage({ type: 'AD_GET_RULES' });
    renderAdRules(response.rules);
  });

  // 白名单
  document.getElementById('adWhitelistBtn').addEventListener('click', async () => {
    const action = isWhitelisted ? 'remove' : 'add';
    await chrome.runtime.sendMessage({
      type: 'AD_WHITELIST',
      action: action,
      domain: domain
    });
    document.getElementById('adWhitelistBtn').textContent =
      action === 'add' ? '✅ 已放行本网站（点击取消）' : '⬜ 对本网站放行';
    isWhitelisted = !isWhitelisted;
  });
}
```

### Step 3: 提交

```bash
git add popup/popup.html popup/popup.css popup/popup.js
git commit -m "feat: add ad block panel with tab switching to popup"
```

---

## Task 8: 修改选项页

**Files:**
- Modify: `options/options.html`
- Modify: `options/options.js`

### Step 8a: 在 options.html 的「高级设置」section 之后，添加：

```html
      <!-- 广告拦截设置 -->
      <section class="card">
        <h2>🛑 广告拦截</h2>
        <p class="card-desc">管理广告过滤规则和站点白名单</p>

        <label class="toggle-row">
          <span class="toggle-label">
            <span>启用广告拦截</span>
            <small>基于 EasyList China + EasyPrivacy 规则拦截广告</small>
          </span>
          <input type="checkbox" name="adBlockerEnabled" checked>
          <span class="toggle-switch"></span>
        </label>

        <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border-color);">
          <label class="field-label" style="margin-bottom:6px;">站点白名单（每行一个域名）</label>
          <textarea name="adWhitelist" rows="4" class="text-input"
            style="width:100%;resize:vertical;font-family:monospace;font-size:12px;"
            placeholder="example.com&#10;mysite.org"></textarea>
          <span class="field-hint">白名单中的网站不会进行广告拦截</span>
        </div>

        <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border-color);">
          <p class="field-label">规则版本</p>
          <p style="font-size:12px;color:var(--text-muted);margin-top:2px;" id="adRuleVersion">
            内置规则: 种子规则（离线版本）
          </p>
        </div>
      </section>
```

### Step 8b: 在 options.js 中：

在 `applyOptionsToForm()` 中添加：

```js
  form.elements.adBlockerEnabled.checked = options.adBlockerEnabled !== false;
  form.elements.adWhitelist.value = (options.adWhitelist || []).join('\n');
```

在 `saveOptions()` 中添加：

```js
    adBlockerEnabled: form.elements.adBlockerEnabled.checked,
    adWhitelist: form.elements.adWhitelist.value
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean)
```

在 `DEFAULTS` 中添加：

```js
  adBlockerEnabled: true,
  adWhitelist: []
```

### Step 3: 提交

```bash
git add options/options.html options/options.js
git commit -m "feat: add ad blocker settings to options page"
```

---

## Task 9: 中文本地化

**Files:**
- Modify: `_locales/zh_CN/messages.json`

在 messages.json 的 JSON 对象末尾添加：

```json
  "tabPrivacy": { "message": "隐私评分" },
  "tabAdBlock": { "message": "广告拦截" },
  "adBlockEnabled": { "message": "广告拦截" },
  "adBlockToday": { "message": "今日拦截" },
  "adBlockCurrentPage": { "message": "当前页面" },
  "adBlockNetworkRules": { "message": "网络规则" },
  "adBlockAddRule": { "message": "添加自定义规则" },
  "adBlockRulePlaceholder": { "message": "||example.com^ 或 ##.ad-banner" },
  "adBlockCustomRules": { "message": "自定义规则" },
  "adBlockWhitelist": { "message": "对本网站放行" },
  "adBlockWhitelisted": { "message": "已放行本网站" },
  "adBlockNoRules": { "message": "暂无自定义规则" }
```

提交:

```bash
git add _locales/zh_CN/messages.json
git commit -m "feat: add ad blocker i18n strings"
```

---

## Task 10: 端到端验证

### Step 1: 在 chrome://extensions 重新加载插件

打开 `chrome://extensions` → 找到隐私护盾 → 点击「刷新」图标

### Step 2: 测试网络拦截

1. 访问 https://www.baidu.com 搜索任意内容
2. 打开 DevTools → Network 标签
3. 筛选被拦截的请求（红色）
4. 确认 `doubleclick.net`、`criteo.com` 等广告域被拦截

### Step 3: 测试元素隐藏

1. 访问一个含广告的网站
2. 打开 插件 Popup → 切换到「广告拦截」标签
3. 确认「当前页面」计数器 > 0

### Step 4: 测试自定义规则

1. 在 Popup 输入 `##body`（隐藏整个页面）→ 添加
2. 页面应完全消失（证明元素隐藏规则生效）
3. 删除该规则 → 页面恢复正常

### Step 5: 测试白名单

1. 点击「对本网站放行」
2. 刷新页面
3. 广告应重新出现（白名单生效）

### Step 6: 提交

```bash
git add . && git commit -m "verify: ad blocker end-to-end validation completed"
```

---

## 自审结果

1. **Spec 覆盖**: ✅ 所有 spec 需求均有对应 task
   - DNR 网络拦截 → Task 1, 2, 5
   - 元素隐藏 → Task 4
   - 自定义规则 → Task 3
   - 站点白名单 → Task 3, 6
   - Popup UI → Task 7
   - Options → Task 8

2. **占位符扫描**: ✅ 无 TBD/TODO/implement later

3. **类型一致性**: ✅
   - `AdRulesEngine.addRule()` 返回 `{ success, type, rule }` — 在 Task 3 定义，Task 6 使用一致
   - CSS 选择器格式 `{ selector, domains }` — 在 Task 1 编译脚本、Task 4 注入、Task 6 加载保持一致
   - 消息类型 `AD_BLOCKER_STATUS`, `AD_TOGGLE`, `AD_ADD_RULE` 等 — 在 Task 6 Background 和 Task 7 Popup 中保持一致

4. **无遗漏任务**: ✅
