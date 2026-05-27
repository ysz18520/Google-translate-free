const axios = require('axios');

/**
 * 创建 Shopify Admin API 请求实例
 */
function createShopifyClient(shopDomain, accessToken, apiVersion = '2026-04') {
  const baseURL = `https://${shopDomain}/admin/api/${apiVersion}`;

  return axios.create({
    baseURL,
    headers: {
      'X-Shopify-Access-Token': accessToken,
      'Content-Type': 'application/json',
    },
  });
}

/**
 * 获取店铺信息
 */
async function getShopInfo(shopDomain, accessToken, apiVersion) {
  const client = createShopifyClient(shopDomain, accessToken, apiVersion);
  const response = await client.get('/shop.json');
  return response.data.shop;
}

/**
 * 获取商品列表
 */
async function getProducts(shopDomain, accessToken, apiVersion, params = {}) {
  const client = createShopifyClient(shopDomain, accessToken, apiVersion);
  const response = await client.get('/products.json', { params });
  return response.data.products;
}

/**
 * 获取所有商品（自动分页）
 */
async function getAllProducts(shopDomain, accessToken, apiVersion) {
  const client = createShopifyClient(shopDomain, accessToken, apiVersion);
  const products = [];
  let pageInfo = null;

  do {
    const params = { limit: 250 };
    if (pageInfo) params.page_info = pageInfo;

    const response = await client.get('/products.json', { params });
    products.push(...response.data.products.filter(p => p.status === 'active'));

    const linkHeader = response.headers.link;
    pageInfo = null;
    if (linkHeader) {
      const match = linkHeader.match(/page_info=([^>]+)>;\s*rel="next"/);
      if (match) pageInfo = match[1];
    }
  } while (pageInfo);

  return products;
}

/**
 * 获取所有页面（自动分页）
 */
async function getAllPages(shopDomain, accessToken, apiVersion) {
  const client = createShopifyClient(shopDomain, accessToken, apiVersion);
  const pages = [];
  let pageInfo = null;

  do {
    const params = { limit: 250 };
    if (pageInfo) params.page_info = pageInfo;

    const response = await client.get('/pages.json', { params });
    pages.push(...response.data.pages.filter(p => p.published_at !== null));

    const linkHeader = response.headers.link;
    pageInfo = null;
    if (linkHeader) {
      const match = linkHeader.match(/page_info=([^>]+)>;\s*rel="next"/);
      if (match) pageInfo = match[1];
    }
  } while (pageInfo);

  return pages;
}

/**
 * 获取单个商品
 */
async function getProduct(shopDomain, accessToken, apiVersion, productId) {
  const client = createShopifyClient(shopDomain, accessToken, apiVersion);
  const response = await client.get(`/products/${productId}.json`);
  return response.data.product;
}

/**
 * 获取页面列表
 */
async function getPages(shopDomain, accessToken, apiVersion, params = {}) {
  const client = createShopifyClient(shopDomain, accessToken, apiVersion);
  const response = await client.get('/pages.json', { params });
  return response.data.pages;
}

/**
 * 获取单个页面
 */
async function getPage(shopDomain, accessToken, apiVersion, pageId) {
  const client = createShopifyClient(shopDomain, accessToken, apiVersion);
  const response = await client.get(`/pages/${pageId}.json`);
  return response.data.page;
}

/**
 * 获取博客文章列表
 */
async function getArticles(shopDomain, accessToken, apiVersion, blogId, params = {}) {
  const client = createShopifyClient(shopDomain, accessToken, apiVersion);
  const response = await client.get(`/blogs/${blogId}/articles.json`, { params });
  return response.data.articles;
}

/**
 * 获取博客列表
 */
async function getBlogs(shopDomain, accessToken, apiVersion) {
  const client = createShopifyClient(shopDomain, accessToken, apiVersion);
  const response = await client.get('/blogs.json');
  return response.data.blogs;
}

/**
 * 获取主题列表
 */
async function getThemes(shopDomain, accessToken, apiVersion) {
  const client = createShopifyClient(shopDomain, accessToken, apiVersion);
  const response = await client.get('/themes.json');
  return response.data.themes;
}

/**
 * 获取当前在线主题（main theme）
 */
async function getMainTheme(shopDomain, accessToken, apiVersion) {
  const themes = await getThemes(shopDomain, accessToken, apiVersion);
  return themes.find(t => t.role === 'main') || themes[0];
}

/**
 * 获取主题指定资源文件内容
 */
async function getThemeAsset(shopDomain, accessToken, apiVersion, themeId, assetKey) {
  const client = createShopifyClient(shopDomain, accessToken, apiVersion);
  try {
    const response = await client.get(`/themes/${themeId}/assets.json`, {
      params: { 'asset[key]': assetKey },
    });
    return response.data.asset;
  } catch (error) {
    if (error.response?.status === 404) {
      return null;
    }
    throw error;
  }
}

/**
 * 获取导航菜单列表
 */
async function getLinklists(shopDomain, accessToken, apiVersion) {
  const client = createShopifyClient(shopDomain, accessToken, apiVersion);
  try {
    const response = await client.get('/linklists.json');
    return response.data.linklists || [];
  } catch (error) {
    console.warn('[ShopifyService] Failed to fetch linklists:', error.message);
    return [];
  }
}

/**
 * 注入 ScriptTag 到店铺
 */
async function createScriptTag(shopDomain, accessToken, apiVersion, scriptUrl) {
  const client = createShopifyClient(shopDomain, accessToken, apiVersion);
  const response = await client.post('/script_tags.json', {
    script_tag: {
      event: 'onload',
      src: scriptUrl,
    },
  });
  return response.data.script_tag;
}

/**
 * 获取已注入的 ScriptTag 列表
 */
async function getScriptTags(shopDomain, accessToken, apiVersion) {
  const client = createShopifyClient(shopDomain, accessToken, apiVersion);
  const response = await client.get('/script_tags.json');
  return response.data.script_tags;
}

/**
 * 删除 ScriptTag
 */
async function deleteScriptTag(shopDomain, accessToken, apiVersion, tagId) {
  const client = createShopifyClient(shopDomain, accessToken, apiVersion);
  await client.delete(`/script_tags/${tagId}.json`);
}

/**
 * 注册 Webhook
 */
async function createWebhook(shopDomain, accessToken, apiVersion, topic, address) {
  const client = createShopifyClient(shopDomain, accessToken, apiVersion);
  try {
    const response = await client.post('/webhooks.json', {
      webhook: {
        topic,
        address,
        format: 'json',
      },
    });
    return response.data.webhook;
  } catch (error) {
    // 如果 webhook 已存在，会返回 422，忽略这个错误
    if (error.response?.status === 422) {
      console.log(`[Webhook] ${topic} already exists for ${shopDomain}`);
      return null;
    }
    throw error;
  }
}

/**
 * 获取已注册的 Webhook 列表
 */
async function getWebhooks(shopDomain, accessToken, apiVersion) {
  const client = createShopifyClient(shopDomain, accessToken, apiVersion);
  const response = await client.get('/webhooks.json');
  return response.data.webhooks;
}

module.exports = {
  createShopifyClient,
  getShopInfo,
  getProducts,
  getAllProducts,
  getProduct,
  getPages,
  getAllPages,
  getPage,
  getArticles,
  getBlogs,
  getThemes,
  getMainTheme,
  getThemeAsset,
  getLinklists,
  createScriptTag,
  getScriptTags,
  deleteScriptTag,
  createWebhook,
  getWebhooks,
};
