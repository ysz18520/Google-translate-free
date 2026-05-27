const express = require('express');
const crypto = require('crypto');
const config = require('../config');
const prisma = require('../utils/db');

const router = express.Router();

const BUILTIN_LANGUAGES = [
  { code: 'en', name: 'English', flag: '🇺🇸', baiduCode: 'en' },
  { code: 'es', name: 'Español', flag: '🇪🇸', baiduCode: 'spa' },
  { code: 'fr', name: 'Français', flag: '🇫🇷', baiduCode: 'fra' },
  { code: 'ara', name: 'العربية', flag: '🇸🇦', baiduCode: 'ara' },
  { code: 'zh', name: '中文', flag: '🇨🇳', baiduCode: 'zh' },
];

const MANDATORY_LANG_CODES = ['en', 'es', 'fr', 'ara', 'zh'];

function buildLanguageList(setting) {
  const enabledRaw = setting?.enabledLanguages || setting?.activeLanguages || 'en,es,fr,ara,zh';
  let enabledCodes = enabledRaw.split(',').map(s => s.trim()).filter(Boolean);

  // 确保必备语言始终在启用列表中
  for (const code of MANDATORY_LANG_CODES) {
    if (!enabledCodes.includes(code)) enabledCodes.push(code);
  }

  // 内置语言过滤
  let languages = BUILTIN_LANGUAGES.filter(l => enabledCodes.includes(l.code));

  // 合并自定义语言
  if (setting?.customLanguages) {
    try {
      const custom = JSON.parse(setting.customLanguages);
      if (Array.isArray(custom)) {
        for (const c of custom) {
          if (c.code && enabledCodes.includes(c.code)) {
            languages.push({
              code: c.code,
              name: c.name || c.code,
              flag: c.flag || '🏳️',
              baiduCode: c.baiduCode || c.code,
            });
          }
        }
      }
    } catch (e) {
      console.warn('[Widget Config] Failed to parse customLanguages:', e.message);
    }
  }

  // 去重并排序：默认语言排第一，其余按原顺序
  const seen = new Set();
  const unique = [];
  for (const l of languages) {
    if (!seen.has(l.code)) {
      seen.add(l.code);
      unique.push(l);
    }
  }

  return unique;
}

/**
 * @route GET /api/widget/config
 * @desc 获取前端小部件配置
 */
router.get('/config', async (req, res) => {
  const { shop } = req.query;

  const defaultConfig = {
    position: config.widget.position || 'bottom-right',
    color: '#1976d2',
    languages: BUILTIN_LANGUAGES.map(l => ({ code: l.code, name: l.name, flag: l.flag })),
    enabledLanguages: 'en,es,fr,ara,zh',
    // 注意：v6.0+ 起网站原文语言由前端自动检测 <html lang>，不再通过此接口配置
  };

  if (shop) {
    try {
      const shopRecord = await prisma.shop.findUnique({
        where: { shopDomain: shop },
        include: { settings: true },
      });

      if (shopRecord?.settings) {
        const setting = shopRecord.settings;
        if (setting.widgetPosition) defaultConfig.position = setting.widgetPosition;
        if (setting.widgetColor) defaultConfig.color = setting.widgetColor;

        // 构建语言列表（内置 + 自定义）
        const languages = buildLanguageList(setting);
        defaultConfig.languages = languages.map(l => ({ code: l.code, name: l.name, flag: l.flag }));

        defaultConfig.enabledLanguages = setting.enabledLanguages || setting.activeLanguages || 'en,es,fr,ara,zh';
      }
    } catch (e) {
      console.warn('[Widget Config] Failed to load shop settings');
    }
  }

  res.json(defaultConfig);
});

/**
 * @route POST /api/widget/config
 * @desc 更新店铺小部件配置
 */
router.post('/config', async (req, res) => {
  const { shop, position, color, enabledLanguages, customLanguages } = req.body;

  if (!shop) {
    return res.status(400).json({ error: 'Missing shop parameter' });
  }

  try {
    const shopRecord = await prisma.shop.findUnique({
      where: { shopDomain: shop },
    });

    if (!shopRecord) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    // 确保 enabledLanguages 包含所有必备语言
    let finalEnabledLanguages = enabledLanguages || 'en,es,fr,ara,zh';
    const enabledCodes = finalEnabledLanguages.split(',').map(s => s.trim()).filter(Boolean);
    for (const code of MANDATORY_LANG_CODES) {
      if (!enabledCodes.includes(code)) enabledCodes.push(code);
    }
    finalEnabledLanguages = enabledCodes.join(',');

    const updateData = {};
    if (position) updateData.widgetPosition = position;
    if (color) updateData.widgetColor = color;
    if (enabledLanguages) {
      updateData.enabledLanguages = finalEnabledLanguages;
      // 同步旧字段保持兼容
      updateData.activeLanguages = finalEnabledLanguages;
    }
    if (customLanguages !== undefined) updateData.customLanguages = customLanguages;

    await prisma.shopSetting.upsert({
      where: { shopId: shopRecord.id },
      update: updateData,
      create: {
        shopId: shopRecord.id,
        widgetPosition: position || 'bottom-right',
        widgetColor: color || '#1976d2',
        enabledLanguages: finalEnabledLanguages,
        activeLanguages: finalEnabledLanguages,
        customLanguages: customLanguages || null,
      },
    });

    res.json({ success: true, config: updateData });
  } catch (error) {
    console.error('[Update Widget Config Error]', error.message);
    res.status(500).json({ error: 'Failed to update config' });
  }
});

