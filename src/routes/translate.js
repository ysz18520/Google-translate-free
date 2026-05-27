const express = require('express');
const { encrypt, decrypt } = require('../utils/crypto');
const prisma = require('../utils/db');

const router = express.Router();

/**
 * @route POST /api/translate/config
 * @desc 保存翻译引擎配置
 */
router.post('/config', async (req, res) => {
  const { shop, provider, apiKey, apiSecret, model, endpoint, confirmReTranslate } = req.body;

  if (!shop) {
    return res.status(400).json({ error: 'Missing shop parameter' });
  }

  try {
    const shopRecord = await prisma.shop.findUnique({
      where: { shopDomain: shop },
    });

    if (!shopRecord) {
      return res.status(401).json({ error: 'Shop not authorized' });
    }

    const currentSetting = await prisma.shopSetting.findUnique({
      where: { shopId: shopRecord.id },
    });

    const currentProvider = currentSetting?.translateProvider || 'baidu';
    const AI_PROVIDERS = ['openai-compat', 'anthropic-compat'];
    const isSwitchingToAi = AI_PROVIDERS.includes(provider) && !AI_PROVIDERS.includes(currentProvider);

    if (isSwitchingToAi && !confirmReTranslate) {
      const count = await prisma.translation.count({
        where: {
          shopId: shopRecord.id,
          status: 'translated',
        },
      });

      return res.json({
        requireConfirm: true,
        message: '切换到 AI 翻译将使用您自己的 API Key 进行全量重翻，可能产生费用',
        translatedCount: count,
        currentProvider,
        newProvider: provider,
      });
    }

    const updateData = {
      translateProvider: provider || 'baidu',
      translateModel: AI_PROVIDERS.includes(provider) ? (model || null) : null,
      translateEndpoint: AI_PROVIDERS.includes(provider) ? (endpoint || null) : null,
    };

    if (apiKey) updateData.translateApiKey = encrypt(apiKey);
    if (apiSecret) updateData.translateApiSecret = encrypt(apiSecret);

    await prisma.shopSetting.upsert({
      where: { shopId: shopRecord.id },
      update: updateData,
      create: {
        shopId: shopRecord.id,
        ...updateData,
      },
    });

    if (confirmReTranslate && isSwitchingToAi) {
      await prisma.translation.updateMany({
        where: {
          shopId: shopRecord.id,
          status: 'translated',
        },
        data: { status: 'outdated' },
      });
    }

    res.json({
      success: true,
      message: isSwitchingToAi && confirmReTranslate
        ? '配置已保存，所有翻译已标记为待更新，将自动重新翻译'
        : '配置已保存',
      provider: updateData.translateProvider,
      reTranslateTriggered: !!(confirmReTranslate && isSwitchingToAi),
    });
  } catch (error) {
    console.error('[Translate Config Error]', error.message);
    res.status(500).json({ error: 'Failed to save config', details: error.message });
  }
});

/**
 * @route GET /api/translate/config
 * @desc 获取翻译引擎配置（脱敏）
 */
router.get('/config', async (req, res) => {
  const { shop } = req.query;

  if (!shop) {
    return res.status(400).json({ error: 'Missing shop parameter' });
  }

  try {
    const shopRecord = await prisma.shop.findUnique({
      where: { shopDomain: shop },
    });

    if (!shopRecord) {
      return res.status(401).json({ error: 'Shop not authorized' });
    }

    const setting = await prisma.shopSetting.findUnique({
      where: { shopId: shopRecord.id },
    });

    if (!setting || !setting.translateProvider) {
      return res.json({
        provider: 'baidu',
        model: null,
        endpoint: null,
        apiKeyMasked: null,
        hasApiSecret: false,
      });
    }

    const apiKey = setting.translateApiKey;
    let maskedKey = null;
    if (apiKey) {
      try {
        const decrypted = require('../utils/crypto').decrypt(apiKey);
        maskedKey = decrypted.substring(0, 4) + '****' + decrypted.substring(decrypted.length - 4);
      } catch {
        maskedKey = apiKey.substring(0, 4) + '****' + apiKey.substring(apiKey.length - 4);
      }
    }

    res.json({
      provider: setting.translateProvider,
      model: setting.translateModel,
      endpoint: setting.translateEndpoint,
      apiKeyMasked: maskedKey,
      hasApiSecret: !!setting.translateApiSecret,
    });
  } catch (error) {
    console.error('[Translate Config Get Error]', error.message);
    res.status(500).json({ error: 'Failed to get config', details: error.message });
  }
});

/**
 * @route GET /api/translate/languages
 * @desc 获取支持的语言列表
 */
router.get('/languages', (req, res) => {
  const languages = [
    { code: 'en', name: 'English', nameLocal: 'English' },
    { code: 'es', name: 'Spanish', nameLocal: 'Español' },
    { code: 'fr', name: 'French', nameLocal: 'Français' },
    { code: 'ara', name: 'Arabic', nameLocal: 'العربية' },
    { code: 'zh', name: 'Chinese', nameLocal: '中文' },
  ];

  res.json({ languages });
});

module.exports = router;
