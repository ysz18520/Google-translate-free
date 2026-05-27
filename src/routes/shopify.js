const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const config = require('../config');
const shopifyService = require('../services/shopify');
const prisma = require('../utils/db');
const { shopify } = require('../utils/shopify-api');

const router = express.Router();

/**
 * @route GET /api/shopify/auth
 * @desc 发起 Shopify OAuth 授权（使用官方 SDK，强制离线令牌）
 */
router.get('/auth', async (req, res) => {
  const { shop } = req.query;

  if (!shop) {
    return res.status(400).json({ error: 'Missing shop parameter' });
  }

  const shopDomain = shop.toLowerCase().trim();
  if (!shopDomain.endsWith('.myshopify.com')) {
    return res.status(400).json({ error: 'Invalid shop domain' });
  }

  try {
    // 使用官方 SDK 生成授权 URL，isOnline: false 确保获取 shpat_ 离线令牌
    const authUrl = await shopify.auth.begin({
      shop: shopDomain,
      callbackPath: '/api/shopify/callback',
      isOnline: false,
      rawRequest: req,
      rawResponse: res,
    });

    // 非 embedded app 下，begin 返回 URL，需要手动 redirect
    if (authUrl) {
      return res.redirect(authUrl);
    }
  } catch (error) {
    console.error('[OAuth] Auth begin failed:', error.message);
    res.status(500).json({ error: 'Failed to initiate OAuth', details: error.message });
  }
});

/**
 * @route GET /api/shopify/callback
 * @desc 处理 Shopify OAuth 回调（使用官方 SDK）
 */
router.get('/callback', async (req, res) => {
  try {
    // 使用官方 SDK 处理回调，获取 session（包含 accessToken）
    const callbackResponse = await shopify.auth.callback({
      rawRequest: req,
      rawResponse: res,
      isOnline: false,
    });

    const session = callbackResponse.session;
    if (!session || !session.accessToken) {
      console.error('[OAuth] No session or access token returned by SDK');
      return res.status(500).json({ error: 'OAuth callback failed: no session' });
    }

    const { shop, accessToken } = session;
    const tokenType = accessToken.startsWith('shpat_') ? 'offline' : accessToken.startsWith('shpua_') ? 'online' : 'unknown';
    console.log(`[OAuth] Token received via SDK, type: ${tokenType}, prefix: ${accessToken.substring(0, 10)}..., length: ${accessToken.length}`);

    // 验证 token 是否真的能调用 Shopify Admin API（不校验前缀，直接试）
    let testShopInfo;
    try {
      const testResponse = await axios.get(`https://${shop}/admin/api/${config.shopify.apiVersion}/shop.json`, {
        headers: { 'X-Shopify-Access-Token': accessToken },
      });
      testShopInfo = testResponse.data.shop;
      console.log(`[OAuth] Token validation passed: ${testShopInfo?.name} (type: ${tokenType})`);
    } catch (validationErr) {
      console.error(`[OAuth] Token validation FAILED! Status: ${validationErr.response?.status}, Error: ${validationErr.response?.data?.errors || validationErr.message}`);
      return res.status(500).json({
        error: 'Token validation failed',
        details: `The access token is invalid or cannot call Admin API. Token type: ${tokenType}`,
        shopifyError: validationErr.response?.data?.errors,
      });
    }

    // 获取店铺信息
    const shopInfo = await shopifyService.getShopInfo(
      shop,
      accessToken,
      config.shopify.apiVersion
    );

    // 保存或更新店铺信息到数据库
    const shopData = await prisma.shop.upsert({
      where: { shopDomain: shop },
      update: {
        accessToken: accessToken,
        scope: config.shopify.scopes.join(','),
        email: shopInfo.email,
        name: shopInfo.name,
        plan: shopInfo.plan_name,
        isActive: true,
        updatedAt: new Date(),
      },
      create: {
        shopDomain: shop,
        accessToken: accessToken,
        scope: config.shopify.scopes.join(','),
        email: shopInfo.email,
        name: shopInfo.name,
        plan: shopInfo.plan_name,
      },
    });

    // 创建设置记录（如果不存在）
    await prisma.shopSetting.upsert({
      where: { shopId: shopData.id },
      update: {},
      create: {
        shopId: shopData.id,
        widgetPosition: config.widget.position,
        widgetColor: '#1976d2',
        activeLanguages: 'en,es,fr,ara,zh',
      },
    });

    console.log(`[OAuth] Shop authorized: ${shop} (${shopInfo.name})`);

    // 注入前端翻译脚本
    const appUrl = config.shopify.appUrl || '';
    const baseUrl = appUrl.replace(/\/translator\/?$/, '').replace(/\/$/, '');
    const widgetVersion = config.widget?.version || Date.now();
    const widgetScriptUrl = `${baseUrl}/translator-widget.js?v=${widgetVersion}`;
    try {
      const existingTags = await shopifyService.getScriptTags(
        shop, accessToken, config.shopify.apiVersion
      );

      // 删除旧版本的 ScriptTag
      for (const tag of existingTags) {
        if (tag.src && tag.src.includes('/translator-widget.js') && tag.src !== widgetScriptUrl) {
          try {
            await shopifyService.deleteScriptTag(
              shop, accessToken, config.shopify.apiVersion, tag.id
            );
            console.log(`[ScriptTag] Removed old widget script ${tag.src} for ${shop}`);
          } catch (e) {
            console.warn(`[ScriptTag] Failed to remove old script for ${shop}:`, e.message);
          }
        }
      }

      const alreadyInjected = existingTags.some(tag => tag.src === widgetScriptUrl);
      if (!alreadyInjected) {
        await shopifyService.createScriptTag(
          shop, accessToken, config.shopify.apiVersion, widgetScriptUrl
        );
        console.log(`[ScriptTag] Injected widget script ${widgetScriptUrl} for ${shop}`);
      }
    } catch (err) {
      console.error(`[ScriptTag] Failed to inject for ${shop}:`, err.message);
    }

    // 注册 Webhook
    const webhookAddress = `${config.shopify.appUrl.replace(/\/translator$/, '')}/api/shopify/webhook`;
    const webhookTopics = [
      'products/update',
      'products/delete',
      'pages/update',
      'pages/delete',
      'articles/update',
      'themes/update',
    ];

    for (const topic of webhookTopics) {
      try {
        await shopifyService.createWebhook(
          shop, accessToken, config.shopify.apiVersion, topic, webhookAddress
        );
        console.log(`[Webhook] Registered ${topic} for ${shop}`);
      } catch (err) {
        console.error(`[Webhook] Failed to register ${topic} for ${shop}:`, err.message);
      }
    }

    // 重定向到管理页面
    res.redirect(`${config.shopify.appUrl}?shop=${shop}`);

  } catch (error) {
    console.error('[OAuth Callback Error]', error.message, error.stack);
    res.status(500).json({ error: 'OAuth failed', details: error.message });
  }
});

