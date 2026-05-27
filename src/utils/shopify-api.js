require('@shopify/shopify-api/adapters/node');
const { shopifyApi, LATEST_API_VERSION } = require('@shopify/shopify-api');
const config = require('../config');

// 使用内存存储 session（生产环境可改用 Redis/Prisma）
const sessionStorage = new Map();

const shopify = shopifyApi({
  apiKey: config.shopify.apiKey,
  apiSecretKey: config.shopify.apiSecret,
  scopes: config.shopify.scopes,
  hostName: new URL(config.shopify.appUrl).host,
  hostScheme: 'https',
  apiVersion: LATEST_API_VERSION,
  isCustomStoreApp: false,
  isEmbeddedApp: false,
  // 自定义 session 存储
  sessionStorage: {
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
  },
});

module.exports = { shopify, sessionStorage };
