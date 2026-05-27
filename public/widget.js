(function () {
  'use strict';

  // ==========================================================
  // Shopify 多语言翻译插件 - 前端悬浮切换器 v6.0
  // 核心架构：Google Translate 免费组件 + 自定义 UI 套壳
  // ==========================================================

  const WIDGET_ID = 'coollaa-translator-widget';
  const API_BASE = 'https://admin.coollaa.com/api';

  const defaultConfig = {
    position: 'bottom-right',
    color: '#22c55e',
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
  let googleLoaded = false;

  // 语言代码映射：内部 code -> Google Translate code
  const GOOGLE_LANG_MAP = {
    'en': 'en',
    'es': 'es',
    'fr': 'fr',
    'ara': 'ar',
    'zh': 'zh-CN',
  };

  const rtlLangs = ['ara'];

  // ==========================================================
  // 网站原文语言自动检测
  // ==========================================================

  function normalizeLangCode(rawLang) {
    if (!rawLang) return 'en';
    const lower = rawLang.toLowerCase().trim();
    const primary = lower.split('-')[0];
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
    const htmlLang = document.documentElement.lang || document.documentElement.getAttribute('xml:lang');
    const detected = normalizeLangCode(htmlLang);
    console.log(`[Translator] Detected source language: ${detected} (from <html lang="${htmlLang || ''}">)`);
    return detected;
  }

  const sourceLanguage = detectSourceLanguage();

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
      savedLang = savedRaw;
    }

    if (savedLang && supported.includes(savedLang) && isManual) {
      return savedLang;
    }

    if (savedLang) {
      localStorage.removeItem('coollaa_lang');
    }

    return sourceLanguage;
  }

  // ==========================================================
  // Google Translate 集成
  // ==========================================================

  const GOOGLE_TRANSLATE_URLS = [
    'https://translate.google.com/translate_a/element.js',
    'https://www.google.com/jsapi',
  ];

  function loadGoogleTranslateScript(attempt = 0) {
    return new Promise((resolve, reject) => {
      if (window.google && window.google.translate && window.google.translate.TranslateElement) {
        googleLoaded = true;
        resolve();
        return;
      }

      // 避免重复加载：已有脚本在加载中，等待即可
      if (document.querySelector('script[src*="translate_a/element.js"]')) {
        const check = setInterval(() => {
          if (window.google && window.google.translate && window.google.translate.TranslateElement) {
            clearInterval(check);
            googleLoaded = true;
            resolve();
          }
        }, 100);
        setTimeout(() => {
          clearInterval(check);
          reject(new Error('Google Translate script timeout'));
        }, 15000);
        return;
      }

      // 注册全局回调
      window.googleTranslateElementInit = function () {
        const container = document.getElementById('google_translate_element');
        if (!container) return;

        new google.translate.TranslateElement({
          pageLanguage: sourceLanguage === 'zh' ? 'zh-CN' : sourceLanguage,
          includedLanguages: config.languages.map(l => GOOGLE_LANG_MAP[l.code] || l.code).join(','),
        }, 'google_translate_element');

        googleLoaded = true;
        resolve();
      };

      const script = document.createElement('script');
      script.src = `${GOOGLE_TRANSLATE_URLS[0]}?cb=googleTranslateElementInit`;
      script.async = true;
      script.onerror = () => {
        // 移除失败脚本标签
        script.remove();
        if (attempt < 3) {
          console.warn(`[Translator] Google Translate load failed, retrying (${attempt + 1}/3)...`);
          setTimeout(() => {
            loadGoogleTranslateScript(attempt + 1).then(resolve).catch(reject);
          }, 2000);
        } else {
          reject(new Error('Failed to load Google Translate script after retries'));
        }
      };
      document.head.appendChild(script);
    });
  }

  function triggerGoogleTranslate(langCode) {
    return new Promise((resolve) => {
      if (!googleLoaded) {
        resolve(false);
        return;
      }

      const googleCode = GOOGLE_LANG_MAP[langCode] || langCode;

      function tryTrigger(retryCount = 0) {
        const combo = document.querySelector('.goog-te-combo');
        if (!combo) {
          if (retryCount < 20) {
            setTimeout(() => tryTrigger(retryCount + 1), 300);
            return;
          }
          console.warn('[Translator] Google Translate combo not found after retries');
          resolve(false);
          return;
        }

        if (combo.value === googleCode) {
          resolve(true);
          return;
        }

        combo.value = googleCode;
        const evt = document.createEvent('HTMLEvents');
        evt.initEvent('change', true, false);
        combo.dispatchEvent(evt);

        // 验证：combo.value 是否真的变成了目标值（如果没有对应 option，设置不会生效）
        if (combo.value !== googleCode) {
          console.warn(`[Translator] Option ${googleCode} not found in Google Translate combo`);
          resolve(false);
          return;
        }
        resolve(true);
      }

      tryTrigger();
    });
  }

  function restoreOriginalLanguage() {
    return new Promise((resolve) => {
      function tryRestore(retryCount = 0) {
        const combo = document.querySelector('.goog-te-combo');
        if (!combo) {
          if (retryCount < 20) {
            setTimeout(() => tryRestore(retryCount + 1), 300);
            return;
          }
          resolve(false);
          return;
        }

        combo.value = '';
        const evt = document.createEvent('HTMLEvents');
        evt.initEvent('change', true, false);
        combo.dispatchEvent(evt);

        // 清除 Google Translate cookie，防止刷新后再次自动翻译
        const domain = window.location.hostname;
        document.cookie = 'googtrans=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
        document.cookie = 'googtrans=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; domain=' + domain;
        document.cookie = 'googtrans=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; domain=.' + domain;

        document.body.style.top = '';
        document.body.style.position = '';
        document.documentElement.style.top = '';

        resolve(true);
      }

      tryRestore();
    });
  }

  // ==========================================================
  // UI 组件
  // ==========================================================

  function createStyles() {
    const styleId = `${WIDGET_ID}-styles`;
    if ($(`#${styleId}`)) return;

    const css = `
      /* 隐藏 Google Translate 默认 UI */
      .goog-te-banner-frame,
      .goog-te-gadget,
      .goog-te-gadget-simple,
      .skiptranslate,
      #goog-gt-tt,
      .goog-te-menu-value,
      .goog-te-menu-frame,
      .goog-te-balloon-frame,
      .goog-tooltip,
      .goog-tooltip:hover,
      #goog-gt-\.tt {
        display: none !important;
        visibility: hidden !important;
      }
      body {
        top: 0 !important;
        position: static !important;
      }
      html {
        top: 0 !important;
      }

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

    // 隐藏模式：不创建 widget
    if (config.position === 'hidden') return;

    const container = createEl('div', `position-${config.position} notranslate`);
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

  function setPageDirection(lang) {
    if (rtlLangs.includes(lang)) {
      document.documentElement.setAttribute('dir', 'rtl');
      document.body.style.direction = 'rtl';
    } else {
      document.documentElement.removeAttribute('dir');
      document.body.style.direction = '';
    }
  }

  function showLoading() {
    const btn = document.querySelector(`.${WIDGET_ID}-btn`);
    if (btn) btn.classList.add('translating');
  }

  function hideLoading() {
    const btn = document.querySelector(`.${WIDGET_ID}-btn`);
    if (btn) btn.classList.remove('translating');
  }

  async function switchLanguage(langCode) {
    if (langCode === currentLang) {
      toggleDropdown();
      return;
    }

    toggleDropdown();
    showLoading();

    const startTime = Date.now();
    let success = false;

    try {
      if (!googleLoaded) {
        console.warn('[Translator] Google not ready, attempting reload...');
        await loadGoogleTranslateScript();
      }
      success = await triggerGoogleTranslate(langCode);
    } catch (err) {
      console.error('[Translator] Translation failed:', err.message);
      success = false;
    }

    // 保证 loading 至少显示 600ms，让用户看到动画反馈
    const elapsed = Date.now() - startTime;
    const minLoading = 600;
    const remaining = Math.max(0, minLoading - elapsed);

    await new Promise(r => setTimeout(r, remaining));

    if (success) {
      currentLang = langCode;
      localStorage.setItem('coollaa_lang', JSON.stringify({ code: langCode, source: 'manual' }));
      updateWidgetActiveLang(langCode);
      setPageDirection(langCode);
    } else {
      console.error('[Translator] Switch failed, reverting UI');
      updateWidgetActiveLang(currentLang);
      const btn = document.querySelector(`.${WIDGET_ID}-btn`);
      if (btn) {
        const originalBg = btn.style.background;
        btn.style.background = '#f44336';
        setTimeout(() => {
          btn.style.background = originalBg || config.color;
        }, 800);
      }
    }

    hideLoading();
  }

  // ==========================================================
  // 初始化
  // ==========================================================

  async function init() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
      return;
    }

    console.log('[Coollaa Translator] Initializing... v6.0 (Google Translate)');

    await fetchConfig();

    // 创建隐藏容器供 Google Translate 初始化
    // 注意：不能用 display:none，Google Translate 在隐藏元素中无法正确初始化 .goog-te-combo
    const hiddenContainer = createEl('div', 'notranslate');
    hiddenContainer.id = 'google_translate_element';
    hiddenContainer.style.cssText = 'position:absolute;left:-9999px;top:-9999px;overflow:hidden;height:0;width:0;';
    document.body.appendChild(hiddenContainer);

    // 先创建 UI
    createStyles();
    createWidget();

    // 确定初始语言
    currentLang = detectInitialLanguage();
    updateWidgetActiveLang(currentLang);

    // 加载 Google Translate 脚本
    try {
      await loadGoogleTranslateScript();
      console.log('[Coollaa Translator] Google Translate loaded');

      // Google Translate 会通过 cookie 记忆用户上次选择的语言，
      // 刷新后可能自动恢复翻译。需要检测并同步 widget 状态。
      setTimeout(() => {
        const combo = document.querySelector('.goog-te-combo');
        if (combo && combo.value) {
          const googleCode = combo.value;
          const reverseMap = {
            'en': 'en', 'es': 'es', 'fr': 'fr',
            'ar': 'ara', 'zh-CN': 'zh', 'zh': 'zh',
          };
          const detectedLang = reverseMap[googleCode] || googleCode;
          if (detectedLang !== sourceLanguage && config.languages.some(l => l.code === detectedLang)) {
            currentLang = detectedLang;
            updateWidgetActiveLang(currentLang);
            setPageDirection(currentLang);
            localStorage.setItem('coollaa_lang', JSON.stringify({ code: currentLang, source: 'manual' }));
            console.log(`[Coollaa Translator] Synced Google active language: ${currentLang}`);
            return;
          }
        }

        // 如果 Google 没有活跃翻译，且初始语言不是源语言，触发翻译
        if (currentLang !== sourceLanguage) {
          setPageDirection(currentLang);
          triggerGoogleTranslate(currentLang);
        }
      }, 500);
    } catch (err) {
      console.error('[Coollaa Translator] Failed to load Google Translate:', err.message);
      // 初始加载失败，延迟后静默重试一次（网络可能暂时不通）
      setTimeout(() => {
        loadGoogleTranslateScript().then(() => {
          console.log('[Coollaa Translator] Google Translate loaded on retry');
          // 重试成功后，如果用户之前手动选择了非源语言，触发翻译
          const saved = localStorage.getItem('coollaa_lang');
          let savedLang = null;
          try { savedLang = JSON.parse(saved)?.code; } catch (e) { savedLang = saved; }
          if (savedLang && savedLang !== sourceLanguage) {
            triggerGoogleTranslate(savedLang);
            setPageDirection(savedLang);
            currentLang = savedLang;
            updateWidgetActiveLang(savedLang);
          }
        }).catch(() => {
          console.error('[Coollaa Translator] Google Translate retry also failed');
        });
      }, 5000);
    }

    console.log(`[Coollaa Translator] Ready. Current language: ${currentLang}`);
  }

  init();

  // bfcache 恢复后重新应用当前语言
  window.addEventListener('pageshow', (event) => {
    if (event.persisted && currentLang && currentLang !== sourceLanguage) {
      console.log('[Translator] Page restored from bfcache, reapplying language');
      setTimeout(() => {
        triggerGoogleTranslate(currentLang);
        setPageDirection(currentLang);
      }, 300);
    }
  });
})();