/**
 * @route POST /api/shopify/webhook
 * @desc 接收 Shopify Webhook 推送
 */
router.post('/webhook', async (req, res) => {
  // Shopify 要求立即返回 200，否则认为失败
  res.status(200).send('OK');

  const topic = req.headers['x-shopify-topic'];
  const shopDomain = req.headers['x-shopify-shop-domain'];

  if (!topic || !shopDomain) {
    console.warn('[Webhook] Missing topic or shop domain');
    return;
  }

  console.log(`[Webhook] Received ${topic} from ${shopDomain}`);

  try {
    // 查找店铺
    const shop = await prisma.shop.findUnique({
      where: { shopDomain },
    });

    if (!shop) {
      console.warn(`[Webhook] Shop not found: ${shopDomain}`);
      return;
    }

    // 记录 webhook 日志
    await prisma.webhookLog.create({
      data: {
        shopId: shop.id,
        topic,
        resourceId: req.body.id?.toString(),
        payload: JSON.stringify(req.body).slice(0, 5000),
      },
    });

    // 处理不同 topic
    switch (topic) {
      case 'products/update': {
        const productId = req.body.id?.toString();
        if (productId) {
          const content = `${req.body.title || ''}_${req.body.body_html || ''}`;
          const newHash = crypto.createHash('md5').update(content).digest('hex');

          await prisma.translation.updateMany({
            where: {
              shopId: shop.id,
              resourceType: 'product',
              resourceId: productId,
              NOT: { sourceHash: newHash },
            },
            data: { status: 'outdated' },
          });

          console.log(`[Webhook] Marked product ${productId} translations as outdated`);
        }
        break;
      }

      case 'products/delete': {
        const deletedProductId = req.body.id?.toString();
        if (deletedProductId) {
          const result = await prisma.translation.deleteMany({
            where: {
              shopId: shop.id,
              resourceType: 'product',
              resourceId: deletedProductId,
            },
          });
          console.log(`[Webhook] Deleted ${result.count} translations for removed product ${deletedProductId}`);
        }
        break;
      }

      case 'pages/update': {
        const pageId = req.body.id?.toString();
        if (pageId) {
          const content = `${req.body.title || ''}_${req.body.body_html || ''}`;
          const newHash = crypto.createHash('md5').update(content).digest('hex');

          await prisma.translation.updateMany({
            where: {
              shopId: shop.id,
              resourceType: 'page',
              resourceId: pageId,
              NOT: { sourceHash: newHash },
            },
            data: { status: 'outdated' },
          });

          console.log(`[Webhook] Marked page ${pageId} translations as outdated`);
        }
        break;
      }

      case 'pages/delete': {
        const deletedPageId = req.body.id?.toString();
        if (deletedPageId) {
          const result = await prisma.translation.deleteMany({
            where: {
              shopId: shop.id,
              resourceType: 'page',
              resourceId: deletedPageId,
            },
          });
          console.log(`[Webhook] Deleted ${result.count} translations for removed page ${deletedPageId}`);
        }
        break;
      }

      case 'themes/update': {
        await prisma.translation.updateMany({
          where: {
            shopId: shop.id,
          },
          data: { status: 'outdated' },
        });

        console.log(`[Webhook] Theme updated, marked all translations as outdated for ${shopDomain}`);
        break;
      }

      default:
        console.log(`[Webhook] Unhandled topic: ${topic}`);
    }
  } catch (error) {
    console.error('[Webhook Processing Error]', error.message);
  }
});

