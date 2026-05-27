const express = require('express');
const crypto = require('crypto');
const { translate, translateBatch, getShopTranslatorConfig, testConnection } = require('../services/translator');
const { encrypt, decrypt } = require('../utils/crypto');
const prisma = require('../utils/db');
const shopifyService = require('../services/shopify');
const config = require('../config');

const router = express.Router();

// 内存任务存储
const translationJobs = new Map();

/**
 * 计算内容哈希
 */
function computeHash(text) {
  return crypto.createHash('md5').update(text || '').digest('hex');
}

/**
 * 从 HTML 字符串中提取可翻译的文本片段
 * 模拟浏览器文本节点拆分，确保与前端 getTextNodes() 粒度一致
 */
function extractTextSegmentsFromHTML(html) {
  if (!html) return [];

  // 解码常见 HTML 实体
  let decoded = html
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&apos;/g, "'");

  // 移除 script/style/noscript/iframe/code/pre 标签及其内容（与前端 IGNORE_SELECTORS 一致）
  let cleaned = decoded
    .replace(/<(script|style|noscript|iframe|code|pre)[\s\S]*?<\/\1>/gi, '');

  // 将所有 HTML 标签替换为换行符（模拟标签边界拆分文本节点）
  cleaned = cleaned.replace(/<[^>]+>/g, '\n');

  // 提取并过滤文本片段
  const segments = [];
  const seen = new Set();

  for (const line of cleaned.split('\n')) {
    const text = line
      .replace(/\s+/g, ' ')   // 合并连续空白为单个空格
      .trim();

    if (!text || text.length < 2) continue;
    if (/^[\d\s\W]+$/.test(text)) continue; // 纯数字和符号，跳过
    if (seen.has(text)) continue;             // 去重

    seen.add(text);
    segments.push(text);
  }

  return segments;
}

/**
 * @route POST /api/translate/text
 * @desc 单文本翻译（带缓存）
 */
router.post('/text', async (req, res) => {
  const { text, from = 'en', to = 'zh', shop, resourceType, resourceId, field } = req.body;

  if (!text || !text.trim()) {
    return res.status(400).json({ error: 'Missing text parameter' });
  }

  try {
    let shopRecord = null;
    if (shop) {
      shopRecord = await prisma.shop.findUnique({ where: { shopDomain: shop } });
    }

    // 如果有完整的资源信息，查数据库缓存
    if (shopRecord && resourceType && resourceId && field) {
      const hash = computeHash(text);
      const existing = await prisma.translation.findUnique({
        where: {
          shopId_resourceType_resourceId_field_targetLang: {
            shopId: shopRecord.id,
            resourceType,
            resourceId: resourceId.toString(),
            field,
            targetLang: to,
          },
        },
      });

      if (existing && existing.status === 'translated' && existing.sourceHash === hash) {
        return res.json({
          source: text,
          translated: existing.translatedText,
          from,
          to,
          cached: true,
          status: 'translated',
        });
      }

      // 如果存在但内容变了，更新为 outdated 后重新翻译
      if (existing && existing.sourceHash !== hash) {
        await prisma.translation.update({
          where: { id: existing.id },
          data: { status: 'outdated' },
        });
      }
    }

    // 调用翻译 API（通过抽象层，根据店铺配置选择引擎）
    const result = await translate(text, from, to, shopRecord?.id);
    const { provider } = await getShopTranslatorConfig(shopRecord?.id);

    // 存入数据库
    if (shopRecord && resourceType && resourceId && field) {
      await prisma.translation.upsert({
        where: {
          shopId_resourceType_resourceId_field_targetLang: {
            shopId: shopRecord.id,
            resourceType,
            resourceId: resourceId.toString(),
            field,
            targetLang: to,
          },
        },
        update: {
          sourceText: text,
          sourceHash: computeHash(text),
          translatedText: result.text,
          status: 'translated',
          provider,
          inputTokens: result.inputTokens || 0,
          outputTokens: result.outputTokens || 0,
          updatedAt: new Date(),
        },
        create: {
          shopId: shopRecord.id,
          resourceType,
          resourceId: resourceId.toString(),
          field,
          sourceText: text,
          sourceHash: computeHash(text),
          sourceLang: from,
          targetLang: to,
          translatedText: result.text,
          status: 'translated',
          provider,
          inputTokens: result.inputTokens || 0,
          outputTokens: result.outputTokens || 0,
        },
      });
    }

    res.json({
      source: text,
      translated: result.text,
      from,
      to,
      cached: false,
      status: 'translated',
    });
  } catch (error) {
    console.error('[Translate Text Error]', error.message);
    res.status(500).json({ error: 'Translation failed', details: error.message, errorCode: error.code });
  }
});

/**
 * @route POST /api/translate/batch
 * @desc 批量翻译（带缓存）
 */
