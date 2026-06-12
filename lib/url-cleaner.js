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

        if (TRACKING_PARAMS.includes(lowerKey)) {
          shouldRemove = true;
        }
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
   */
  hasTrackingParams(url) {
    return this.getRemovedParams(url).length > 0;
  }
};
