/**
 * URL 域名解析工具
 * 提取 eTLD+1（有效顶级域名+1）
 * 使用启发式方法处理常见两级 TLD
 */

// 常见两级 TLD 列表（国别 + 常见组合）
const TWO_LEVEL_TLDS = new Set([
  // 英国
  'co.uk', 'org.uk', 'net.uk', 'ac.uk', 'gov.uk', 'me.uk', 'ltd.uk', 'plc.uk',
  // 日本
  'co.jp', 'or.jp', 'ne.jp', 'ac.jp', 'go.jp',
  // 韩国
  'co.kr', 'or.kr', 'ne.kr', 'go.kr',
  // 印度
  'co.in', 'net.in', 'org.in', 'firm.in', 'gen.in', 'ind.in',
  // 澳大利亚
  'com.au', 'net.au', 'org.au', 'gov.au', 'edu.au',
  // 巴西
  'com.br', 'net.br', 'org.br', 'gov.br',
  // 中国
  'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn',
  // 新西兰
  'co.nz', 'net.nz', 'org.nz', 'govt.nz',
  // 南非
  'co.za', 'net.za', 'org.za', 'gov.za',
  // 台湾
  'com.tw', 'net.tw', 'org.tw', 'gov.tw',
  // 以色列
  'co.il', 'net.il', 'org.il', 'gov.il',
  // 其他常见
  'com.sg', 'net.sg', 'org.sg',
  'com.hk', 'net.hk', 'org.hk',
  'com.mx', 'net.mx', 'org.mx',
  'com.ar', 'net.ar', 'org.ar',
  'co.th', 'or.th', 'go.th',
  'co.id', 'or.id', 'go.id',
  'com.vn', 'net.vn', 'org.vn',
  // 欧洲
  'co.at', 'or.at',
  'com.pl', 'net.pl', 'org.pl',
  'co.no',
  'com.se', 'org.se',
  'com.dk', 'org.dk',
  'com.fi', 'org.fi',
  'com.pt', 'org.pt',
  'com.gr', 'net.gr', 'org.gr',
  'com.ua', 'net.ua', 'org.ua',
  'com.ro', 'net.ro', 'org.ro',
  'com.bg', 'net.bg', 'org.bg',
  'com.hr', 'net.hr', 'org.hr',
  'com.sk', 'net.sk', 'org.sk',
  'com.si', 'net.si', 'org.si',
  'com.ee', 'net.ee', 'org.ee',
  'com.lv', 'net.lv', 'org.lv',
  'com.lt', 'net.lt', 'org.lt',
]);

/**
 * 从 hostname 提取注册域名（eTLD+1）
 */
function extractDomain(hostname) {
  if (!hostname || typeof hostname !== 'string') return '';

  // 去除前导点和空白
  hostname = hostname.replace(/^\.+/, '').trim().toLowerCase();

  if (!hostname) return '';

  // IP 地址直接返回
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(hostname)) return hostname;
  if (/^[0-9a-f:]+$/i.test(hostname)) return hostname;

  // 处理 localhost
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) return 'localhost';

  // 分割域名各部分
  const parts = hostname.split('.');
  if (parts.length < 2) return hostname;

  // 检查是否为两级 TLD
  if (parts.length >= 3) {
    const lastTwo = parts.slice(-2).join('.');
    if (TWO_LEVEL_TLDS.has(lastTwo)) {
      return parts.slice(-3).join('.');
    }
  }

  // 默认：取最后两级
  return parts.slice(-2).join('.');
}

/**
 * 从完整 URL 中提取注册域名
 */
function extractDomainFromUrl(urlString) {
  if (!urlString || typeof urlString !== 'string') return '';

  try {
    const url = new URL(urlString);
    return extractDomain(url.hostname);
  } catch (e) {
    // 尝试处理不完整的 URL
    const match = urlString.match(/^(?:https?:\/\/)?([^\/:?#]+)/i);
    if (match) {
      return extractDomain(match[1]);
    }
    return '';
  }
}

/**
 * 判断域名是否为第三方
 */
function isThirdParty(sourceDomain, targetDomain) {
  if (!sourceDomain || !targetDomain) return false;
  return sourceDomain !== targetDomain &&
         !targetDomain.endsWith('.' + sourceDomain) &&
         !sourceDomain.endsWith('.' + targetDomain);
}

/**
 * 从 URL/Hostname 提取完整域名（不仅 eTLD+1）
 */
function getFullDomain(urlString) {
  if (!urlString) return '';

  try {
    const url = new URL(urlString);
    return url.hostname.replace(/^\.+/, '').toLowerCase();
  } catch (e) {
    // 尝试作为 hostname 解析
    return urlString.replace(/^\.+/, '').toLowerCase().split('/')[0].split(':')[0];
  }
}

// 在 content script 和 service worker 上下文均可使用
if (typeof window !== 'undefined') {
  window.extractDomain = extractDomain;
  window.extractDomainFromUrl = extractDomainFromUrl;
  window.isThirdParty = isThirdParty;
  window.getFullDomain = getFullDomain;
}
