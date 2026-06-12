/**
 * Canvas 指纹检测器
 * 在 document_start 阶段 Monkey-patch Canvas 相关 API
 * 检测常见的浏览器指纹行为
 */

(function() {
  'use strict';

  // 存储检测到的事件
  const detectedEvents = [];
  window.__PRIVACY_CANVAS_EVENTS = detectedEvents;

  // 使用 WeakMap 存储 Canvas 元数据（不阻止 GC）
  const canvasMetadata = new WeakMap();

  // 保存原生引用
  const _createElement = document.createElement.bind(document);
  const _toDataURL = HTMLCanvasElement.prototype.toDataURL;
  const _toBlob = HTMLCanvasElement.prototype.toBlob;
  const _getContext = HTMLCanvasElement.prototype.getContext;
  const _getImageData = CanvasRenderingContext2D.prototype.getImageData;
  const _fillText = CanvasRenderingContext2D.prototype.fillText;
  const _measureText = CanvasRenderingContext2D.prototype.measureText;
  const _setAttribute = Element.prototype.setAttribute;

  // ============================================================
  // 1. Hook document.createElement — 追踪 Canvas 创建
  // ============================================================
  document.createElement = function(tagName, options) {
    const element = _createElement(tagName, options);

    if (tagName.toLowerCase() === 'canvas') {
      canvasMetadata.set(element, {
        created: Date.now(),
        addedToDOM: false,
        contexts: new Set(),
        exoticTextUsed: false,
        fontsUsed: new Set(),
        getContextCalled: false
      });
    }

    return element;
  };

  // ============================================================
  // 2. Hook appendChild / insertBefore — 追踪 DOM 插入
  // ============================================================
  const _appendChild = Node.prototype.appendChild;
  const _insertBefore = Node.prototype.insertBefore;

  function markAddedToDOM(node) {
    if (node.nodeName === 'CANVAS' || node instanceof HTMLCanvasElement) {
      const meta = canvasMetadata.get(node);
      if (meta) {
        meta.addedToDOM = true;
        meta.addedToDOMTime = Date.now();
      }
    }
    // 递归检查子元素
    if (node.querySelectorAll) {
      const canvases = node.querySelectorAll('canvas');
      for (const canvas of canvases) {
        const meta = canvasMetadata.get(canvas);
        if (meta) {
          meta.addedToDOM = true;
          meta.addedToDOMTime = Date.now();
        }
      }
    }
  }

  Node.prototype.appendChild = function(child) {
    markAddedToDOM(child);
    return _appendChild.call(this, child);
  };

  Node.prototype.insertBefore = function(newNode, referenceNode) {
    markAddedToDOM(newNode);
    return _insertBefore.call(this, newNode, referenceNode);
  };

  // ============================================================
  // 3. Hook HTMLCanvasElement.prototype.getContext — 追踪 Context
  // ============================================================
  HTMLCanvasElement.prototype.getContext = function(contextType, contextAttributes) {
    const ctx = _getContext.apply(this, arguments);

    if (ctx && (contextType === '2d' || contextType === 'webgl' || contextType === 'webgl2')) {
      const meta = canvasMetadata.get(this);
      if (meta) {
        meta.getContextCalled = true;
        meta.contextType = contextType;
      }

      // 为 2D context 创建追踪代理
      if (contextType === '2d' && meta) {
        meta.contexts.add(ctx);
      }
    }

    return ctx;
  };

  // ============================================================
  // 4. Hook CanvasRenderingContext2D.prototype.fillText — 检测异形文字/字体
  // ============================================================
  CanvasRenderingContext2D.prototype.fillText = function(text, x, y, maxWidth) {
    const canvas = this.canvas;
    if (canvas) {
      const meta = canvasMetadata.get(canvas);
      if (meta) {
        // 检测异形文字（非基本 Latin + 扩展 Latin）
        checkExoticText(text, meta);
        // 记录字体
        if (this.font) {
          recordFont(this.font, meta);
        }
      }
    }
    return _fillText.apply(this, arguments);
  };

  // ============================================================
  // 5. Hook CanvasRenderingContext2D.prototype.measureText — 字体枚举检测
  // ============================================================
  CanvasRenderingContext2D.prototype.measureText = function(text) {
    const canvas = this.canvas;
    if (canvas) {
      const meta = canvasMetadata.get(canvas);
      if (meta) {
        checkExoticText(text, meta);
        if (this.font) {
          recordFont(this.font, meta);
        }
      }
    }
    return _measureText.apply(this, arguments);
  };

  // ============================================================
  // 6. Hook HTMLCanvasElement.prototype.toDataURL
  // ============================================================
  HTMLCanvasElement.prototype.toDataURL = function(type, encoderOptions) {
    const meta = canvasMetadata.get(this);
    const event = buildCanvasEvent(this, meta, 'toDataURL');

    const result = _toDataURL.apply(this, arguments);
    event.dataURLLength = result ? result.length : 0;

    // 如果 data URL 结果很短，高度可疑（指纹散列通常很短）
    if (event.dataURLLength > 0 && event.dataURLLength < 5000) {
      event.suspiciousDataSize = true;
    }

    detectedEvents.push(event);
    return result;
  };

  // ============================================================
  // 7. Hook HTMLCanvasElement.prototype.toBlob
  // ============================================================
  HTMLCanvasElement.prototype.toBlob = function(callback, type, quality) {
    const meta = canvasMetadata.get(this);
    const event = buildCanvasEvent(this, meta, 'toBlob');

    const wrappedCallback = function(blob) {
      event.dataURLLength = blob ? blob.size : 0;
      if (event.dataURLLength > 0 && event.dataURLLength < 5000) {
        event.suspiciousDataSize = true;
      }
      detectedEvents.push(event);
      if (callback) callback(blob);
    };

    return _toBlob.call(this, wrappedCallback, type, quality);
  };

  // ============================================================
  // 8. Hook CanvasRenderingContext2D.prototype.getImageData
  // ============================================================
  CanvasRenderingContext2D.prototype.getImageData = function(sx, sy, sw, sh) {
    const canvas = this.canvas;
    const meta = canvas ? canvasMetadata.get(canvas) : null;
    const event = buildCanvasEvent(canvas, meta, 'getImageData');

    detectedEvents.push(event);
    return _getImageData.apply(this, arguments);
  };

  // ============================================================
  // 辅助函数
  // ============================================================

  /**
   * 构建 Canvas 事件对象
   */
  function buildCanvasEvent(canvas, meta, method) {
    const width = canvas ? canvas.width : 0;
    const height = canvas ? canvas.height : 0;

    // 获取调用栈（截断）
    let callStack = '';
    try {
      const stack = new Error().stack;
      if (stack) {
        const lines = stack.split('\n').slice(2, 7); // 跳过自身 + 最多 5 层
        callStack = lines.join('\n');
      }
    } catch (e) {}

    return {
      timestamp: Date.now(),
      method: method,
      canvasWidth: width,
      canvasHeight: height,
      canvasArea: width * height,
      addedToDOM: meta ? meta.addedToDOM : null,
      exoticTextUsed: meta ? meta.exoticTextUsed : false,
      fontsUsed: meta ? Array.from(meta.fontsUsed || []) : [],
      callStack: callStack,
      dataURLLength: null,
      suspiciousDataSize: false
    };
  }

  /**
   * 检测异形文字
   * 非基本 Latin（\x00-\x7F）+ 扩展 Latin（常用西欧字符）
   * 指纹脚本常用 CJK、阿拉伯文、西里尔文、Emoji 等
   */
  function checkExoticText(text, meta) {
    if (!text || meta.exoticTextUsed) return;

    // 匹配非基本字符：CJK、阿拉伯文、西里尔文、天城文、泰文、特殊符号、Emoji
    if (/[^\x00-\x7FÀ-ɏ\s]/.test(text) || text.length > 200) {
      meta.exoticTextUsed = true;
    }
  }

  /**
   * 记录使用的字体
   */
  function recordFont(fontString, meta) {
    try {
      // font 属性格式: "italic small-caps bold 12px/30px Georgia, serif"
      // 提取字体族名称
      const fontFamilyMatch = fontString.match(/\d+(?:\.\d+)?(?:px|pt|em|rem|%)\s*(?:\/\d+(?:\.\d+)?(?:px|pt|em|rem|%)?\s*)?(.+)$/i);
      if (fontFamilyMatch) {
        const families = fontFamilyMatch[1].split(',').map(f =>
          f.trim().replace(/^['"]|['"]$/g, '')
        );
        for (const family of families) {
          if (family && family !== 'serif' && family !== 'sans-serif' &&
              family !== 'monospace' && family !== 'cursive' && family !== 'fantasy') {
            meta.fontsUsed.add(family);
          }
        }
      }
    } catch (e) {}
  }

  /**
   * 获取 Canvas 指纹检测结果
   */
  function getCanvasFingerprintingReport() {
    if (detectedEvents.length === 0) {
      return { detected: false, events: [] };
    }

    return {
      detected: true,
      events: detectedEvents.slice(), // 返回副本
      summary: {
        totalEvents: detectedEvents.length,
        dataExtractions: detectedEvents.filter(e =>
          e.method === 'toDataURL' || e.method === 'toBlob').length,
        imageDataReads: detectedEvents.filter(e =>
          e.method === 'getImageData').length,
        hiddenCanvases: detectedEvents.filter(e =>
          e.addedToDOM === false).length,
        exoticTextEvents: detectedEvents.filter(e =>
          e.exoticTextUsed).length,
        hasFontEnumeration: detectedEvents.some(e =>
          e.fontsUsed && e.fontsUsed.length > 1)
      }
    };
  }

  // 导出获取函数
  window.__PRIVACY_GET_CANVAS_REPORT = getCanvasFingerprintingReport;
})();