router.post('/batch', async (req, res) => {
  const { items, from = 'en', to = 'zh', shop, resourceType } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Items must be a non-empty array' });
  }

  if (items.length > 50) {
    return res.status(400).json({ error: 'Maximum 50 items per batch' });
  }

  try {
    let shopRecord = null;
    if (shop) {
      shopRecord = await prisma.shop.findUnique({ where: { shopDomain: shop } });
    }

    const results = [];
    const toTranslate = [];

    // 先检查缓存
    for (const item of items) {
      const text = item.text || item;
      const hash = computeHash(text);

      let cached = null;
      if (shopRecord && resourceType && item.resourceId && item.field) {
        cached = await prisma.translation.findUnique({
          where: {
            shopId_resourceType_resourceId_field_targetLang: {
              shopId: shopRecord.id,
              resourceType,
              resourceId: item.resourceId.toString(),
              field: item.field,
              targetLang: to,
            },
          },
        });
      }

      if (cached && cached.status === 'translated' && cached.sourceHash === hash) {
        results.push({
          source: text,
          translated: cached.translatedText,
          from: item.from || from,
          to: item.to || to,
          cached: true,
        });
      } else {
        toTranslate.push({ item, hash, cached });
      }
    }

    // 批量翻译未缓存的内容
    if (toTranslate.length > 0) {
      const translateItems = toTranslate.map(({ item }) => ({
        text: item.text || item,
        from: item.from || from,
        to: item.to || to,
      }));

      const translatedResults = await translateBatch(translateItems, shopRecord?.id);
      const { provider } = await getShopTranslatorConfig(shopRecord?.id);

      for (let i = 0; i < toTranslate.length; i++) {
        const { item, hash } = toTranslate[i];
        const result = translatedResults[i];

        // 保存到数据库
        if (shopRecord && resourceType && item.resourceId && item.field) {
          await prisma.translation.upsert({
            where: {
              shopId_resourceType_resourceId_field_targetLang: {
                shopId: shopRecord.id,
                resourceType,
                resourceId: item.resourceId.toString(),
                field: item.field,
                targetLang: to,
              },
            },
            update: {
              sourceText: item.text || item,
              sourceHash: hash,
              translatedText: result.text,
              status: 'translated',
              provider,
              inputTokens: result.inputTokens || 0,
              outputTokens: result.outputTokens || 0,
              updatedAt: new Date(),
            },
            create: {
              shopId: shopRecord.id,
              resourceType,
              resourceId: item.resourceId.toString(),
              field: item.field,
              sourceText: item.text || item,
              sourceHash: hash,
              sourceLang: from,
              targetLang: to,
              translatedText: result.text,
              status: 'translated',
              provider,
              inputTokens: result.inputTokens || 0,
              outputTokens: result.outputTokens || 0,
            },
          });
        }

        results.push({
          source: item.text || item,
          translated: result.text,
          from: item.from || from,
          to: item.to || to,
          cached: false,
        });
      }
    }

    res.json({ results });
  } catch (error) {
    console.error('[Translate Batch Error]', error.message);
    res.status(500).json({ error: 'Batch translation failed', details: error.message, errorCode: error.code });
  }
});

/**
 * @route POST /api/translate/refresh-all
 * @desc 刷新所有语言的翻译（店主用）
 */