/**
 * @route GET /api/shopify/shop
 * @desc 获取当前店铺信息
 */
router.get('/shop', async (req, res) => {
  const { shop } = req.query;

  if (!shop) {
    return res.status(400).json({ error: 'Missing shop parameter' });
  }

  try {
    const shopData = await prisma.shop.findUnique({
      where: { shopDomain: shop },
    });

    if (!shopData) {
      return res.status(401).json({ error: 'Shop not authorized' });
    }

    res.json({
      shopDomain: shopData.shopDomain,
      name: shopData.name,
      email: shopData.email,
      plan: shopData.plan,
      scope: shopData.scope,
      isActive: shopData.isActive,
    });
  } catch (error) {
    console.error('[Get Shop Error]', error.message);
    res.status(500).json({ error: 'Failed to fetch shop info' });
  }
});

/**
 * @route GET /api/shopify/products
 * @desc 获取店铺商品列表
 */
router.get('/products', async (req, res) => {
  const { shop, limit = 50, page_info } = req.query;

  if (!shop) {
    return res.status(400).json({ error: 'Missing shop parameter' });
  }

  try {
    const shopData = await prisma.shop.findUnique({
      where: { shopDomain: shop },
    });

    if (!shopData) {
      return res.status(401).json({ error: 'Shop not authorized' });
    }

    const params = { limit: Math.min(parseInt(limit), 250) };
    if (page_info) params.page_info = page_info;

    const products = await shopifyService.getProducts(
      shopData.shopDomain,
      shopData.accessToken,
      config.shopify.apiVersion,
      params
    );

    res.json({ products });
  } catch (error) {
    console.error('[Get Products Error]', error.message);
    res.status(500).json({ error: 'Failed to fetch products', details: error.message });
  }
});

/**
 * @route GET /api/shopify/pages
 * @desc 获取店铺页面列表
 */
router.get('/pages', async (req, res) => {
  const { shop, limit = 50 } = req.query;

  if (!shop) {
    return res.status(400).json({ error: 'Missing shop parameter' });
  }

  try {
    const shopData = await prisma.shop.findUnique({
      where: { shopDomain: shop },
    });

    if (!shopData) {
      return res.status(401).json({ error: 'Shop not authorized' });
    }

    const pages = await shopifyService.getPages(
      shopData.shopDomain,
      shopData.accessToken,
      config.shopify.apiVersion,
      { limit: Math.min(parseInt(limit), 250) }
    );

    res.json({ pages });
  } catch (error) {
    console.error('[Get Pages Error]', error.message);
    res.status(500).json({ error: 'Failed to fetch pages', details: error.message });
  }
});

module.exports = router;
