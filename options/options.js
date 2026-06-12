/**
 * 隐私护盾 - 选项页面逻辑
 * 加载/保存用户设置
 */

document.addEventListener('DOMContentLoaded', init);

// ============================================================
// 默认选项
// ============================================================
const DEFAULTS = {
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
  notifyOnHighRisk: false,
  adBlockerEnabled: true,
  adWhitelist: []
};

// ============================================================
// 初始化
// ============================================================
async function init() {
  // 加载已保存的选项
  const options = await loadOptions();
  applyOptionsToForm(options);

  // 绑定事件
  document.getElementById('optionsForm').addEventListener('submit', saveOptions);

  document.getElementById('btnReset').addEventListener('click', () => {
    if (confirm('确定要恢复默认设置吗？')) {
      applyOptionsToForm(DEFAULTS);
      saveToStorage(DEFAULTS);
      showToast('已恢复默认设置');
    }
  });

  // 权重滑块联动
  bindWeightSliders();

  // 更新权重总计
  updateWeightTotal();
}

// ============================================================
// 加载选项
// ============================================================
async function loadOptions() {
  try {
    const result = await chrome.storage.sync.get(['options']);
    if (result.options) {
      return mergeWithDefaults(result.options);
    }
  } catch (e) {
    console.error('加载选项失败:', e);
  }
  return { ...DEFAULTS };
}

function mergeWithDefaults(userOptions) {
  return {
    ...DEFAULTS,
    ...userOptions,
    scoreWeights: {
      ...DEFAULTS.scoreWeights,
      ...(userOptions.scoreWeights || {})
    }
  };
}

// ============================================================
// 应用选项到表单
// ============================================================
function applyOptionsToForm(options) {
  const form = document.getElementById('optionsForm');

  // 开关
  form.elements.enableThirdPartyDetection.checked = options.enableThirdPartyDetection;
  form.elements.enableCookieInspection.checked = options.enableCookieInspection;
  form.elements.enableCanvasDetection.checked = options.enableCanvasDetection;
  form.elements.enableWebRtcDetection.checked = options.enableWebRtcDetection;

  // 权重
  form.elements.weightThirdPartyDomains.value = options.scoreWeights.thirdPartyDomains;
  form.elements.weightThirdPartyDomainsNum.value = options.scoreWeights.thirdPartyDomains;
  form.elements.weightCookies.value = options.scoreWeights.cookies;
  form.elements.weightCookiesNum.value = options.scoreWeights.cookies;
  form.elements.weightCanvasFingerprinting.value = options.scoreWeights.canvasFingerprinting;
  form.elements.weightCanvasFingerprintingNum.value = options.scoreWeights.canvasFingerprinting;
  form.elements.weightWebrtcLeaks.value = options.scoreWeights.webrtcLeaks;
  form.elements.weightWebrtcLeaksNum.value = options.scoreWeights.webrtcLeaks;

  // 白名单
  form.elements.whitelistedDomains.value = (options.whitelistedDomains || []).join(', ');

  // 广告拦截
  form.elements.adBlockerEnabled.checked = options.adBlockerEnabled !== false;
  form.elements.adWhitelist.value = (options.adWhitelist || []).join('\n');
}

// ============================================================
// 保存选项
// ============================================================
async function saveOptions(event) {
  event.preventDefault();

  const form = document.getElementById('optionsForm');

  // 验证权重总和
  const weights = {
    thirdPartyDomains: parseInt(form.elements.weightThirdPartyDomains.value) || 0,
    cookies: parseInt(form.elements.weightCookies.value) || 0,
    canvasFingerprinting: parseInt(form.elements.weightCanvasFingerprinting.value) || 0,
    webrtcLeaks: parseInt(form.elements.weightWebrtcLeaks.value) || 0
  };

  const total = Object.values(weights).reduce((sum, w) => sum + w, 0);
  if (total !== 100) {
    showToast('⚠️ 权重总和必须为 100（当前: ' + total + '）', true);
    return;
  }

  const options = {
    enableThirdPartyDetection: form.elements.enableThirdPartyDetection.checked,
    enableCookieInspection: form.elements.enableCookieInspection.checked,
    enableCanvasDetection: form.elements.enableCanvasDetection.checked,
    enableWebRtcDetection: form.elements.enableWebRtcDetection.checked,
    scoreWeights: weights,
    whitelistedDomains: form.elements.whitelistedDomains.value
      .split(',')
      .map(s => s.trim())
      .filter(Boolean),
    notifyOnHighRisk: false,
    adBlockerEnabled: form.elements.adBlockerEnabled.checked,
    adWhitelist: (form.elements.adWhitelist.value || '')
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean)
  };

  await saveToStorage(options);
  showToast('✅ 设置已保存');
}

async function saveToStorage(options) {
  try {
    await chrome.storage.sync.set({ options: options });
  } catch (e) {
    console.error('保存选项失败:', e);
    showToast('❌ 保存失败，请重试', true);
  }
}

// ============================================================
// 权重滑块联动
// ============================================================
function bindWeightSliders() {
  const pairs = [
    { slider: 'weightThirdPartyDomains', number: 'weightThirdPartyDomainsNum' },
    { slider: 'weightCookies', number: 'weightCookiesNum' },
    { slider: 'weightCanvasFingerprinting', number: 'weightCanvasFingerprintingNum' },
    { slider: 'weightWebrtcLeaks', number: 'weightWebrtcLeaksNum' }
  ];

  for (const pair of pairs) {
    const slider = document.querySelector(`[name="${pair.slider}"]`);
    const number = document.querySelector(`[name="${pair.number}"]`);

    if (!slider || !number) continue;

    // 滑块 -> 数字
    slider.addEventListener('input', () => {
      number.value = slider.value;
      updateWeightTotal();
    });

    // 数字 -> 滑块
    number.addEventListener('input', () => {
      const val = parseInt(number.value);
      if (!isNaN(val) && val >= 0 && val <= 60) {
        slider.value = val;
      }
      updateWeightTotal();
    });

    number.addEventListener('change', () => {
      let val = parseInt(number.value);
      if (isNaN(val)) val = 0;
      val = Math.max(0, Math.min(60, val));
      number.value = val;
      slider.value = val;
      updateWeightTotal();
    });
  }
}

function updateWeightTotal() {
  const weights = {
    thirdPartyDomains: parseInt(document.querySelector('[name="weightThirdPartyDomains"]').value) || 0,
    cookies: parseInt(document.querySelector('[name="weightCookies"]').value) || 0,
    canvasFingerprinting: parseInt(document.querySelector('[name="weightCanvasFingerprinting"]').value) || 0,
    webrtcLeaks: parseInt(document.querySelector('[name="weightWebrtcLeaks"]').value) || 0
  };

  const total = Object.values(weights).reduce((sum, w) => sum + w, 0);

  document.getElementById('weightTotal').textContent = total;

  const warning = document.getElementById('weightWarning');
  if (total !== 100) {
    warning.style.display = 'inline';
    warning.textContent = `⚠️ 权重总和必须为 100（当前: ${total}）`;
  } else {
    warning.style.display = 'none';
  }
}

// ============================================================
// Toast 提示
// ============================================================
function showToast(message, isError) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.style.display = 'block';
  if (isError) {
    toast.style.background = 'var(--color-red)';
  } else {
    toast.style.background = '';
  }

  // 2.5 秒后自动消失
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => {
    toast.style.display = 'none';
  }, 2500);
}
