/**
 * 广告规则引擎
 * DNR 动态规则管理、ABP 规则解析、站点白名单
 */

const AdRulesEngine = {
  _nextDynamicRuleId: 100001,

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
   * 解析 ABP 规则
   */
  parseRule(input) {
    input = input.trim();
    if (!input) return null;

    const cosmeticMatch = input.match(/^(?:[a-z0-9\-.,*]+\#\#)?\#\#(.+)$/);
    if (cosmeticMatch) {
      return { type: 'cosmetic', selector: cosmeticMatch[1].trim(), raw: input };
    }

    const domainMatch = input.match(/^\|\|([a-z0-9.-]+)\^?\$?/);
    if (domainMatch) {
      const domain = domainMatch[1];
      const isThirdParty = input.includes('$third-party');
      return {
        type: 'network', domain: domain, isThirdParty: isThirdParty,
        urlFilter: `||${domain}${input.includes('^') ? '^' : ''}`,
        resourceTypes: this._parseTypes(input), raw: input
      };
    }

    if (input.includes('/') || input.includes('*')) {
      return {
        type: 'network', urlFilter: input,
        resourceTypes: ['script','image','xmlhttprequest','sub_frame'], raw: input
      };
    }

    return {
      type: 'network', urlFilter: input,
      resourceTypes: ['script','image','xmlhttprequest','sub_frame'], raw: input
    };
  },

  _parseTypes(raw) {
    const map = { 'script':'script','image':'image','stylesheet':'stylesheet',
      'xmlhttprequest':'xmlhttprequest','subdocument':'sub_frame',
      'ping':'ping','font':'font','media':'media' };
    const types = Object.entries(map)
      .filter(([k]) => raw.includes(`$${k}`)).map(([,v]) => v);
    return types.length > 0
      ? types : ['script','image','xmlhttprequest','sub_frame','ping'];
  },

  /**
   * 添加自定义规则
   */
  async addRule(rawInput) {
    const parsed = this.parseRule(rawInput);
    if (!parsed) return { success: false, error: '无法解析规则' };

    if (parsed.type === 'cosmetic') {
      const rules = await this.getCosmeticRules();
      rules.push({ selector: parsed.selector, raw: rawInput, id: Date.now() });
      await chrome.storage.sync.set({ adCustomCosmeticRules: rules });
      return { success: true, type: 'cosmetic', rule: parsed };
    }

    const dnrRules = await chrome.declarativeNetRequest.getDynamicRules();
    if (dnrRules.length >= 5000) {
      return { success: false, error: '规则已达上限(5000条)，请先删除旧规则' };
    }

    const ruleId = this._nextDynamicRuleId++;
    const dnrRule = {
      id: ruleId, priority: 1, action: { type: 'block' },
      condition: { urlFilter: parsed.urlFilter, resourceTypes: parsed.resourceTypes }
    };
    if (parsed.isThirdParty) dnrRule.condition.domainType = 'thirdParty';

    await chrome.declarativeNetRequest.updateDynamicRules({ addRules: [dnrRule] });
    return { success: true, type: 'network', rule: { ...parsed, id: ruleId } };
  },

  /**
   * 删除规则
   */
  async removeRule(ruleId, type) {
    if (type === 'cosmetic') {
      const rules = await this.getCosmeticRules();
      await chrome.storage.sync.set({
        adCustomCosmeticRules: rules.filter(r => r.id !== ruleId)
      });
      return { success: true };
    }
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [ruleId] });
    return { success: true };
  },

  async getCosmeticRules() {
    const r = await chrome.storage.sync.get(['adCustomCosmeticRules']);
    return r.adCustomCosmeticRules || [];
  },

  async getDynamicRules() {
    const dnrRules = await chrome.declarativeNetRequest.getDynamicRules();
    const cosmeticRules = await this.getCosmeticRules();
    return { network: dnrRules, cosmetic: cosmeticRules, total: dnrRules.length + cosmeticRules.length };
  },

  /**
   * 白名单
   */
  async getWhitelist() {
    const r = await chrome.storage.sync.get(['adWhitelist']);
    return r.adWhitelist || [];
  },

  async addToWhitelist(domain) {
    const list = await this.getWhitelist();
    if (!list.includes(domain)) { list.push(domain); await chrome.storage.sync.set({ adWhitelist: list }); }
    return list;
  },

  async removeFromWhitelist(domain) {
    const list = (await this.getWhitelist()).filter(d => d !== domain);
    await chrome.storage.sync.set({ adWhitelist: list });
    return list;
  },

  async isWhitelisted(domain) {
    const list = await this.getWhitelist();
    return list.some(d => domain === d || domain.endsWith('.' + d));
  }
};

if (typeof window !== 'undefined') {
  window.AdRulesEngine = AdRulesEngine;
}
