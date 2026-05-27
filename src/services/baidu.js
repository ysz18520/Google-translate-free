const axios = require('axios');
const { generateBaiduSign } = require('../utils/hmac');
const config = require('../config');

const BAIDU_API_URL = 'https://fanyi-api.baidu.com/api/trans/vip/translate';

// 百度翻译错误码映射
const BAIDU_ERROR_MAP = {
  52001: '请求超时，请重试',
  52002: '百度翻译系统错误，请稍后重试',
  52003: 'App ID 未授权，请检查 App ID 是否正确',
  54000: '必填参数为空',
  54001: '签名错误，请检查 Secret Key 是否正确',
  54003: '访问频率受限，请降低请求频率',
  54004: '账户余额不足（额度已用完），请前往百度翻译开放平台充值',
  54005: '长文本请求频繁，请缩短单次请求文本',
  58000: '客户端 IP 非法',
  58001: '译文语言方向不支持',
  58002: '百度翻译服务当前已关闭',
  90107: '认证未通过或未生效，请检查账户状态',
};

// 百度语言代码映射
const BAIDU_LANG_MAP = {
  en: 'en',
  es: 'spa',
  fr: 'fra',
  ara: 'ara',
  zh: 'zh',
};

/**
 * 调用百度翻译 API
 * @param {string} text - 待翻译文本
 * @param {string} from - 源语言代码
 * @param {string} to - 目标语言代码
 * @returns {Promise<string>} - 翻译结果
 */
async function translate(text, from = 'en', to = 'zh', credentials) {
  if (!text || !text.trim()) {
    return '';
  }

  const appId = credentials?.appId || config.baidu.appId;
  const secretKey = credentials?.secretKey || config.baidu.secretKey;

  if (!appId || !secretKey) {
    throw Object.assign(new Error('百度翻译需要先配置 App ID 和 Secret Key'), { code: 'BAIDU_NOT_CONFIGURED' });
  }

  const baiduFrom = BAIDU_LANG_MAP[from] || from;
  const baiduTo = BAIDU_LANG_MAP[to] || to;

  const params = generateBaiduSign(
    text,
    baiduFrom,
    baiduTo,
    appId,
    secretKey
  );

  try {
    const response = await axios.get(BAIDU_API_URL, { params });

    if (response.data.error_code) {
      const code = response.data.error_code;
      const friendly = BAIDU_ERROR_MAP[code] || response.data.error_msg || `百度翻译错误 (代码: ${code})`;
      throw Object.assign(new Error(friendly), { code: `BAIDU_${code}` });
    }

    if (response.data.trans_result && response.data.trans_result.length > 0) {
      const translated = response.data.trans_result.map(r => r.dst).join('\n');
      return { text: translated, inputTokens: 0, outputTokens: 0 };
    }

    return { text, inputTokens: 0, outputTokens: 0 };
  } catch (error) {
    console.error('[Baidu Translate Error]', error.message);
    throw error;
  }
}

/**
 * 批量翻译（分批处理，避免过长文本）
 * @param {Array<{text:string,from:string,to:string}>} items
 * @returns {Promise<string[]>}
 */
async function translateBatch(items, credentials) {
  const results = [];
  for (const item of items) {
    try {
      const result = await translate(item.text, item.from, item.to, credentials);
      results.push(result);
      // 简单限流，避免触发 QPS 限制
      await new Promise(r => setTimeout(r, 100));
    } catch (err) {
      results.push({ text: item.text, inputTokens: 0, outputTokens: 0 }); // 失败时返回原文
    }
  }
  return results;
}

module.exports = {
  translate,
  translateBatch,
  BAIDU_LANG_MAP,
};
