const baiduTranslator = require('../baidu');
const openaiTranslator = require('./openai-compat');
const anthropicTranslator = require('./anthropic-compat');
const prisma = require('../../utils/db');
const { decrypt } = require('../../utils/crypto');
const config = require('../../config');

/**
 * 获取店铺的翻译引擎配置
 * @param {number} shopId
 * @returns {Promise<{provider: string, credentials: Object}>}
 */
async function getShopTranslatorConfig(shopId) {
  const setting = await prisma.shopSetting.findUnique({
    where: { shopId },
  });

  const provider = setting?.translateProvider || 'baidu';

  // AI 翻译引擎
  if (['openai-compat', 'anthropic-compat'].includes(provider) && setting?.translateApiKey) {
    const apiKey = decrypt(setting.translateApiKey);
    const apiSecret = setting.translateApiSecret ? decrypt(setting.translateApiSecret) : null;

    if (apiKey) {
      console.log(`[Translator] Shop ${shopId} using provider: ${provider}, endpoint: ${setting.translateEndpoint}, keyPrefix: ${apiKey.substring(0, 8)}...`);
      return {
        provider,
        credentials: {
          apiKey,
          apiSecret,
          model: setting.translateModel,
          endpoint: setting.translateEndpoint,
        },
      };
    }
    console.warn(`[Translator] Shop ${shopId} decrypt returned null, falling back`);
  }

  // 百度翻译：优先使用店铺自己的配置
  if (provider === 'baidu' && setting?.translateApiKey) {
    const appId = decrypt(setting.translateApiKey);
    const secretKey = setting.translateApiSecret ? decrypt(setting.translateApiSecret) : null;

    if (appId && secretKey) {
      console.log(`[Translator] Shop ${shopId} using provider: baidu (own config), appId: ${appId.substring(0, 4)}...`);
      return {
        provider: 'baidu',
        credentials: { appId, secretKey },
      };
    }
    console.warn(`[Translator] Shop ${shopId} baidu config incomplete, falling back`);
  }

  // 回退到百度翻译全局配置（兼容旧数据）
  console.log(`[Translator] Shop ${shopId} using provider: baidu (global fallback)`);
  return {
    provider: 'baidu',
    credentials: {
      appId: config.baidu.appId,
      secretKey: config.baidu.secretKey,
    },
  };
}

/**
 * 统一翻译接口
 * @param {string} text - 待翻译文本
 * @param {string} from - 源语言代码
 * @param {string} to - 目标语言代码
 * @param {number} shopId - 店铺ID
 * @returns {Promise<string>}
 */
async function translate(text, from, to, shopId) {
  const { provider, credentials } = await getShopTranslatorConfig(shopId);

  if (provider === 'openai-compat') {
    return openaiTranslator.translate(text, from, to, credentials);
  }

  if (provider === 'anthropic-compat') {
    return anthropicTranslator.translate(text, from, to, credentials);
  }

  // 默认百度翻译
  return baiduTranslator.translate(text, from, to, credentials);
}

/**
 * 统一批量翻译接口
 * @param {Array<{text:string,from:string,to:string}>} items
 * @param {number} shopId
 * @returns {Promise<string[]>}
 */
async function translateBatch(items, shopId) {
  const { provider, credentials } = await getShopTranslatorConfig(shopId);

  if (provider === 'openai-compat') {
    return openaiTranslator.translateBatch(items, credentials);
  }

  if (provider === 'anthropic-compat') {
    return anthropicTranslator.translateBatch(items, credentials);
  }

  // 默认百度翻译
  return baiduTranslator.translateBatch(items, credentials);
}

/**
 * 测试翻译引擎连通性
 * @param {string} provider - 提供商类型
 * @param {Object} credentials - 配置凭证
 * @returns {Promise<{success: boolean, message: string}>}
 */
async function testConnection(provider, credentials) {
  try {
    if (provider === 'openai-compat') {
      await openaiTranslator.translate('Hello', 'en', 'zh', credentials);
      return { success: true, message: '连接正常' };
    } else if (provider === 'anthropic-compat') {
      await anthropicTranslator.translate('Hello', 'en', 'zh', credentials);
      return { success: true, message: '连接正常' };
    } else if (provider === 'baidu') {
      await baiduTranslator.translate('Hello', 'en', 'zh', credentials);
      return { success: true, message: '连接正常' };
    }
    return { success: false, message: '未知的翻译提供商' };
  } catch (error) {
    return { success: false, message: error.message };
  }
}

module.exports = {
  translate,
  translateBatch,
  getShopTranslatorConfig,
  testConnection,
};
