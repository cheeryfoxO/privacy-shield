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
    "webrtc": "other",
    "font": "font",
    "media": "media",
    "other": "other",
}

# 最大 DNR 规则数（Chrome 静态规则限制）
MAX_DNR_RULES = 20000


def fetch_rules(url):
    """下载 EasyList 源规则"""
    try:
        req = urllib.request.Request(
            url, headers={"User-Agent": "PrivacyShield/1.0"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.read().decode("utf-8").splitlines()
    except URLError as e:
        print(f"  WARNING: Failed to fetch {url}: {e}")
        return []


def parse_abp_rule(line):
    """
    解析单条 ABP 规则
    返回: { type: "network"|"cosmetic", ... } 或 None
    """
    line = line.strip()
    if not line or line.startswith("!") or line.startswith("["):
        return None
    # 跳过白名单规则
    if line.startswith("@@") or line.startswith("#@#"):
        return None

    # 元素隐藏规则
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
        resource_types = list(set(RESOURCE_TYPE_MAP.values()))

    return {
        "type": "network",
        "rule": rule_part,
        "third_party": "third-party" in modifiers,
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

    if rule.startswith("||"):
        domain = rule[2:].rstrip("^/")
        dnr["condition"]["urlFilter"] = f"||{domain}"
    elif rule.startswith("|http"):
        dnr["condition"]["urlFilter"] = rule[1:]
    elif rule.startswith("/") and rule.endswith("/"):
        regex = rule[1:-1]
        try:
            re.compile(regex)
            dnr["condition"]["regexFilter"] = regex
        except re.error:
            dnr["condition"]["urlFilter"] = regex.replace("\\", "")
    elif rule.startswith("||"):
        dnr["condition"]["urlFilter"] = rule
    else:
        dnr["condition"]["urlFilter"] = rule if "*" in rule else f"*{rule}*"

    if parsed["third_party"]:
        dnr["condition"]["domainType"] = "thirdParty"

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
    print("Privacy Shield - EasyList Rule Compiler")
    print("=" * 60)

    all_network_rules = []
    all_css_selectors = []
    seen_network = set()
    seen_css = set()

    for name, url in SUBSCRIPTIONS:
        print(f"\nDownloading {name} ({url})...")
        lines = fetch_rules(url)
        print(f"  Downloaded {len(lines)} lines")

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

        print(f"  Network rules: {network_count} (total {len(all_network_rules)})")
        print(f"  Cosmetic rules: {css_count} (total {len(all_css_selectors)})")

    # 按优先级排序：域名拦截优先于路径匹配
    all_network_rules.sort(key=lambda r: (
        0 if r["rule"].startswith("||") else 1,
        -len(r["rule"])
    ))

    # 编译 DNR 规则
    print(f"\nCompiling DNR rules...")
    dnr_rules = []
    css_list = []

    for i, parsed in enumerate(all_network_rules):
        if i >= MAX_DNR_RULES:
            print(f"  Reached DNR limit {MAX_DNR_RULES}, "
                  f"skipping {len(all_network_rules) - i} rules")
            break
        try:
            dnr = abp_to_dnr_rule(parsed, rule_id=i + 1)
            dnr_rules.append(dnr)
        except Exception:
            pass

    # 编译 CSS 选择器
    for parsed in all_css_selectors:
        css_list.append({
            "selector": parsed["selector"],
            "domains": parsed["domains"],
        })

    # 写入输出文件
    script_dir = os.path.dirname(os.path.abspath(__file__))
    output_dir = os.path.join(script_dir, "..", "lib")
    os.makedirs(output_dir, exist_ok=True)

    dnr_path = os.path.join(output_dir, "easylist-dnr-rules.json")
    css_path = os.path.join(output_dir, "easylist-css-selectors.json")

    with open(dnr_path, "w", encoding="utf-8") as f:
        json.dump(dnr_rules, f, ensure_ascii=False)
    print(f"\nDNR rules: {dnr_path} ({len(dnr_rules)} rules)")

    with open(css_path, "w", encoding="utf-8") as f:
        json.dump(css_list, f, ensure_ascii=False)
    print(f"CSS selectors: {css_path} ({len(css_list)} selectors)")

    # 统计
    print(f"\nCompilation summary:")
    print(f"  Network rules: {len(dnr_rules)} (max {MAX_DNR_RULES})")
    print(f"  Cosmetic rules: {len(css_list)}")
    print(f"  Skipped network: {max(0, len(all_network_rules) - MAX_DNR_RULES)}")

    return dnr_rules, css_list


if __name__ == "__main__":
    dnr, css = compile_rules()
    print(f"\nCompilation complete!")
