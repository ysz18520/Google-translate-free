(function () {
  'use strict';

  // ==========================================================
  // Shopify 多语言翻译插件 - 前端悬浮切换器 v5.2
  // 核心架构：WeakMap 原文记录 + 文本节点替换 + API 预加载
  // ==========================================================

  const WIDGET_ID = 'coollaa-translator-widget';
  const API_BASE = 'https://admin.coollaa.com/api';

  const defaultConfig = {
    position: 'bottom-right',
    color: '#1976d2',
    languages: [
      { code: 'en', name: 'English', flag: '🇺🇸' },
      { code: 'es', name: 'Español', flag: '🇪🇸' },
      { code: 'fr', name: 'Français', flag: '🇫🇷' },
      { code: 'ara', name: 'العربية', flag: '🇸🇦' },
      { code: 'zh', name: '中文', flag: '🇨🇳' },
    ],
    enabledLanguages: 'en,es,fr,ara,zh',
  };

  let config = { ...defaultConfig };
  let currentLang;
  let isOpen = false;

  // ==========================================================
  // 网站原文语言自动检测
  // ==========================================================

  function normalizeLangCode(rawLang) {
    if (!rawLang) return 'en';
    const lower = rawLang.toLowerCase().trim();
    // 取主语言代码（如 en-US → en）
    const primary = lower.split('-')[0];
    // 映射到插件支持的语言代码
    const map = {
      'en': 'en', 'eng': 'en',
      'es': 'es', 'spa': 'es',
      'fr': 'fr', 'fra': 'fr', 'fre': 'fr',
      'ar': 'ara', 'ara': 'ara',
      'zh': 'zh', 'chi': 'zh', 'zho': 'zh',
    };
    return map[primary] || 'en';
  }

  function detectSourceLanguage() {
    // 读取网站 <html lang> 属性，如 <html lang="en"> 或 <html lang="en-US">
    const htmlLang = document.documentElement.lang || document.documentElement.getAttribute('xml:lang');
    const detected = normalizeLangCode(htmlLang);
    console.log(`[Translator] Detected source language: ${detected} (from <html lang="${htmlLang || ''}">)`);
    return detected;
  }

  // 源语言：从网站 <html lang> 自动检测，不再硬编码
  const sourceLanguage = detectSourceLanguage();

  // 核心状态：按语言缓存的翻译字典 + 原始文本 WeakMap
  let pageTranslations = {}; // { es: { "Welcome": "Bienvenido" }, zh: {...} }
  const originalTexts = new WeakMap(); // node -> original textContent
  let hasRecordedOriginalTexts = false;

  let observer = null;
  let isRebuilding = false;

  const rtlLangs = ['ara'];

  // ==========================================================
  // 工具函数
  // ==========================================================

  function $(selector) {
    return document.querySelector(selector);
  }

  function createEl(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text) el.textContent = text;
    return el;
  }

  function getShopDomain() {
    return window.location.hostname;
  }

  function normalizeText(text) {
    return text.replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
  }

  // ==========================================================
  // API 请求
  // ==========================================================

  async function fetchConfig() {
    try {
      const res = await fetch(`${API_BASE}/widget/config?shop=${getShopDomain()}`);
      if (res.ok) {
        const data = await res.json();
        config = { ...defaultConfig, ...data };
      }
    } catch (e) {
      console.warn('[Translator] Failed to load config');
    }
  }

  async function fetchTranslations(locale) {
    // 如果内存中已有该语言的翻译，直接返回
    if (pageTranslations[locale]) {
      return pageTranslations[locale];
    }

    try {
      const res = await fetch(
        `${API_BASE}/widget/translations?shop=${getShopDomain()}&locale=${locale}`
      );
      if (res.ok) {
        const data = await res.json();
        // 兼容后端两种返回格式：translations 或 strings
        const dict = data.translations || data.strings || {};
        pageTranslations[locale] = dict;
        return dict;
      }
    } catch (e) {
      console.warn('[Translator] Failed to load translations');
    }
    return {};
  }

  // ==========================================================
  // 语言检测：三层判断（预览参数 > 外部进入默认 > 同域保留手动选择）
  // ==========================================================

  function isSameDomain(url1, url2) {
    try {
      return new URL(url1).hostname === new URL(url2).hostname;
    } catch (e) {
      return false;
    }
  }

  function detectInitialLanguage() {
    const supported = config.languages.map(l => l.code);

    // 1. URL 预览参数（最高优先级，店主测试专用）
    const urlParams = new URLSearchParams(window.location.search);
    const previewLang = urlParams.get('coollaa_preview_lang');
    if (previewLang && supported.includes(previewLang)) {
      return previewLang;
    }

    // 2. 外部进入（直接访问、搜索引擎、书签、跨域跳转）→ 默认使用网站原文语言（不翻译）
    const isExternalEntry = !document.referrer || !isSameDomain(document.referrer, window.location.href);
    if (isExternalEntry) {
      return sourceLanguage;
    }

    // 3. 同域跳转/刷新 → 仅当用户手动选择过才保留
    const savedRaw = localStorage.getItem('coollaa_lang');
    let savedLang = null;
    let isManual = false;

    try {
      const parsed = JSON.parse(savedRaw);
      if (parsed && parsed.code) {
        savedLang = parsed.code;
        isManual = parsed.source === 'manual';
      }
    } catch (e) {
      // 兼容旧格式：纯字符串，视为非手动
      savedLang = savedRaw;
    }

    if (savedLang && supported.includes(savedLang) && isManual) {
      return savedLang;
    }

    // 旧格式或已移除的语言，清理并回退到网站原文语言
    if (savedLang) {
      localStorage.removeItem('coollaa_lang');
    }

    return sourceLanguage;
  }

  // ==========================================================
  // 原始文本记录（v5：不再 innerHTML 重建，只记录/恢复文本节点）
  // ==========================================================

  function getAllBodyTextNodes() {
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: function (node) {
          const parent = node.parentElement;
          if (!parent || shouldIgnoreElement(parent)) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );
    const nodes = [];
    let node;
    while ((node = walker.nextNode())) {
      nodes.push(node);
    }
    return nodes;
  }

  function recordOriginalTexts() {
    if (hasRecordedOriginalTexts) return;
    hasRecordedOriginalTexts = true;

    const nodes = getAllBodyTextNodes();
    for (const node of nodes) {
      // 切换语言后必须重新记录原文，不能跳过已有节点（否则上次翻译的内容会被当成原文）
      originalTexts.set(node, node.textContent);
    }
    // 记录 placeholder 原始值
    document.querySelectorAll('input[placeholder], textarea[placeholder]').forEach(el => {
      el.dataset.originalPlaceholder = el.getAttribute('placeholder') || '';
    });
    console.log(`[Translator] Recorded ${nodes.length} text nodes`);
  }

  function restoreOriginalTexts() {
    const nodes = getAllBodyTextNodes();
    let count = 0;
    for (const node of nodes) {
      const original = originalTexts.get(node);
      if (original !== undefined && node.textContent !== original) {
        node.textContent = original;
        count++;
      }
    }
    // 恢复 placeholder
    document.querySelectorAll('input[placeholder], textarea[placeholder]').forEach(el => {
      const originalPh = el.dataset.originalPlaceholder;
      if (originalPh !== undefined && el.getAttribute('placeholder') !== originalPh) {
        el.setAttribute('placeholder', originalPh);
      }
    });
    console.log(`[Translator] Restored ${count} text nodes`);
  }

  // ==========================================================
  // 文本节点收集（用于翻译应用）
  // ==========================================================

  function shouldIgnoreElement(el) {
    if (!el || !el.tagName) return true;
    const tag = el.tagName.toLowerCase();
    if (['script', 'style', 'noscript', 'iframe', 'code', 'pre', 'svg', 'path', 'text', 'tspan', 'title', 'desc', 'defs', 'clipPath', 'mask', 'filter', 'linearGradient', 'radialGradient', 'stop'].includes(tag)) {
      return true;
    }
    if (el.closest && el.closest(`#${WIDGET_ID}`)) return true;
    return false;
  }

  function getTextNodes(root) {
    const walker = document.createTreeWalker(
      root || document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: function (node) {
          const parent = node.parentElement;
          if (!parent || shouldIgnoreElement(parent)) {
            return NodeFilter.FILTER_REJECT;
          }
          const text = node.textContent.trim();
          if (!text || text.length < 2) {
            return NodeFilter.FILTER_REJECT;
          }
          if (/^[\d\s\W]+$/.test(text)) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    const nodes = [];
    let node;
    while ((node = walker.nextNode())) {
      nodes.push(node);
    }
    return nodes;
  }

  function getTranslatableAttributes() {
    return Array.from(document.querySelectorAll('input[placeholder], textarea[placeholder]')).filter(el => {
      if (shouldIgnoreElement(el)) return false;
      const ph = el.getAttribute('placeholder');
      return ph && ph.trim().length >= 2;
    });
  }

  // ==========================================================
  // 翻译应用（一次性替换，不记录原文）
  // ==========================================================

  function applyTranslations(dict, targetLang) {
    if (currentLang !== targetLang) {
      console.log('[Translator] applyTranslations: lang mismatch', currentLang, targetLang);
      return [];
    }

    // 预处理字典：将 &nbsp;( ) 统一替换为普通空格，确保与后端提取的文本匹配
    const normalizedDict = {};
    for (const key in dict) {
      normalizedDict[normalizeText(key)] = dict[key];
    }

    const missingTexts = new Set();

    const textNodes = getTextNodes();
    console.log(`[Translator] applyTranslations: ${textNodes.length} text nodes, dict has ${Object.keys(normalizedDict).length} keys`);
    for (const node of textNodes) {
      const fullText = node.textContent;
      const text = normalizeText(fullText);
      if (normalizedDict[text]) {
        // 保留原始的前导和尾随空白
        const leading = fullText.match(/^\s*/)[0];
        const trailing = fullText.match(/\s*$/)[0];
        node.textContent = leading + normalizedDict[text] + trailing;
      } else {
        missingTexts.add(text);
      }
    }

    const attrElements = getTranslatableAttributes();
    for (const el of attrElements) {
      const ph = el.getAttribute('placeholder');
      if (ph) {
        const normalizedPh = normalizeText(ph);
        if (normalizedDict[normalizedPh]) {
          el.setAttribute('placeholder', normalizedDict[normalizedPh]);
        } else {
          missingTexts.add(normalizedPh);
        }
      }
    }

    return Array.from(missingTexts);
  }

  /**
   * 实时翻译兜底：批量发送未命中缓存的文本到后端翻译
   */
  async function fetchRealtimeTranslations(texts, targetLang) {
    const uniqueTexts = [...new Set(texts)].filter(t => t.length >= 2 && !/^\d+$/.test(t));
    if (uniqueTexts.length === 0) return {};

    // 分批处理，每批最多 20 个（避免请求过大）
    const batchSize = 20;
    const results = {};

    for (let i = 0; i < uniqueTexts.length; i += batchSize) {
      const batch = uniqueTexts.slice(i, i + batchSize);
      const items = batch.map(text => ({ text, from: sourceLanguage, to: targetLang }));

      try {
        const res = await fetch(`${API_BASE}/translate/batch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items, from: sourceLanguage, to: targetLang, shop: getShopDomain() }),
        });

        if (res.ok) {
          const data = await res.json();
          if (data.results) {
            for (const r of data.results) {
              results[r.source] = r.translated;
            }
          }
        }
      } catch (e) {
        console.warn('[Translator] Realtime batch translation failed:', e);
      }
    }

    return results;
  }

  /**
   * 将实时翻译结果回写到后端缓存（fire-and-forget，不阻塞）
   */
  function saveTranslationsToCache(translations, targetLang) {
    if (!translations || Object.keys(translations).length === 0) return;
    fetch(`${API_BASE}/widget/cache`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        shop: getShopDomain(),
        locale: targetLang,
        translations,
      }),
    }).catch(e => {
      // 静默失败，不影响用户体验
      console.warn('[Translator] Cache save failed:', e);
    });
  }

  // ==========================================================
  // 快照重建核心逻辑
  // ==========================================================

  async function rebuildAndTranslate(targetLang) {
    if (isRebuilding) return;
    isRebuilding = true;

    try {
      // 1. 停止 Observer
      stopObserver();

      // 2. 恢复所有文本节点到原始状态（v5：不再 innerHTML 重建）
      restoreOriginalTexts();

      // 3. 设置页面方向（RTL/LTR）
      setPageDirection(targetLang);

      // 4. 如果目标语言不是源语言，应用翻译（含实时兜底）
      if (targetLang !== sourceLanguage) {
        const dict = await fetchTranslations(targetLang);
        if (currentLang === targetLang) {
          const missing = applyTranslations(dict, targetLang);

          // 实时翻译兜底：未命中缓存的文本自动发送到后端翻译
          if (missing.length > 0) {
            console.log(`[Translator] ${missing.length} texts missing, fetching realtime translations...`);
            const realtimeDict = await fetchRealtimeTranslations(missing, targetLang);
            if (Object.keys(realtimeDict).length > 0 && currentLang === targetLang) {
              // 合并到缓存字典
              Object.assign(pageTranslations[targetLang], realtimeDict);
              // 再次应用翻译
              applyTranslations(pageTranslations[targetLang], targetLang);
              console.log(`[Translator] Realtime translation applied: ${Object.keys(realtimeDict).length} texts`);
              // 回写缓存，下次访问直接命中
              saveTranslationsToCache(realtimeDict, targetLang);
            }
          }
        }
        // 启动 Observer 捕获动态加载内容
        startObserver();
      }
    } catch (err) {
      console.error('[Translator] rebuildAndTranslate error:', err);
    } finally {
      isRebuilding = false;
    }
  }

  function setPageDirection(lang) {
    if (rtlLangs.includes(lang)) {
      document.documentElement.setAttribute('dir', 'rtl');
      document.body.style.direction = 'rtl';
    } else {
      document.documentElement.removeAttribute('dir');
      document.body.style.direction = '';
    }
  }

  // ==========================================================
  // DOM 观察器（仅用于捕获动态加载的内容）
  // ==========================================================

  function startObserver() {
    if (observer) return;
    if (currentLang === sourceLanguage) return;

    observer = new MutationObserver((mutations) => {
      let hasNewNodes = false;
      mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
          if (node.nodeType === Node.ELEMENT_NODE && !shouldIgnoreElement(node)) {
            // 记录新节点内的所有文本节点原始文本
            const walker = document.createTreeWalker(
              node,
              NodeFilter.SHOW_TEXT,
              {
                acceptNode: function (n) {
                  const parent = n.parentElement;
                  if (!parent || shouldIgnoreElement(parent)) {
                    return NodeFilter.FILTER_REJECT;
                  }
                  return NodeFilter.FILTER_ACCEPT;
                }
              }
            );
            let textNode;
            while ((textNode = walker.nextNode())) {
              if (!originalTexts.has(textNode)) {
                originalTexts.set(textNode, textNode.textContent);
              }
            }
            hasNewNodes = true;
          }
        });
      });

      if (hasNewNodes) {
        clearTimeout(window._translatorDebounce);
        window._translatorDebounce = setTimeout(async () => {
          if (currentLang !== sourceLanguage && pageTranslations[currentLang]) {
            const missing = applyTranslations(pageTranslations[currentLang], currentLang);

            // 动态加载内容可能有新文本，实时翻译兜底
            if (missing.length > 0) {
              const realtimeDict = await fetchRealtimeTranslations(missing, currentLang);
              if (Object.keys(realtimeDict).length > 0) {
                Object.assign(pageTranslations[currentLang], realtimeDict);
                applyTranslations(pageTranslations[currentLang], currentLang);
                // 回写缓存，下次访问直接命中
                saveTranslationsToCache(realtimeDict, currentLang);
              }
            }
          }
        }, 150);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  function stopObserver() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  }

  // ==========================================================
  // UI 组件
  // ==========================================================

  function createStyles() {
    const styleId = `${WIDGET_ID}-styles`;
    if ($(`#${styleId}`)) return;

    const css = `
      #${WIDGET_ID} {
        position: fixed;
        z-index: 2147483647;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }

      #${WIDGET_ID}.position-bottom-right {
        bottom: 20px;
        right: 20px;
      }

      #${WIDGET_ID}.position-bottom-left {
        bottom: 20px;
        left: 20px;
      }

      .${WIDGET_ID}-btn {
        width: 56px;
        height: 56px;
        border-radius: 50%;
        border: none;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        transition: all 0.3s ease;
        background: ${config.color};
        color: white;
        font-size: 24px;
        position: relative;
      }

      .${WIDGET_ID}-btn:hover {
        transform: scale(1.1);
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.2);
      }

      .${WIDGET_ID}-btn:active {
        transform: scale(0.95);
      }

      .${WIDGET_ID}-btn.translating {
        background: #ff9800;
        animation: coollaa-loading-pulse 1.2s ease-in-out infinite;
      }

      .${WIDGET_ID}-btn.translating svg {
        opacity: 0.3;
        transition: opacity 0.3s;
      }

      .${WIDGET_ID}-btn.translating::after {
        content: '';
        position: absolute;
        width: 28px;
        height: 28px;
        border: 3px solid rgba(255,255,255,0.25);
        border-top-color: #fff;
        border-radius: 50%;
        animation: coollaa-spin 0.6s linear infinite;
        box-shadow: 0 0 8px rgba(255,255,255,0.4);
      }

      @keyframes coollaa-spin {
        to { transform: rotate(360deg); }
      }

      @keyframes coollaa-loading-pulse {
        0%, 100% { transform: scale(1); box-shadow: 0 4px 15px rgba(25,118,210,0.3); }
        50% { transform: scale(1.08); box-shadow: 0 6px 25px rgba(25,118,210,0.6); }
      }

      .${WIDGET_ID}-btn svg {
        width: 28px;
        height: 28px;
        fill: currentColor;
      }

      .${WIDGET_ID}-dropdown {
        position: absolute;
        bottom: 70px;
        right: 0;
        background: white;
        border-radius: 12px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
        min-width: 180px;
        overflow: hidden;
        opacity: 0;
        visibility: hidden;
        transform: translateY(10px);
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      }

      .position-bottom-left .${WIDGET_ID}-dropdown {
        right: auto;
        left: 0;
      }

      .${WIDGET_ID}-dropdown.open {
        opacity: 1;
        visibility: visible;
        transform: translateY(0);
      }

      .${WIDGET_ID}-item {
        display: flex;
        align-items: center;
        padding: 12px 16px;
        cursor: pointer;
        transition: background 0.2s;
        border: none;
        background: none;
        width: 100%;
        text-align: left;
        font-size: 14px;
        color: #333;
      }

      .${WIDGET_ID}-item:hover {
        background: #f5f5f5;
      }

      .${WIDGET_ID}-item.active {
        background: ${config.color}10;
        color: ${config.color};
        font-weight: 600;
      }

      .${WIDGET_ID}-flag {
        font-size: 20px;
        margin-right: 12px;
        line-height: 1;
      }

      .${WIDGET_ID}-name {
        flex: 1;
      }

      .${WIDGET_ID}-check {
        margin-left: 8px;
        opacity: 0;
      }

      .${WIDGET_ID}-item.active .${WIDGET_ID}-check {
        opacity: 1;
      }

      @media (max-width: 768px) {
        #${WIDGET_ID}.position-bottom-right {
          bottom: 16px;
          right: 16px;
        }

        #${WIDGET_ID}.position-bottom-left {
          bottom: 16px;
          left: 16px;
        }

        .${WIDGET_ID}-btn {
          width: 48px;
          height: 48px;
        }

        .${WIDGET_ID}-btn svg {
          width: 24px;
          height: 24px;
        }

        .${WIDGET_ID}-dropdown {
          min-width: 160px;
        }

        .${WIDGET_ID}-item {
          padding: 10px 14px;
          font-size: 13px;
        }
      }

      [dir="rtl"] .${WIDGET_ID}-flag {
        margin-right: 0;
        margin-left: 12px;
      }

      [dir="rtl"] .${WIDGET_ID}-dropdown {
        right: auto;
        left: 0;
      }

      [dir="rtl"] .position-bottom-left .${WIDGET_ID}-dropdown {
        left: auto;
        right: 0;
      }
    `;

    const style = createEl('style', '', css);
    style.id = styleId;
    document.head.appendChild(style);
  }

  function createWidget() {
    if ($(`#${WIDGET_ID}`)) return;

    const container = createEl('div', `position-${config.position}`);
    container.id = WIDGET_ID;

    const btn = createEl('button', `${WIDGET_ID}-btn`);
    btn.setAttribute('aria-label', 'Switch Language');
    btn.innerHTML = `
      <svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
        <path d="M666.296 824.08c-12.56-30.72-54.224-83.312-123.576-156.384-18.616-19.552-17.456-34.448-10.704-78.896v-5.12c4.424-30.48 12.104-48.4 114.504-64.696 52.128-8.144 65.624 12.56 84.712 41.424l6.28 9.544a101 101 0 0 0 51.44 41.656c9.072 4.192 20.24 9.312 35.368 17.92 36.768 20.24 36.768 43.28 36.768 94.024v5.816a215.28 215.28 0 0 1-41.424 139.632 472.44 472.44 0 0 1-152.2 88.208c27.92-52.368 6.512-114.504 0-132.424l-1.168-0.696zM512 40.96a468.016 468.016 0 0 1 203.872 46.544 434.504 434.504 0 0 0-102.872 82.616c-7.44 10.24-13.728 19.784-19.776 28.632-19.552 29.552-29.096 42.816-46.544 44.912a200.84 200.84 0 0 1-33.752 0c-34.208-2.32-80.752-5.12-95.648 35.376-9.544 25.84-11.168 95.648 19.552 131.96 5.28 8.616 6.224 19.2 2.56 28.624a56.08 56.08 0 0 1-16.528 25.832 151.504 151.504 0 0 1-23.272-23.28 151.28 151.28 0 0 0-66.56-52.824c-10-2.792-21.176-5.12-31.88-7.44-30.256-6.288-64.24-13.504-72.152-30.496a119.16 119.16 0 0 1-5.816-46.544 175.48 175.48 0 0 0-11.168-74 70.984 70.984 0 0 0-44.456-39.568A469.64 469.64 0 0 1 512 40.96zM0 512c0 282.768 229.232 512 512 512 282.768 0 512-229.232 512-512 0-282.768-229.232-512-512-512C229.232 0 0 229.232 0 512z"/>
      </svg>
    `;

    const dropdown = createEl('div', `${WIDGET_ID}-dropdown`);

    config.languages.forEach(lang => {
      const item = createEl('button', `${WIDGET_ID}-item`);
      item.dataset.lang = lang.code;
      if (lang.code === currentLang) {
        item.classList.add('active');
      }

      item.innerHTML = `
        <span class="${WIDGET_ID}-flag">${lang.flag}</span>
        <span class="${WIDGET_ID}-name">${lang.name}</span>
        <span class="${WIDGET_ID}-check">✓</span>
      `;

      item.addEventListener('click', () => switchLanguage(lang.code));
      dropdown.appendChild(item);
    });

    document.addEventListener('click', (e) => {
      if (!container.contains(e.target) && isOpen) {
        toggleDropdown();
      }
    });

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleDropdown();
    });

    container.appendChild(btn);
    container.appendChild(dropdown);
    document.body.appendChild(container);
  }

  // ==========================================================
  // 交互逻辑
  // ==========================================================

  function toggleDropdown() {
    const dropdown = $(`.${WIDGET_ID}-dropdown`);
    if (!dropdown) return;

    isOpen = !isOpen;
    dropdown.classList.toggle('open', isOpen);
  }

  let pendingLang = null;

  function updateWidgetActiveLang(langCode) {
    document.querySelectorAll(`.${WIDGET_ID}-item`).forEach(item => {
      item.classList.toggle('active', item.dataset.lang === langCode);
    });
    const widgetBtn = document.querySelector(`.${WIDGET_ID}-btn`);
    if (widgetBtn) {
      const lang = config.languages.find(l => l.code === langCode);
      widgetBtn.setAttribute('aria-label', lang ? `Current: ${lang.name}` : langCode);
    }
  }

  function switchLanguage(langCode) {
    if (langCode === currentLang) {
      toggleDropdown();
      return;
    }

    // 如果正在重建，排队等待当前完成后再切换
    if (isRebuilding) {
      pendingLang = langCode;
      toggleDropdown();
      return;
    }

    toggleDropdown();
    showLoading();

    currentLang = langCode;
    localStorage.setItem('coollaa_lang', JSON.stringify({ code: langCode, source: 'manual' }));
    updateWidgetActiveLang(langCode);

    rebuildAndTranslate(langCode).then(() => {
      hideLoading();
      // 处理排队请求
      if (pendingLang && pendingLang !== currentLang) {
        const next = pendingLang;
        pendingLang = null;
        switchLanguage(next);
      }
    }).catch(err => {
      console.error('[Translator] Rebuild failed:', err);
      hideLoading();
      pendingLang = null;
    });
  }

  function showLoading() {
    const btn = document.querySelector(`.${WIDGET_ID}-btn`);
    if (btn) btn.classList.add('translating');
  }

  function hideLoading() {
    const btn = document.querySelector(`.${WIDGET_ID}-btn`);
    if (btn) btn.classList.remove('translating');
  }

  // ==========================================================
  // 初始化
  // ==========================================================

  async function init() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
      return;
    }

    console.log('[Coollaa Translator] Initializing... v5.3 (auto-source-lang)');

    await fetchConfig();

    // 先创建 UI
    createStyles();
    createWidget();

    // 确定初始语言（尊重已保存偏好，否则使用默认语言）
    currentLang = detectInitialLanguage();

    // 更新 widget 的 active 状态
    updateWidgetActiveLang(currentLang);

    // 核心：记录所有文本节点的原始文本（v5：不再保存 innerHTML 快照）
    recordOriginalTexts();

    // 如果当前不是源语言，获取翻译并应用（含实时兜底）
    if (currentLang !== sourceLanguage) {
      setPageDirection(currentLang);
      const dict = await fetchTranslations(currentLang);
      console.log(`[Translator] Loaded dict with ${Object.keys(dict).length} keys for ${currentLang}`);

      const missing = applyTranslations(dict, currentLang);
      console.log(`[Translator] After applyTranslations, missing=${missing.length}`);
      if (missing.length > 0) {
        console.log(`[Translator] Missing texts sample:`, missing.slice(0, 5));
      }

      // 实时翻译兜底
      if (missing.length > 0) {
        console.log(`[Translator] ${missing.length} texts missing, fetching realtime translations...`);
        const realtimeDict = await fetchRealtimeTranslations(missing, currentLang);
        console.log(`[Translator] Realtime result: ${Object.keys(realtimeDict).length} texts`);
        if (Object.keys(realtimeDict).length > 0) {
          Object.assign(pageTranslations[currentLang], realtimeDict);
          applyTranslations(pageTranslations[currentLang], currentLang);
          console.log(`[Translator] Realtime translation applied: ${Object.keys(realtimeDict).length} texts`);
          // 回写缓存，下次访问直接命中
          saveTranslationsToCache(realtimeDict, currentLang);
        }
      }

      startObserver();
    }

    console.log(`[Coollaa Translator] Ready. Current language: ${currentLang}`);
  }

  init();

  // bfcache 恢复后重新应用当前语言的翻译（避免浏览器缓存导致状态不一致）
  window.addEventListener('pageshow', (event) => {
    if (event.persisted && currentLang !== sourceLanguage) {
      console.log('[Translator] Page restored from bfcache, reapplying translations');
      if (pageTranslations[currentLang]) {
        applyTranslations(pageTranslations[currentLang], currentLang);
      } else {
        // 如果缓存中没有该语言的翻译，重新获取
        fetchTranslations(currentLang).then(dict => {
          applyTranslations(dict, currentLang);
        });
      }
    }
  });
})();