router.post('/refresh-all', async (req, res) => {
  const { shop, resourceType, resourceId } = req.body;

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

    // 获取店铺设置中的活跃语言（优先 enabledLanguages，兼容 activeLanguages）
    const setting = await prisma.shopSetting.findUnique({
      where: { shopId: shopRecord.id },
    });

    const activeLanguages = setting?.enabledLanguages?.split(',')
      || setting?.activeLanguages?.split(',')
      || ['en', 'es', 'fr', 'ara', 'zh'];
    const sourceLang = 'en'; // 源语言固定为英文（Shopify 店铺原始语言）

    // 标记所有相关翻译为 outdated
    const whereClause = {
      shopId: shopRecord.id,
      status: 'translated',
    };

    if (resourceType) whereClause.resourceType = resourceType;
    if (resourceId) whereClause.resourceId = resourceId.toString();

    await prisma.translation.updateMany({
      where: whereClause,
      data: { status: 'outdated' },
    });

    res.json({
      success: true,
      message: 'Translations marked as outdated, will be refreshed on next visit',
      affectedLanguages: activeLanguages,
      resourceType: resourceType || 'all',
      resourceId: resourceId || 'all',
    });
  } catch (error) {
    console.error('[Refresh All Error]', error.message);
    res.status(500).json({ error: 'Refresh failed', details: error.message });
  }
});

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

    // 获取当前配置，判断是否发生切换
    const currentSetting = await prisma.shopSetting.findUnique({
      where: { shopId: shopRecord.id },
    });

    const currentProvider = currentSetting?.translateProvider || 'baidu';
    const AI_PROVIDERS = ['openai-compat', 'anthropic-compat'];
    const isSwitchingToAi = AI_PROVIDERS.includes(provider) && !AI_PROVIDERS.includes(currentProvider);

    // 切换到 AI 翻译时，需要用户确认全量重翻
    if (isSwitchingToAi && !confirmReTranslate) {
      // 统计待重翻的文本数量（估算成本）
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

    // 所有引擎都支持保存凭证（百度存 App ID/Secret Key，AI 存 API Key/Secret）
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

    // 如果确认全量覆盖，标记所有翻译为 outdated
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
    // 脱敏：取解密后前4位 + **** + 后4位（如果已加密存储）
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
 * @route POST /api/translate/test-connection
 * @desc 测试翻译引擎连通性
 */
router.post('/test-connection', async (req, res) => {
  const { provider, apiKey, apiSecret, model, endpoint, shop } = req.body;

  if (!provider) {
    return res.status(400).json({ error: 'Missing provider parameter' });
  }

  try {
    let credentials = {
      apiKey,
      apiSecret,
      model,
      endpoint,
    };

    // 如果未提供 apiKey 但提供了 shop，从数据库读取已保存的配置
    if (!apiKey && shop) {
      const shopRecord = await prisma.shop.findUnique({
        where: { shopDomain: shop },
      });
      if (shopRecord) {
        const setting = await prisma.shopSetting.findUnique({
          where: { shopId: shopRecord.id },
        });
        if (setting && setting.translateApiKey) {
          credentials.apiKey = decrypt(setting.translateApiKey);
          credentials.apiSecret = setting.translateApiSecret ? decrypt(setting.translateApiSecret) : undefined;
          credentials.model = setting.translateModel || undefined;
          credentials.endpoint = setting.translateEndpoint || undefined;
        }
      }
    }

    const result = await testConnection(provider, credentials);
    res.json(result);
  } catch (error) {
    console.error('[Test Connection Error]', error.message);
    res.status(500).json({ error: 'Test failed', details: error.message });
  }
});

/**
 * @route GET /api/translate/languages
 * @desc 获取支持的语言列表
 */
router.get('/languages', (req, res) => {
  const languages = [
    { code: 'en', name: 'English', nameLocal: 'English', baiduCode: 'en' },
    { code: 'es', name: 'Spanish', nameLocal: 'Español', baiduCode: 'spa' },
    { code: 'fr', name: 'French', nameLocal: 'Français', baiduCode: 'fra' },
    { code: 'ara', name: 'Arabic', nameLocal: 'العربية', baiduCode: 'ara' },
    { code: 'zh', name: 'Chinese', nameLocal: '中文', baiduCode: 'zh' },
  ];

  res.json({ languages });
});

/**
 * @route GET /api/translate/active-jobs
 * @desc 获取店铺当前进行中的翻译任务
 */
router.get('/active-jobs', (req, res) => {
  const { shop } = req.query;
  if (!shop) {
    return res.status(400).json({ error: 'Missing shop parameter' });
  }

  const jobs = [];
  for (const [_, job] of translationJobs) {
    if (job.shop === shop && (job.status === 'pending' || job.status === 'running')) {
      jobs.push({
        id: job.id,
        type: job.type,
        status: job.status,
        total: job.total,
        processed: job.processed,
        failed: job.failed,
        currentResource: job.currentResource,
        message: job.message,
      });
    }
  }

  res.json({ jobs });
});

/**
 * @route GET /api/translate/status
 * @desc 批量查询资源翻译状态
 */
router.get('/status', async (req, res) => {
  const { shop, resourceType, resourceIds } = req.query;

  if (!shop || !resourceType || !resourceIds) {
    return res.status(400).json({ error: 'Missing parameters' });
  }

  try {
    const shopRecord = await prisma.shop.findUnique({
      where: { shopDomain: shop },
    });

    if (!shopRecord) {
      return res.status(401).json({ error: 'Shop not authorized' });
    }

    const ids = resourceIds.split(',');

    // 查询这些资源的翻译记录
    const translations = await prisma.translation.findMany({
      where: {
        shopId: shopRecord.id,
        resourceType,
        resourceId: { in: ids },
      },
      select: {
        resourceId: true,
        targetLang: true,
        status: true,
      },
    });

    // 按 resourceId 聚合状态
    const statuses = {};
    for (const id of ids) {
      statuses[id] = {};
    }

    for (const t of translations) {
      if (!statuses[t.resourceId]) statuses[t.resourceId] = {};
      statuses[t.resourceId][t.targetLang] = t.status;
    }

    res.json({ statuses });
  } catch (error) {
    console.error('[Translate Status Error]', error.message);
    res.status(500).json({ error: 'Failed to fetch status' });
  }
});

/**
 * @route GET /api/translate/stats
 * @desc 获取店铺翻译统计
 */
router.get('/stats', async (req, res) => {
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

    // 使用 findMany 手动去重，兼容性优于 groupBy（某些 MySQL 配置下 groupBy 会被拒绝）
    const productTranslations = await prisma.translation.findMany({
      where: {
        shopId: shopRecord.id,
        resourceType: 'product',
        status: 'translated',
      },
      select: { resourceId: true },
      distinct: ['resourceId'],
    });
    const translatedProducts = productTranslations.length;

    const pageTranslations = await prisma.translation.findMany({
      where: {
        shopId: shopRecord.id,
        resourceType: 'page',
        status: 'translated',
      },
      select: { resourceId: true },
      distinct: ['resourceId'],
    });
    const translatedPages = pageTranslations.length;

    const apiCalls = await prisma.translation.count({
      where: {
        shopId: shopRecord.id,
        status: 'translated',
      },
    });

    // 获取当前店铺使用的翻译引擎
    const { provider } = await getShopTranslatorConfig(shopRecord.id);

    // AI 引擎：统计 token 消耗
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    if (provider !== 'baidu') {
      const tokenAgg = await prisma.translation.aggregate({
        where: {
          shopId: shopRecord.id,
          status: 'translated',
          provider: { not: 'baidu' },
        },
        _sum: {
          inputTokens: true,
          outputTokens: true,
        },
      });
      totalInputTokens = tokenAgg._sum.inputTokens || 0;
      totalOutputTokens = tokenAgg._sum.outputTokens || 0;
    }

    console.log(`[Stats] shop=${shop} provider=${provider} products=${translatedProducts} pages=${translatedPages} apiCalls=${apiCalls} inputTokens=${totalInputTokens} outputTokens=${totalOutputTokens}`);

    res.json({
      translatedProducts,
      translatedPages,
      apiCalls,
      provider,
      totalInputTokens,
      totalOutputTokens,
    });
  } catch (error) {
    console.error('[Translate Stats Error]', error.message);
    res.status(500).json({ error: 'Failed to fetch stats', details: error.message });
  }
});

