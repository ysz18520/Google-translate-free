const crypto = require('crypto');

/**
 * 验证 Shopify HMAC 签名
 * @param {Object} query - 请求查询参数
 * @param {string} secret - Shopify API Secret
 * @returns {boolean} - 是否验证通过
 */
function verifyShopifyHmac(query, secret) {
  const params = { ...query };
  delete params.hmac;
  delete params.signature;

  const sortedParams = Object.keys(params)
    .sort()
    .map(key => `${key}=${params[key]}`)
    .join('&');

  const computedHmac = crypto
    .createHmac('sha256', secret)
    .update(sortedParams)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(computedHmac, 'hex'),
    Buffer.from(query.hmac, 'hex')
  );
}

/**
 * 生成百度翻译 API 签名
 * @param {string} text - 待翻译文本
 * @param {string} from - 源语言
 * @param {string} to - 目标语言
 * @param {string} appId - 百度 APP ID
 * @param {string} secretKey - 百度 Secret Key
 * @returns {Object} - 请求参数
 */
function generateBaiduSign(text, from, to, appId, secretKey) {
  const salt = Date.now();
  const str = appId + text + salt + secretKey;
  const sign = crypto.createHash('md5').update(str).digest('hex');

  return {
    q: text,
    from,
    to,
    appid: appId,
    salt,
    sign,
  };
}

module.exports = {
  verifyShopifyHmac,
  generateBaiduSign,
};
