/**
 * 浏览器指纹采集器
 * 提供 8 个维度的指纹采集 + 独特性判定 + 熵值计算
 * 所有采集在调用方上下文（popup）中执行
 */

const FingerprintCollector = {
  /**
   * 采集全部 8 个维度
   * @returns {Promise<Array>} [{ id, name, icon, value, level, detail, entropyBits }]
   */
  async collectAll() {
    const results = [];
    results.push(this.collectUserAgent());
    results.push(this.collectScreen());
    results.push(this.collectTimezone());
    results.push(await this.collectFonts());
    results.push(this.collectWebGL());
    results.push(this.collectAudio());
    results.push(this.collectCanvasHash());
    results.push(this.collectHardwareConcurrency());
    return results;
  },

  /**
   * 计算总熵值
   */
  calculateTotalEntropy(results) {
    return results.reduce((sum, r) => sum + r.entropyBits, 0);
  },

  /**
   * 获取熵值等级解读
   */
  getEntropyLevel(totalBits) {
    if (totalBits <= 15) return { level: 'low', color: '#22c55e', label: '低 — 你的浏览器很普通，不易被追踪' };
    if (totalBits <= 25) return { level: 'medium', color: '#eab308', label: '偏高 — 有一定识别度' };
    return { level: 'high', color: '#ef4444', label: '高 — 你的浏览器高度独特，容易被精确追踪' };
  },

  // ============================================================
  // 1. User-Agent
  // ============================================================
  collectUserAgent() {
    const ua = navigator.userAgent || '';
    const platform = navigator.platform || '';
    const languages = (navigator.languages || []).join(', ');
    const vendor = navigator.vendor || '';

    let level = 'unique';
    const isChrome = ua.includes('Chrome/');
    const isEdge = ua.includes('Edg/');
    const isFirefox = ua.includes('Firefox/');
    const isSafari = ua.includes('Safari/') && !isChrome;
    const isWin = platform.includes('Win');
    const isMac = platform.includes('Mac');
    const isLinux = platform.includes('Linux');

    if ((isChrome || isEdge || isFirefox || isSafari) && (isWin || isMac)) {
      level = 'common';
    } else if ((isChrome || isEdge || isFirefox) && isLinux) {
      level = 'uncommon';
    } else if (isSafari || isChrome || isEdge) {
      level = 'uncommon';
    }

    const entropyBits = level === 'common' ? 3 : level === 'uncommon' ? 7 : 11;

    return {
      id: 'userAgent',
      name: 'User-Agent',
      icon: '🌐',
      value: ua.substring(0, 80) + (ua.length > 80 ? '...' : ''),
      level,
      entropyBits,
      detail: [
        { label: '浏览器标识', value: ua },
        { label: '平台', value: platform },
        { label: '语言', value: languages || navigator.language },
        { label: '厂商', value: vendor }
      ]
    };
  },

  // ============================================================
  // 2. 屏幕 & 视口
  // ============================================================
  collectScreen() {
    const w = screen.width, h = screen.height;
    const aw = screen.availWidth, ah = screen.availHeight;
    const dpr = devicePixelRatio || 1;
    const colorDepth = screen.colorDepth;
    const innerW = window.innerWidth, innerH = window.innerHeight;
    const resolutionKey = `${w}×${h}`;

    const commonResolutions = [
      '1920×1080', '2560×1440', '1366×768', '1536×864',
      '1440×900', '1680×1050', '1280×720', '3840×2160'
    ];

    let level = 'unique';
    if (commonResolutions.includes(resolutionKey) && dpr === 1 && colorDepth === 24) {
      level = 'common';
    } else if (commonResolutions.includes(resolutionKey) || (colorDepth >= 24 && dpr <= 2)) {
      level = 'uncommon';
    }

    const entropyBits = level === 'common' ? 2 : level === 'uncommon' ? 5 : 8;

    return {
      id: 'screen',
      name: '屏幕 & 视口',
      icon: '🖥️',
      value: `${w}×${h} · ${colorDepth}bit · ${dpr}x`,
      level,
      entropyBits,
      detail: [
        { label: '屏幕分辨率', value: `${w}×${h}` },
        { label: '可用区域', value: `${aw}×${ah}` },
        { label: '色深', value: `${colorDepth} bit` },
        { label: '像素比', value: `${dpr}x` },
        { label: '窗口尺寸', value: `${innerW}×${innerH}` }
      ]
    };
  },

  // ============================================================
  // 3. 时区
  // ============================================================
  collectTimezone() {
    let timezone = '';
    try {
      timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    } catch (e) {
      timezone = '未知';
    }

    const commonTimezones = [
      'Asia/Shanghai', 'Asia/Tokyo', 'Asia/Seoul', 'Asia/Singapore',
      'America/New_York', 'America/Chicago', 'America/Los_Angeles',
      'Europe/London', 'Europe/Berlin', 'Europe/Paris',
      'Australia/Sydney', 'Pacific/Auckland'
    ];

    const halfHourTZs = ['Asia/Kolkata', 'Asia/Kathmandu', 'Australia/Adelaide', 'Asia/Tehran', 'Asia/Kabul'];

    let level = 'unique';
    if (commonTimezones.includes(timezone)) {
      level = 'common';
    } else if (halfHourTZs.some(tz => timezone.includes(tz) || timezone.startsWith(tz.split('/')[0]))) {
      level = 'uncommon';
    }

    const entropyBits = level === 'common' ? 1 : level === 'uncommon' ? 3 : 5;

    return {
      id: 'timezone',
      name: '时区',
      icon: '🕐',
      value: timezone,
      level,
      entropyBits,
      detail: [
        { label: 'IANA 时区', value: timezone },
        { label: 'UTC 偏移', value: `UTC${new Date().toString().match(/GMT([+-]\d+)/)?.[1] || '未知'}` }
      ]
    };
  },

  // ============================================================
  // 4. 字体列表
  // ============================================================
  async collectFonts() {
    const testFonts = [
      // Windows 默认
      'Arial', 'Arial Black', 'Calibri', 'Cambria', 'Candara', 'Comic Sans MS',
      'Consolas', 'Constantia', 'Corbel', 'Courier New', 'Ebrima', 'Franklin Gothic Medium',
      'Gabriola', 'Gadugi', 'Georgia', 'Impact', 'Leelawadee UI', 'Lucida Console',
      'Lucida Sans Unicode', 'Malgun Gothic', 'Marlett', 'Microsoft Himalaya',
      'Microsoft JhengHei', 'Microsoft PhagsPa', 'Microsoft Sans Serif', 'Microsoft Tai Le',
      'Microsoft YaHei', 'Microsoft Yi Baiti', 'MingLiU', 'Mongolian Baiti',
      'MS Gothic', 'MS PGothic', 'MS UI Gothic', 'MV Boli', 'NSimSun', 'Nirmala UI',
      'Palatino Linotype', 'Segoe Print', 'Segoe Script', 'Segoe UI', 'Segoe UI Emoji',
      'Segoe UI Historic', 'Segoe UI Symbol', 'SimHei', 'SimSun', 'Sitka',
      'Sylfaen', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana', 'Webdings', 'Wingdings',
      // macOS 默认
      'Helvetica', 'Helvetica Neue', 'SF Pro Display', 'SF Pro Text', 'SF Mono',
      'Menlo', 'Monaco', 'Apple Color Emoji', 'Apple SD Gothic Neo', 'Hiragino Sans',
      'Hiragino Kaku Gothic ProN', 'Osaka', 'STHeiti', 'STSong', 'PingFang SC',
      'PingFang TC', 'PingFang HK', 'Kaiti SC', 'Songti SC', 'Heiti SC',
      // Office / Adobe
      'Arial Narrow', 'Arial Rounded MT Bold', 'Baskerville Old Face', 'Bodoni MT',
      'Book Antiqua', 'Bookman Old Style', 'Century Gothic', 'Copperplate Gothic',
      'Garamond', 'Gill Sans MT', 'Goudy Old Style', 'Lucida Bright', 'Lucida Calligraphy',
      'Lucida Fax', 'Lucida Handwriting', 'Perpetua', 'Rockwell', 'Tw Cen MT',
      'Adobe Arabic', 'Adobe Caslon Pro', 'Adobe Garamond Pro', 'Adobe Hebrew',
      'Adobe Jenson Pro', 'Myriad Pro', 'Minion Pro',
      // Google Fonts / 常见设计字体
      'Roboto', 'Open Sans', 'Lato', 'Montserrat', 'Oswald', 'Raleway',
      'PT Sans', 'Ubuntu', 'Source Sans Pro', 'Noto Sans', 'Noto Sans SC',
      'Noto Serif', 'Noto Serif SC', 'Droid Sans', 'Droid Serif',
      'Fira Sans', 'Fira Code', 'JetBrains Mono', 'Cascadia Code',
      // 中文字体
      'FangSong', 'KaiTi', 'YouYuan', 'DengXian', 'FZShuTi', 'FZYaoti',
      'Microsoft YaHei UI', 'Microsoft JhengHei UI'
    ];

    const detected = [];

    for (const font of testFonts) {
      try {
        const available = document.fonts.check(`12px "${font}"`);
        if (available) detected.push(font);
      } catch (e) {
        // 字体名无效，跳过
      }
    }

    let level = 'common';
    if (detected.length > 150) level = 'unique';
    else if (detected.length >= 50) level = 'uncommon';

    const entropyBits = level === 'common' ? 4 : level === 'uncommon' ? 9 : 14;

    return {
      id: 'fonts',
      name: '已安装字体',
      icon: '🔤',
      value: `${detected.length} 款`,
      level,
      entropyBits,
      detail: [
        { label: '检测到', value: `${detected.length} 款（共检测 ${testFonts.length} 款常见字体）` },
        { label: '字体列表', value: detected.join(', ') }
      ]
    };
  },

  // ============================================================
  // 5. WebGL
  // ============================================================
  collectWebGL() {
    let renderer = '不可用';
    let vendor = '不可用';
    let level = 'common';
    let entropyBits = 3;

    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (!gl) {
        return {
          id: 'webgl',
          name: 'WebGL',
          icon: '🎮',
          value: 'WebGL 不可用',
          level: 'common',
          entropyBits: 0,
          detail: [{ label: '状态', value: 'WebGL 未启用或不支持' }]
        };
      }

      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      if (debugInfo) {
        renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || '未知';
        vendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) || '未知';
      }

      const rLower = renderer.toLowerCase();
      const commonGPUs = [
        'intel', 'uhd', 'iris', 'hd graphics',
        'rtx 3060', 'rtx 4060', 'rtx 3070', 'rtx 3080', 'rtx 4070',
        'rtx 2060', 'gtx 1660', 'gtx 1650',
        'radeon', 'apple m1', 'apple m2', 'apple m3',
        'adreno', 'mali'
      ];

      const isCommonGPU = commonGPUs.some(gpu => rLower.includes(gpu));

      if (isCommonGPU) {
        level = 'common';
        entropyBits = 3;
      } else {
        level = 'uncommon';
        entropyBits = 5;
      }
    } catch (e) {
      level = 'common';
      entropyBits = 0;
    }

    return {
      id: 'webgl',
      name: 'WebGL',
      icon: '🎮',
      value: renderer.length > 60 ? renderer.substring(0, 60) + '...' : renderer,
      level,
      entropyBits,
      detail: [
        { label: 'GPU 渲染器', value: renderer },
        { label: '厂商', value: vendor }
      ]
    };
  },

  // ============================================================
  // 6. AudioContext
  // ============================================================
  collectAudio() {
    let sampleRate = '不可用';
    let maxChannels = '不可用';
    let baseLatency = '不可用';
    let outputLatency = '不可用';
    let level = 'common';
    let entropyBits = 2;

    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) {
        return {
          id: 'audio',
          name: 'AudioContext',
          icon: '🔊',
          value: 'AudioContext 不可用',
          level: 'common',
          entropyBits: 0,
          detail: [{ label: '状态', value: 'AudioContext API 不支持' }]
        };
      }

      const ctx = new AudioCtx();
      sampleRate = ctx.sampleRate;
      maxChannels = ctx.destination.maxChannelCount;
      baseLatency = (ctx.baseLatency * 1000).toFixed(1) + 'ms';
      outputLatency = (ctx.outputLatency * 1000).toFixed(1) + 'ms';

      const isCommonRate = sampleRate === 44100 || sampleRate === 48000;
      const isCommonChannels = maxChannels === 2;

      if (isCommonRate && isCommonChannels) {
        level = 'common';
        entropyBits = 2;
      } else {
        level = 'uncommon';
        entropyBits = 4;
      }

      ctx.close();
    } catch (e) {
      level = 'common';
      entropyBits = 0;
    }

    return {
      id: 'audio',
      name: 'AudioContext',
      icon: '🔊',
      value: `采样率 ${sampleRate} · ${maxChannels}通道`,
      level,
      entropyBits,
      detail: [
        { label: '采样率', value: `${sampleRate} Hz` },
        { label: '最大通道数', value: `${maxChannels}` },
        { label: '基础延迟', value: baseLatency },
        { label: '输出延迟', value: outputLatency }
      ]
    };
  },

  // ============================================================
  // 7. Canvas 哈希
  // ============================================================
  collectCanvasHash() {
    let hash = '不可用';
    let level = 'common';
    let entropyBits = 3;

    try {
      const canvas = document.createElement('canvas');
      canvas.width = 280;
      canvas.height = 60;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        return {
          id: 'canvasHash',
          name: 'Canvas 指纹',
          icon: '🎨',
          value: 'Canvas 2D 不可用',
          level: 'common',
          entropyBits: 0,
          detail: [{ label: '状态', value: 'Canvas 2D 上下文不可用' }]
        };
      }

      // 绘制测试图形（标准指纹检测图案）
      ctx.textBaseline = 'top';
      ctx.font = '14px Arial';
      ctx.fillStyle = '#f60';
      ctx.fillRect(125, 1, 62, 20);
      ctx.fillStyle = '#069';
      ctx.fillText('PrivacyShield <canvas> fp', 2, 15);
      ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
      ctx.fillText('PrivacyShield <canvas> fp', 4, 17);

      const dataUrl = canvas.toDataURL();
      hash = crc32(dataUrl);

      level = 'uncommon';
      entropyBits = 5;
    } catch (e) {
      level = 'common';
      entropyBits = 0;
    }

    return {
      id: 'canvasHash',
      name: 'Canvas 指纹',
      icon: '🎨',
      value: '样本哈希: ' + hash,
      level,
      entropyBits,
      detail: [
        { label: '哈希值', value: hash },
        { label: '说明', value: '通过离屏 Canvas 绘制测试图形后提取 toDataURL 生成哈希。不同浏览器/OS/GPU 组合产生不同哈希。' }
      ]
    };
  },

  // ============================================================
  // 8. 硬件并发
  // ============================================================
  collectHardwareConcurrency() {
    const cores = navigator.hardwareConcurrency || '未知';

    let level = 'unique';
    if (cores === 4 || cores === 8 || cores === 16) {
      level = 'common';
    } else if (cores === 2 || cores === 6 || cores === 12 || cores === 24) {
      level = 'uncommon';
    }

    const entropyBits = level === 'common' ? 2 : level === 'uncommon' ? 4 : 6;

    return {
      id: 'hardware',
      name: '硬件并发',
      icon: '⚙️',
      value: cores + ' 核',
      level,
      entropyBits,
      detail: [
        { label: '逻辑核心数', value: String(cores) },
        { label: '说明', value: 'navigator.hardwareConcurrency，用于判断 CPU 核心数，是常见的指纹维度之一。' }
      ]
    };
  }
};

// ============================================================
// CRC32 哈希函数（用于 Canvas 指纹）
// ============================================================
function crc32(str) {
  const table = [];
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c;
  }

  let crc = 0xFFFFFFFF;
  for (let i = 0; i < str.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ str.charCodeAt(i)) & 0xFF];
  }
  crc = (crc ^ 0xFFFFFFFF) >>> 0;
  return crc.toString(16).padStart(8, '0');
}