/**
 * @route GET /api/widget/translations
 * @desc 获取店铺已翻译内容（前端动态替换用）
 */
router.get('/translations', async (req, res) => {
  const { shop, locale = 'en', resourceType, resourceId } = req.query;

  if (!shop) {
    return res.status(400).json({ error: 'Missing shop parameter' });
  }

  try {
    const shopRecord = await prisma.shop.findUnique({
      where: { shopDomain: shop },
    });

    if (!shopRecord) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    const whereClause = {
      shopId: shopRecord.id,
      targetLang: locale,
    };

    if (resourceType) whereClause.resourceType = resourceType;
    if (resourceId) whereClause.resourceId = resourceId;

    const translations = await prisma.translation.findMany({
      where: whereClause,
      select: {
        resourceType: true,
        resourceId: true,
        field: true,
        sourceText: true,
        translatedText: true,
        status: true,
      },
    });

    // 构建翻译映射表
    const strings = {};
    for (const t of translations) {
      if (t.status === 'translated') {
        strings[t.sourceText] = t.translatedText;
      }
    }

    res.json({
      locale,
      shop,
      strings,
      count: translations.length,
      lastUpdated: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[Get Translations Error]', error.message);
    res.status(500).json({ error: 'Failed to fetch translations' });
  }
});

/**
 * @route POST /api/widget/debug-auth
 * @desc 生成店主调试授权 token
 */
router.post('/debug-auth', async (req, res) => {
  const { shop } = req.body;

  if (!shop) {
    return res.status(400).json({ error: 'Missing shop parameter' });
  }

  try {
    const shopRecord = await prisma.shop.findUnique({
      where: { shopDomain: shop },
    });

    if (!shopRecord) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    // 生成随机 token
    const token = crypto.randomBytes(32).toString('hex');

    await prisma.shopSetting.upsert({
      where: { shopId: shopRecord.id },
      update: { debugToken: token },
      create: {
        shopId: shopRecord.id,
        debugToken: token,
      },
    });

    // 生成带 token 的店铺链接
    const shopUrl = `https://${shop}`;
    const debugUrl = `${shopUrl}?translator_debug=${token}`;

    res.json({
      success: true,
      token,
      debugUrl,
      shopUrl,
    });
  } catch (error) {
    console.error('[Debug Auth Error]', error.message);
    res.status(500).json({ error: 'Failed to generate debug token' });
  }
});

/**
 * @route GET /api/widget/verify-debug
 * @desc 验证店主调试 token
 */
router.get('/verify-debug', async (req, res) => {
  const { shop, token } = req.query;

  if (!shop || !token) {
    return res.status(400).json({ error: 'Missing shop or token parameter' });
  }

  try {
    const shopRecord = await prisma.shop.findUnique({
      where: { shopDomain: shop },
      include: { settings: true },
    });

    if (!shopRecord?.settings?.debugToken) {
      return res.json({ valid: false, message: 'No debug token found' });
    }

    const valid = shopRecord.settings.debugToken === token;

    res.json({
      valid,
      shop,
      message: valid ? 'Debug token valid' : 'Debug token invalid',
    });
  } catch (error) {
    console.error('[Verify Debug Error]', error.message);
    res.status(500).json({ error: 'Verification failed' });
  }
});

/**
 * @route POST /api/widget/cache
 * @desc 前端实时翻译结果回写数据库（缓存持久化）
 */
router.post('/cache', async (req, res) => {
  const { shop, locale, translations } = req.body;

  if (!shop || !locale || !translations || typeof translations !== 'object') {
    return res.status(400).json({ error: 'Missing shop, locale, or translations' });
  }

  try {
    const shopRecord = await prisma.shop.findUnique({
      where: { shopDomain: shop },
    });

    if (!shopRecord) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    const entries = Object.entries(translations);
    let saved = 0;
    let skipped = 0;

    for (const [sourceText, translatedText] of entries) {
      if (!sourceText || !translatedText || sourceText === translatedText) {
        skipped++;
        continue;
      }

      const hash = crypto.createHash('md5').update(sourceText).digest('hex');

      try {
        await prisma.translation.upsert({
          where: {
            shopId_resourceType_resourceId_field_targetLang: {
              shopId: shopRecord.id,
              resourceType: 'theme_dynamic',
              resourceId: 'cache',
              field: sourceText.substring(0, 100),
              targetLang: locale,
            },
          },
          update: {
            sourceText,
            sourceHash: hash,
            translatedText,
            status: 'translated',
            updatedAt: new Date(),
          },
          create: {
            shopId: shopRecord.id,
            resourceType: 'theme_dynamic',
            resourceId: 'cache',
            field: sourceText.substring(0, 100),
            sourceText,
            sourceHash: hash,
            sourceLang: 'en',
            targetLang: locale,
            translatedText,
            status: 'translated',
            provider: 'anthropic-compat',
          },
        });
        saved++;
      } catch (dbErr) {
        console.warn('[Widget Cache] Upsert failed:', dbErr.message);
        skipped++;
      }
    }

    res.json({ success: true, saved, skipped, total: entries.length });
  } catch (error) {
    console.error('[Widget Cache Error]', error.message);
    res.status(500).json({ error: 'Failed to save cache' });
  }
});

module.exports = router;
