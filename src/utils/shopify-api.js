require('@shopify/shopify-api/adapters/node');
const { shopifyApi, LATEST_API_VERSION } = require('@shopify/shopify-api');
const config = require('../config');

// 使用内存存储 session（生产环境可改用 Redis/Prisma）
const sessionStorage = new Map();

// 创建 session 存储适配器
function createSessionStorage() {
  return {
    storeSession: async (session) => {
      sessionStorage.set(session.id, session);
      return true;
    },
    loadSession: async (id) => {
      return sessionStorage.get(id) || undefined;
    },
    deleteSession: async (id) => {
      sessionStorage.delete(id);
      return true;
    },
    findSessionsByShop: async (shop) => {
      const sessions = [];
      for (const session of sessionStorage.values()) {
        if (session.shop === shop) sessions.push(session);
      }
      return sessions;
    },
  };
}

/**
 * 根据 apiKey 和 apiSecret 创建 Shopify SDK 实例
 * 支持多 Custom App 凭证
 */
function createShopify(apiKey, apiSecret) {
  return shopifyApi({
    apiKey,
    apiSecretKey: apiSecret,
    scopes: config.shopify.scopes,
    hostName: new URL(config.shopify.appUrl).host,
    hostScheme: 'https',
    apiVersion: LATEST_API_VERSION,
    isCustomStoreApp: false,
    isEmbeddedApp: false,
    sessionStorage: createSessionStorage(),
  });
}

// 全局默认实例（向后兼容：使用环境变量中的全局凭证）
const shopify = createShopify(config.shopify.apiKey, config.shopify.apiSecret);

module.exports = { shopify, createShopify, sessionStorage };
