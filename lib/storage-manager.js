/**
 * chrome.storage 封装
 * 提供报告保存、读取、选项管理等操作
 */

const StorageManager = {
  /**
   * 保存隐私报告到 chrome.storage.local
   */
  async saveReport(tabId, report) {
    try {
      const key = `report:${tabId}`;
      await chrome.storage.local.set({ [key]: report });
    } catch (e) {
      console.error('[隐私护盾] 保存报告失败:', e);
    }
  },

  /**
   * 获取指定标签页的隐私报告
   */
  async getReport(tabId) {
    try {
      const key = `report:${tabId}`;
      const result = await chrome.storage.local.get([key]);
      return result[key] || null;
    } catch (e) {
      console.error('[隐私护盾] 读取报告失败:', e);
      return null;
    }
  },

  /**
   * 删除指定标签页的报告
   */
  async removeReport(tabId) {
    try {
      const key = `report:${tabId}`;
      await chrome.storage.local.remove([key]);
    } catch (e) {
      console.error('[隐私护盾] 删除报告失败:', e);
    }
  },

  /**
   * 获取用户选项配置（带默认值）
   */
  async getOptions() {
    try {
      const result = await chrome.storage.sync.get(['options']);
      if (result.options) {
        return mergeWithDefaults(result.options);
      }
    } catch (e) {
      console.error('[隐私护盾] 读取选项失败:', e);
    }
    return getDefaultOptions();
  },

  /**
   * 保存用户选项
   */
  async saveOptions(options) {
    try {
      await chrome.storage.sync.set({ options: options });
    } catch (e) {
      console.error('[隐私护盾] 保存选项失败:', e);
    }
  }
};

/**
 * 获取默认选项
 */
function getDefaultOptions() {
  return {
    enableThirdPartyDetection: true,
    enableCookieInspection: true,
    enableCanvasDetection: true,
    enableWebRtcDetection: true,
    scoreWeights: {
      thirdPartyDomains: 35,
      cookies: 30,
      canvasFingerprinting: 25,
      webrtcLeaks: 10
    },
    whitelistedDomains: ['localhost', '127.0.0.1', '::1'],
    notifyOnHighRisk: false
  };
}

/**
 * 合并用户选项与默认值（处理缺失字段）
 */
function mergeWithDefaults(userOptions) {
  const defaults = getDefaultOptions();
  return {
    ...defaults,
    ...userOptions,
    scoreWeights: {
      ...defaults.scoreWeights,
      ...(userOptions.scoreWeights || {})
    }
  };
}
