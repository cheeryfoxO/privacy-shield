/**
 * WebRTC 泄漏检测器
 * Hook RTCPeerConnection 构造函数，拦截 ICE candidates
 * 检测本地 IP 地址泄漏
 */

(function() {
  'use strict';

  // 存储检测到的泄漏事件
  const leakEvents = [];
  window.__PRIVACY_WEBRTC_EVENTS = leakEvents;

  // 获取原生 RTCPeerConnection
  const _RTCPeerConnection = window.RTCPeerConnection || window.webkitRTCPeerConnection;

  // 如果没有 WebRTC 支持，静默退出
  if (!_RTCPeerConnection) {
    window.__PRIVACY_WEBRTC_DISABLED = true;
    return;
  }

  // ============================================================
  // IP 地址匹配正则
  // ============================================================
  const IPV4_REGEX = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/g;
  const IPV6_REGEX = /([0-9a-f]{1,4}(:[0-9a-f]{1,4}){1,7}|[0-9a-f]{1,4}(:[0-9a-f]{1,4}){0,7}::[0-9a-f]{0,4}(:[0-9a-f]{1,4}){0,7})/gi;

  /**
   * 分类 IP 地址
   * RFC 1918 私有地址 + 链路本地 + 回环
   */
  function classifyIP(ip) {
    // 回环地址（不视为泄漏）
    if (ip === '127.0.0.1' || ip === '::1' || ip === '0.0.0.0' || ip === '::') {
      return 'loopback';
    }

    // IPv4 私有地址（RFC 1918）
    const parts = ip.split('.');
    if (parts.length === 4) {
      const first = parseInt(parts[0], 10);
      const second = parseInt(parts[1], 10);

      // 10.0.0.0/8
      if (first === 10) return 'host-private';

      // 172.16.0.0/12
      if (first === 172 && second >= 16 && second <= 31) return 'host-private';

      // 192.168.0.0/16
      if (first === 192 && second === 168) return 'host-private';

      // 169.254.0.0/16 (链路本地)
      if (first === 169 && second === 254) return 'host-link-local';

      // 其他公网 IP
      return 'host-public';
    }

    // IPv6
    if (ip.includes(':')) {
      // 链路本地
      if (ip.toLowerCase().startsWith('fe80')) return 'host-link-local';
      // 回环
      if (ip === '::1') return 'loopback';
      // 唯一本地 (ULA)
      if (ip.toLowerCase().startsWith('fc') || ip.toLowerCase().startsWith('fd')) return 'host-private';
      return 'host-public';
    }

    return 'host-public';
  }

  /**
   * 从 ICE candidate 字符串中提取 IP 地址
   */
  function extractIPsFromCandidate(candidateStr) {
    if (!candidateStr) return [];

    // 重置 regex lastIndex
    IPV4_REGEX.lastIndex = 0;
    IPV6_REGEX.lastIndex = 0;

    const ips = [];
    let match;

    // 提取 IPv4
    while ((match = IPV4_REGEX.exec(candidateStr)) !== null) {
      ips.push(match[1]);
    }

    // 提取 IPv6
    while ((match = IPV6_REGEX.exec(candidateStr)) !== null) {
      ips.push(match[1]);
    }

    return ips;
  }

  /**
   * 获取调用栈（截断版本）
   */
  function getCallStack() {
    try {
      const stack = new Error().stack;
      if (stack) {
        const lines = stack.split('\n').slice(3, 8);
        return lines.join('\n');
      }
    } catch (e) {}
    return '';
  }

  // ============================================================
  // Hook RTCPeerConnection 构造函数
  // ============================================================

  function PatchedRTCPeerConnection(config, constraints) {
    const peerConnection = new _RTCPeerConnection(config, constraints);

    // 保存原始 addEventListener
    const _addEventListener = EventTarget.prototype.addEventListener;

    // Hook addEventListener 拦截 icecandidate 事件
    peerConnection.addEventListener = function(type, listener, options) {
      if (type === 'icecandidate') {
        const wrappedListener = function(event) {
          processIceCandidateEvent(event);
          return listener.call(this, event);
        };
        return _addEventListener.call(this, type, wrappedListener, options);
      }
      return _addEventListener.call(this, type, listener, options);
    };

    // 同时 Hook onicecandidate 属性设置器
    try {
      let _onIceCandidate = null;
      Object.defineProperty(peerConnection, 'onicecandidate', {
        get: function() {
          return _onIceCandidate;
        },
        set: function(handler) {
          _onIceCandidate = function(event) {
            processIceCandidateEvent(event);
            if (handler) handler.call(this, event);
          };
        },
        enumerable: true,
        configurable: true
      });
    } catch (e) {
      // 某些浏览器可能不支持重定义属性
    }

    return peerConnection;
  }

  // 复制 prototype
  PatchedRTCPeerConnection.prototype = _RTCPeerConnection.prototype;

  /**
   * 处理 ICE candidate 事件
   */
  function processIceCandidateEvent(event) {
    if (!event.candidate || !event.candidate.candidate) return;

    const candidateStr = event.candidate.candidate;
    const candidateType = event.candidate.type || 'unknown';
    const ips = extractIPsFromCandidate(candidateStr);

    for (const ip of ips) {
      const classification = classifyIP(ip);

      // 忽略回环地址
      if (classification === 'loopback') continue;

      leakEvents.push({
        timestamp: Date.now(),
        ipAddress: ip,
        candidateType: candidateType,
        ipClassification: classification,
        fullCandidate: candidateStr.substring(0, 200), // 截断
        callStack: getCallStack()
      });
    }
  }

  // 替换全局 RTCPeerConnection
  window.RTCPeerConnection = PatchedRTCPeerConnection;
  if (window.webkitRTCPeerConnection) {
    window.webkitRTCPeerConnection = PatchedRTCPeerConnection;
  }

  /**
   * 获取 WebRTC 泄漏检测结果
   */
  function getWebRtcLeakReport() {
    if (leakEvents.length === 0) {
      return { detected: false, events: [] };
    }

    return {
      detected: true,
      events: leakEvents.slice(), // 返回副本
      summary: {
        totalLeaks: leakEvents.length,
        privateIPLeaks: leakEvents.filter(e =>
          e.ipClassification === 'host-private').length,
        publicIPLeaks: leakEvents.filter(e =>
          e.ipClassification === 'host-public' || e.candidateType === 'srflx').length,
        srflxCandidates: leakEvents.filter(e =>
          e.candidateType === 'srflx').length,
        hostCandidates: leakEvents.filter(e =>
          e.candidateType === 'host').length,
        uniqueIPs: new Set(leakEvents.map(e => e.ipAddress)).size
      }
    };
  }

  // 导出获取函数
  window.__PRIVACY_GET_WEBRTC_REPORT = getWebRtcLeakReport;
})();