/**
 * @route POST /api/translate/all
 * @desc 创建全量翻译任务（智能增量）
 */
router.post('/all', async (req, res) => {
  const { shop, type } = req.body;

  if (!shop) {
    return res.status(400).json({ error: 'Missing shop parameter' });
  }
  if (!type || !['products', 'pages', 'theme', 'all'].includes(type)) {
    return res.status(400).json({ error: 'Invalid type, must be products, pages, theme, or all' });
  }

  try {
    const shopRecord = await prisma.shop.findUnique({
      where: { shopDomain: shop },
    });

    if (!shopRecord) {
      return res.status(401).json({ error: 'Shop not authorized' });
    }

    // 检查是否已有进行中的任务
    for (const [_, job] of translationJobs) {
      if (job.shop === shop && job.type === type && job.status === 'running') {
        return res.status(409).json({ error: 'A translation job is already running', jobId: job.id });
      }
    }

    // 获取店铺活跃语言（优先 enabledLanguages，兼容 activeLanguages）
    const setting = await prisma.shopSetting.findUnique({
      where: { shopId: shopRecord.id },
    });
    const activeLanguages = setting?.enabledLanguages?.split(',')
      || setting?.activeLanguages?.split(',')
      || ['en', 'es', 'fr', 'ara', 'zh'];

    const jobId = crypto.randomUUID();
    const job = {
      id: jobId,
      shop,
      type,
      status: 'pending',
      total: 0,
      processed: 0,
      failed: 0,
      paused: false,
      currentResource: '',
      message: '准备中...',
      createdAt: new Date(),
    };
    translationJobs.set(jobId, job);

    // 后台启动翻译任务
    runTranslationJob(jobId, shopRecord, type, activeLanguages);

    res.json({ jobId, status: 'pending', message: 'Translation job started' });
  } catch (error) {
    console.error('[Create Translation Job Error]', error.message);
    res.status(500).json({ error: 'Failed to start translation job', details: error.message });
  }
});

/**
 * @route GET /api/translate/job/:jobId
 * @desc 查询翻译任务进度
 */
router.get('/job/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = translationJobs.get(jobId);

  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  res.json({
    id: job.id,
    status: job.status,
    type: job.type,
    total: job.total ?? 0,
    processed: job.processed ?? 0,
    failed: job.failed ?? 0,
    paused: job.paused ?? false,
    currentResource: job.currentResource || '',
    message: job.message || '准备中...',
    createdAt: job.createdAt,
  });
});

/**
 * @route POST /api/translate/job/:jobId/pause
 * @desc 暂停翻译任务
 */
