const express = require('express');
const crypto = require('crypto');
const config = require('../config');
const prisma = require('../utils/db');

const router = express.Router();

const BUILTIN_LANGUAGES = [
  { code: 'en', name: 'English', flag: '🇺🇸' },
  { code: 'es', name: 'Español', flag: '🇪🇸' },
  { code: 'fr', name: 'Français', flag: '🇫🇷' },
  { code: 'ara', name: 'العربية', flag: '🇸🇦' },
  { code: 'zh', name: '中文', flag: '🇨🇳' },
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
    color: '#22c55e',
    languages: BUILTIN_LANGUAGES.map(l => ({ code: l.code, name: l.name, flag: l.flag })),
    enabledLanguages: 'en,es,fr,ara,zh',
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

    let finalEnabledLanguages = enabledLanguages || 'en,es,fr,ara,zh';
    const enabledCodes = finalEnabledLanguages.split(',').map(s => s.trim()).filter(Boolean);
    for (const code of MANDATORY_LANG_CODES) {
      if (!enabledCodes.includes(code)) enabledCodes.push(code);
    }
    finalEnabledLanguages = enabledCodes.join(',');

    const updateData = {};
    if (position !== undefined) updateData.widgetPosition = position;
    if (color) updateData.widgetColor = color;
    if (enabledLanguages) {
      updateData.enabledLanguages = finalEnabledLanguages;
      updateData.activeLanguages = finalEnabledLanguages;
    }
    if (customLanguages !== undefined) updateData.customLanguages = customLanguages;

    await prisma.shopSetting.upsert({
      where: { shopId: shopRecord.id },
      update: updateData,
      create: {
        shopId: shopRecord.id,
        widgetPosition: position !== undefined ? position : 'bottom-right',
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

    const token = crypto.randomBytes(32).toString('hex');

    await prisma.shopSetting.upsert({
      where: { shopId: shopRecord.id },
      update: { debugToken: token },
      create: {
        shopId: shopRecord.id,
        debugToken: token,
      },
    });

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

module.exports = router;
