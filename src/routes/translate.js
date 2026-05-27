const express = require('express');
const { encrypt, decrypt } = require('../utils/crypto');
const prisma = require('../utils/db');

const router = express.Router();

/**
 * @route POST /api/translate/config
 * @desc 保存翻译引擎配置
 */
router.post('/config', async (req, res) => {
  const { shop, provider, apiKey, apiSecret, model, endpoint } = req.body;

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

    const updateData = {
      translateProvider: provider || null,
      translateModel: model || null,
      translateEndpoint: endpoint || null,
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

    res.json({
      success: true,
      message: '配置已保存',
      provider: updateData.translateProvider,
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