router.post('/job/:jobId/pause', (req, res) => {
  const { jobId } = req.params;
  const job = translationJobs.get(jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (job.status !== 'running') return res.status(400).json({ error: 'Job is not running' });
  job.paused = true;
  job.message = '已暂停';
  res.json({ success: true, paused: true });
});

/**
 * @route POST /api/translate/job/:jobId/resume
 * @desc 恢复翻译任务
 */
router.post('/job/:jobId/resume', (req, res) => {
  const { jobId } = req.params;
  const job = translationJobs.get(jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  job.paused = false;
  res.json({ success: true, paused: false });
});

/**
 * 执行翻译任务（后台异步）
 * B方案：从 body_html 中提取文本片段，分别翻译存储，与前端文本节点粒度匹配
 */
async function runTranslationJob(jobId, shopRecord, type, activeLanguages) {
  const job = translationJobs.get(jobId);
  if (!job) return;

  job.status = 'running';
  const shopSetting = await prisma.shopSetting.findUnique({
    where: { shopId: shopRecord.id },
  });
  const sourceLang = 'en';
  const targetLangs = activeLanguages.filter(l => l !== sourceLang);
  const { provider } = await getShopTranslatorConfig(shopRecord.id);

  // all 类型：依次执行 products → pages → theme
  if (type === 'all') {
    return runAllTranslationJob(jobId, shopRecord, targetLangs);
  }

  // Theme 类型走独立逻辑
  if (type === 'theme') {
    return runThemeTranslationJob(jobId, shopRecord, targetLangs);
  }

  const resourceType = type === 'products' ? 'product' : 'page';

  // Job 级别翻译缓存：避免同一文本重复调用 API
  const translationCache = new Map();

  try {
    // 获取所有资源
    let resources = [];
    if (type === 'products') {
      job.message = '正在获取商品列表...';
      resources = await shopifyService.getAllProducts(
        shopRecord.shopDomain,
        shopRecord.accessToken,
        config.shopify.apiVersion
      );
    } else {
      job.message = '正在获取页面列表...';
      resources = await shopifyService.getAllPages(
        shopRecord.shopDomain,
        shopRecord.accessToken,
        config.shopify.apiVersion
      );
    }

    job.total = resources.length;
    job.message = `共 ${resources.length} 个${type === 'products' ? '商品' : '页面'}，开始翻译...`;

    for (let i = 0; i < resources.length; i++) {
      const resource = resources[i];
      job.currentResource = resource.title || `Resource ${resource.id}`;
      job.processed = i;

      // 构建需要翻译的字段列表
      const fields = [];
      if (resource.title) {
        fields.push({ key: 'title', text: resource.title });
      }

      // body_html：提取文本片段，每个片段作为独立字段
      if (resource.body_html) {
        const segments = extractTextSegmentsFromHTML(resource.body_html);
        for (const seg of segments) {
          const segHash = computeHash(seg).substring(0, 12);
          fields.push({ key: `body_html:${segHash}`, text: seg, isSegment: true });
        }
        // 保留整体 body_html 翻译作为 fallback（field key 仍为 body_html）
        fields.push({ key: 'body_html', text: resource.body_html });
      }

      // 批量查询该资源所有已有的翻译记录（减少数据库查询次数）
      const allFieldKeys = fields.map(f => f.key);
      const existingTranslations = await prisma.translation.findMany({
        where: {
          shopId: shopRecord.id,
          resourceType,
          resourceId: resource.id.toString(),
          field: { in: allFieldKeys },
          targetLang: { in: targetLangs },
        },
      });

      // 构建 existing 查找映射: "field:lang" -> translation record
      const existingMap = new Map();
      for (const t of existingTranslations) {
        existingMap.set(`${t.field}:${t.targetLang}`, t);
      }

      for (const field of fields) {
        const hash = computeHash(field.text);

        for (const lang of targetLangs) {
          const mapKey = `${field.key}:${lang}`;
          const existing = existingMap.get(mapKey);

          if (existing && existing.status === 'translated' && existing.sourceHash === hash) {
            continue; // 已翻译且内容未变，跳过
          }

          // 尝试从 job 级缓存获取翻译结果（跨资源去重）
          const cacheKey = `${lang}:${hash}`;
          let cachedResult = translationCache.get(cacheKey);

          if (!cachedResult) {
            try {
              cachedResult = await translate(field.text, sourceLang, lang, shopRecord.id);
              translationCache.set(cacheKey, cachedResult);

              // API 限流
              await new Promise(r => setTimeout(r, 100));
            } catch (err) {
              job.failed++;
              console.error(`[Translate Job] Failed ${resourceType} ${resource.id} ${field.key} -> ${lang}:`, err.message);
              continue;
            }
          }

          // 存入数据库
          try {
            await prisma.translation.upsert({
              where: {
                shopId_resourceType_resourceId_field_targetLang: {
                  shopId: shopRecord.id,
                  resourceType,
                  resourceId: resource.id.toString(),
                  field: field.key,
                  targetLang: lang,
                },
              },
              update: {
                sourceText: field.text,
                sourceHash: hash,
                translatedText: cachedResult.text,
                status: 'translated',
                provider,
                inputTokens: cachedResult.inputTokens || 0,
                outputTokens: cachedResult.outputTokens || 0,
                updatedAt: new Date(),
              },
              create: {
                shopId: shopRecord.id,
                resourceType,
                resourceId: resource.id.toString(),
                field: field.key,
                sourceText: field.text,
                sourceHash: hash,
                sourceLang,
                targetLang: lang,
                translatedText: cachedResult.text,
                status: 'translated',
                provider,
                inputTokens: cachedResult.inputTokens || 0,
                outputTokens: cachedResult.outputTokens || 0,
              },
            });
          } catch (dbErr) {
            job.failed++;
            console.error(`[Translate Job] DB upsert failed ${resourceType} ${resource.id} ${field.key}:`, dbErr.message);
          }
        }
      }
    }

    job.processed = job.total;
    job.status = 'completed';
    job.currentResource = '';
    job.message = `翻译完成，共 ${job.total} 个${type === 'products' ? '商品' : '页面'}${job.failed > 0 ? `，${job.failed} 个失败` : ''}`;
  } catch (err) {
    job.status = 'failed';
    job.message = err.message;
    console.error('[Translate Job Error]', err);
  }
}

/**
 * 从 Shopify Theme locales JSON 中递归提取可翻译文本
 */
function extractTextsFromLocales(obj, results = new Set()) {
  if (typeof obj === 'string') {
    const text = obj.trim();
    // 过滤：长度>=2，不是纯数字/标点，不包含 Liquid 变量
    if (text.length >= 2 && !/^\d+$/.test(text) && !text.includes('{{') && !text.includes('{%')) {
      results.add(text);
    }
    return results;
  }
  if (Array.isArray(obj)) {
    for (const item of obj) {
      extractTextsFromLocales(item, results);
    }
  } else if (obj !== null && typeof obj === 'object') {
    for (const key of Object.keys(obj)) {
      extractTextsFromLocales(obj[key], results);
    }
  }
  return results;
}

/**
 * 执行 Theme 翻译任务（后台异步）
 * 翻译 locales 文件 + navigation 菜单
 */
async function runThemeTranslationJob(jobId, shopRecord, targetLangs) {
  const job = translationJobs.get(jobId);
  if (!job) return;

  const shopSetting = await prisma.shopSetting.findUnique({
    where: { shopId: shopRecord.id },
  });
  const sourceLang = 'en';
  const { provider } = await getShopTranslatorConfig(shopRecord.id);
  const translationCache = new Map();

  try {
    // 获取当前在线主题
    job.message = '正在获取主题信息...';
    const mainTheme = await shopifyService.getMainTheme(
      shopRecord.shopDomain,
      shopRecord.accessToken,
      config.shopify.apiVersion
    );

    if (!mainTheme) {
      throw new Error('No main theme found');
    }

    const themeId = mainTheme.id;
    job.currentResource = mainTheme.name || `Theme ${themeId}`;

    // 读取 locales 文件
    job.message = '正在读取主题语言文件...';
    let localesAsset = await shopifyService.getThemeAsset(
      shopRecord.shopDomain,
      shopRecord.accessToken,
      config.shopify.apiVersion,
      themeId,
      'locales/en.default.json'
    );

    // 如果 en.default.json 不存在，尝试 en.json
    if (!localesAsset) {
      localesAsset = await shopifyService.getThemeAsset(
        shopRecord.shopDomain,
        shopRecord.accessToken,
        config.shopify.apiVersion,
        themeId,
        'locales/en.json'
      );
    }

    const texts = new Set();

    // 解析 locales 文件
    if (localesAsset && localesAsset.value) {
      try {
        const localesJson = JSON.parse(localesAsset.value);
        extractTextsFromLocales(localesJson, texts);
        console.log(`[Theme Translate] Extracted ${texts.size} texts from locales`);
      } catch (parseErr) {
        console.warn('[Theme Translate] Failed to parse locales JSON:', parseErr.message);
      }
    }

    // 读取 Navigation 菜单
    job.message = '正在读取导航菜单...';
    const linklists = await shopifyService.getLinklists(
      shopRecord.shopDomain,
      shopRecord.accessToken,
      config.shopify.apiVersion
    );

    for (const list of linklists) {
      if (list.title) texts.add(list.title.trim());
      if (list.links) {
        for (const link of list.links) {
          if (link.title) texts.add(link.title.trim());
        }
      }
    }

    const allTexts = Array.from(texts).filter(t => t.length >= 2 && !/^\d+$/.test(t));
    job.message = `共 ${allTexts.length} 个 theme 文本，开始翻译...`;

    // 批量查询已有翻译
    const existingTranslations = await prisma.translation.findMany({
      where: {
        shopId: shopRecord.id,
        resourceType: 'theme',
        resourceId: 'default',
        sourceText: { in: allTexts },
        targetLang: { in: targetLangs },
      },
    });

    const existingMap = new Map();
    for (const t of existingTranslations) {
      existingMap.set(`${t.sourceText}:${t.targetLang}`, t);
    }

    // 统计已有翻译状态
    let alreadyTranslated = 0;
    let needsUpdate = 0;
    let missingCount = 0;
    const textsToTranslate = [];
    for (const text of allTexts) {
      const hash = computeHash(text);
      let textUpToDate = true;
      for (const lang of targetLangs) {
        const existing = existingMap.get(`${text}:${lang}`);
        if (!existing) {
          missingCount++;
          textUpToDate = false;
        } else if (existing.status !== 'translated' || existing.sourceHash !== hash) {
          needsUpdate++;
          textUpToDate = false;
        }
      }
      if (textUpToDate) {
        alreadyTranslated++;
      } else {
        textsToTranslate.push(text);
      }
    }
    console.log(`[Theme Translate] Stats: total=${allTexts.length}, up-to-date=${alreadyTranslated}, needs-update=${needsUpdate}, missing=${missingCount}`);
    if (textsToTranslate.length > 0) {
      console.log('[Theme Translate] Missing texts:', textsToTranslate.slice(0, 10));
    }

    job.total = textsToTranslate.length || 1; // 避免 0/0 导致进度条异常
    job.processed = 0;

    // 翻译并存储
    for (let i = 0; i < textsToTranslate.length; i++) {
      while (job.paused) { job.message = '已暂停'; await new Promise(r => setTimeout(r, 500)); }
      if (job.status !== 'running') return;

      const text = textsToTranslate[i];
      job.currentResource = text.substring(0, 30);
      job.processed = i + 1;
      const hash = computeHash(text);

      for (const lang of targetLangs) {
        const mapKey = `${text}:${lang}`;
        const existing = existingMap.get(mapKey);

        if (existing && existing.status === 'translated' && existing.sourceHash === hash) {
          continue;
        }

        // Job 级缓存
        const cacheKey = `${lang}:${hash}`;
        let cachedResult = translationCache.get(cacheKey);

        if (!cachedResult) {
          try {
            cachedResult = await translate(text, sourceLang, lang, shopRecord.id);
            translationCache.set(cacheKey, cachedResult);
            await new Promise(r => setTimeout(r, 100)); // API 限流
          } catch (err) {
            job.failed++;
            console.error(`[Theme Translate] Failed "${text}" -> ${lang}:`, err.message);
            continue;
          }
        }

        try {
          await prisma.translation.upsert({
            where: {
              shopId_resourceType_resourceId_field_targetLang: {
                shopId: shopRecord.id,
                resourceType: 'theme',
                resourceId: 'default',
                field: text.substring(0, 100), // 用前100字符作为 field（辅助索引）
                targetLang: lang,
              },
            },
            update: {
              sourceText: text,
              sourceHash: hash,
              translatedText: cachedResult.text,
              status: 'translated',
              provider,
              inputTokens: cachedResult.inputTokens || 0,
              outputTokens: cachedResult.outputTokens || 0,
              updatedAt: new Date(),
            },
            create: {
              shopId: shopRecord.id,
              resourceType: 'theme',
              resourceId: 'default',
              field: text.substring(0, 100),
              sourceText: text,
              sourceHash: hash,
              sourceLang,
              targetLang: lang,
              translatedText: cachedResult.text,
              status: 'translated',
              provider,
              inputTokens: cachedResult.inputTokens || 0,
              outputTokens: cachedResult.outputTokens || 0,
            },
          });
        } catch (dbErr) {
          job.failed++;
          console.error(`[Theme Translate] DB upsert failed for "${text}":`, dbErr.message);
        }
      }
    }

    job.processed = job.total;
    job.status = 'completed';
    job.currentResource = '';
    if (textsToTranslate.length === 0 && job.failed === 0) {
      job.message = `Theme 已是最新（${allTexts.length} 个文本全部已翻译）`;
    } else {
      const successCount = textsToTranslate.length - job.failed;
      job.message = `Theme 翻译完成：${alreadyTranslated} 个已是最新，${successCount} 个新翻译${job.failed > 0 ? `，${job.failed} 个失败` : ''}`;
    }
  } catch (err) {
    job.status = 'failed';
    job.message = err.message;
    console.error('[Theme Translate Job Error]', err);
  }
}

/**
 * 清理无效翻译记录（已删除/已下架/未发布的资源）
 */
async function cleanupStaleTranslations(job, shopRecord) {
  try {
    // 获取当前有效的资源 ID
    const activeProducts = await shopifyService.getAllProducts(
      shopRecord.shopDomain, shopRecord.accessToken, config.shopify.apiVersion
    );
    const activeProductIds = new Set(activeProducts.map(p => p.id.toString()));

    const publishedPages = await shopifyService.getAllPages(
      shopRecord.shopDomain, shopRecord.accessToken, config.shopify.apiVersion
    );
    const publishedPageIds = new Set(publishedPages.map(p => p.id.toString()));

    // 删除无效的产品翻译
    const deletedProducts = await prisma.translation.deleteMany({
      where: {
        shopId: shopRecord.id,
        resourceType: 'product',
        NOT: { resourceId: { in: Array.from(activeProductIds) } },
      },
    });

    // 删除无效的页面翻译
    const deletedPages = await prisma.translation.deleteMany({
      where: {
        shopId: shopRecord.id,
        resourceType: 'page',
        NOT: { resourceId: { in: Array.from(publishedPageIds) } },
      },
    });

    const totalDeleted = deletedProducts.count + deletedPages.count;
    if (totalDeleted > 0) {
      console.log(`[Cleanup] Removed ${totalDeleted} stale translations (${deletedProducts.count} products, ${deletedPages.count} pages)`);
    }
  } catch (err) {
    console.error('[Cleanup] Failed to cleanup stale translations:', err.message);
    // 清理失败不阻断翻译流程
  }
}

/**
 * 执行全站翻译任务（依次：products → pages → theme）
 */
async function runAllTranslationJob(jobId, shopRecord, targetLangs) {
  const job = translationJobs.get(jobId);
  if (!job) return;

  const shopSetting = await prisma.shopSetting.findUnique({
    where: { shopId: shopRecord.id },
  });
  const sourceLang = 'en';
  let totalFailed = 0;

  try {
    // 确保 job 字段有初始值
    job.processed = 0;
    job.total = 0;
    job.failed = 0;

    // 兜底扫描：清理已删除/已下架/未发布资源的翻译记录
    job.message = '正在清理无效翻译记录...';
    await cleanupStaleTranslations(job, shopRecord);

    // Phase 1: Products
    job.message = '阶段 1/3：翻译商品...';
    job.currentResource = '';
    const productJobId = `${jobId}_products`;
    translationJobs.set(productJobId, job);
    await runTranslationJobWithProgress(productJobId, shopRecord, 'products', targetLangs, (p, t, msg) => {
      job.processed = p;
      job.total = t;
      job.message = msg;
    });
    totalFailed += job.failed;

    // Phase 2: Pages
    job.failed = 0;
    job.message = '阶段 2/3：翻译页面...';
    job.currentResource = '';
    const pageJobId = `${jobId}_pages`;
    translationJobs.set(pageJobId, job);
    await runTranslationJobWithProgress(pageJobId, shopRecord, 'pages', targetLangs, (p, t, msg) => {
      job.processed = p;
      job.total = t;
      job.message = msg;
    });
    totalFailed += job.failed;

    // Phase 3: Theme
    job.failed = 0;
    job.message = '阶段 3/3：翻译 Theme...';
    job.currentResource = '';
    await runThemeTranslationJob(jobId, shopRecord, targetLangs);
    totalFailed += job.failed;

    job.processed = job.total;
    job.status = 'completed';
    job.currentResource = '';
    if (totalFailed > 0) {
      job.message = `全站翻译完成，${totalFailed} 个失败（可查看日志了解详情）`;
    } else {
      job.message = '全站翻译完成，所有内容已是最新';
    }
  } catch (err) {
    job.status = 'failed';
    job.message = err.message;
    console.error('[All Translate Job Error]', err);
  }
}

/**
 * 带进度回调的翻译任务执行器
 */
async function runTranslationJobWithProgress(jobId, shopRecord, type, targetLangs, onProgress) {
  const job = translationJobs.get(jobId);
  if (!job) return;

  const shopSetting = await prisma.shopSetting.findUnique({
    where: { shopId: shopRecord.id },
  });
  const sourceLang = 'en';
  const resourceType = type === 'products' ? 'product' : 'page';
  const { provider } = await getShopTranslatorConfig(shopRecord.id);
  const translationCache = new Map();

  try {
    let resources = [];
    if (type === 'products') {
      resources = await shopifyService.getAllProducts(
        shopRecord.shopDomain, shopRecord.accessToken, config.shopify.apiVersion
      );
    } else {
      resources = await shopifyService.getAllPages(
        shopRecord.shopDomain, shopRecord.accessToken, config.shopify.apiVersion
      );
    }

    let totalItems = resources.length;
    let processedItems = 0;

    for (let i = 0; i < resources.length; i++) {
      while (job.paused) { job.message = '已暂停'; await new Promise(r => setTimeout(r, 500)); }
      if (job.status !== 'running') return;

      const resource = resources[i];
      job.currentResource = resource.title || `Resource ${resource.id}`;
      processedItems = i;
      onProgress(processedItems, totalItems, `翻译${type === 'products' ? '商品' : '页面'} ${resource.title || resource.id}...`);

      const fields = [];
      if (resource.title) {
        fields.push({ key: 'title', text: resource.title });
      }
      if (resource.body_html) {
        const segments = extractTextSegmentsFromHTML(resource.body_html);
        for (const seg of segments) {
          const segHash = computeHash(seg).substring(0, 12);
          fields.push({ key: `body_html:${segHash}`, text: seg, isSegment: true });
        }
        fields.push({ key: 'body_html', text: resource.body_html });
      }

      const allFieldKeys = fields.map(f => f.key);
      const existingTranslations = await prisma.translation.findMany({
        where: {
          shopId: shopRecord.id,
          resourceType,
          resourceId: resource.id.toString(),
          field: { in: allFieldKeys },
          targetLang: { in: targetLangs },
        },
      });

      const existingMap = new Map();
      for (const t of existingTranslations) {
        existingMap.set(`${t.field}:${t.targetLang}`, t);
      }

      for (const field of fields) {
        const hash = computeHash(field.text);
        for (const lang of targetLangs) {
          const mapKey = `${field.key}:${lang}`;
          const existing = existingMap.get(mapKey);

          if (existing && existing.status === 'translated' && existing.sourceHash === hash) {
            continue;
          }

          const cacheKey = `${lang}:${hash}`;
          let cachedResult = translationCache.get(cacheKey);

          if (!cachedResult) {
            try {
              cachedResult = await translate(field.text, sourceLang, lang, shopRecord.id);
              translationCache.set(cacheKey, cachedResult);
              await new Promise(r => setTimeout(r, 100));
            } catch (err) {
              job.failed++;
              console.error(`[Translate Job] Failed ${resourceType} ${resource.id} ${field.key} -> ${lang}:`, err.message);
              continue;
            }
          }

          try {
            await prisma.translation.upsert({
              where: {
                shopId_resourceType_resourceId_field_targetLang: {
                  shopId: shopRecord.id,
                  resourceType,
                  resourceId: resource.id.toString(),
                  field: field.key,
                  targetLang: lang,
                },
              },
              update: {
                sourceText: field.text,
                sourceHash: hash,
                translatedText: cachedResult.text,
                status: 'translated',
                provider,
                inputTokens: cachedResult.inputTokens || 0,
                outputTokens: cachedResult.outputTokens || 0,
                updatedAt: new Date(),
              },
              create: {
                shopId: shopRecord.id,
                resourceType,
                resourceId: resource.id.toString(),
                field: field.key,
                sourceText: field.text,
                sourceHash: hash,
                sourceLang,
                targetLang: lang,
                translatedText: cachedResult.text,
                status: 'translated',
                provider,
                inputTokens: cachedResult.inputTokens || 0,
                outputTokens: cachedResult.outputTokens || 0,
              },
            });
          } catch (dbErr) {
            job.failed++;
            console.error(`[Translate Job] DB upsert failed ${resourceType} ${resource.id} ${field.key}:`, dbErr.message);
          }
        }
      }
    }

    onProgress(totalItems, totalItems, `${type === 'products' ? '商品' : '页面'}翻译完成`);
  } catch (err) {
    job.status = 'failed';
    job.message = err.message;
    console.error('[Translate Job Error]', err);
    throw err;
  }
}

module.exports = router;
