const axios = require('axios');

async function translate(text, from, to, credentials) {
  if (!text || !text.trim()) return '';
  const { apiKey, model, endpoint } = credentials;
  if (!apiKey || !endpoint) {
    throw new Error('OpenAI-compat translator requires apiKey and endpoint');
  }

  const prompt = `You are a professional e-commerce translator. Translate the following text from ${from} to ${to}.\nTranslate ALL content including product names, brand names, collection names, and model names. Do not leave any words in the original language.\nPreserve HTML tags if present. Output only the translated text, no explanations.\n\nText: ${text}`;

  try {
    const response = await axios.post(
      `${endpoint}/chat/completions`,
      {
        model: model || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are a professional e-commerce translator. Translate ALL content including names and brands. Output only the translated text.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 2048,
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 60000,
      }
    );

    if (response.data.choices && response.data.choices.length > 0 && response.data.choices[0].message && response.data.choices[0].message.content) {
      const text = response.data.choices[0].message.content.trim();
      const inputTokens = response.data.usage?.prompt_tokens || 0;
      const outputTokens = response.data.usage?.completion_tokens || 0;
      return { text, inputTokens, outputTokens };
    }
    throw new Error(`Unexpected response format: ${JSON.stringify(response.data).substring(0, 200)}`);
  } catch (error) {
    const status = error.response?.status;
    const errData = error.response?.data?.error;
    let message = errData?.message || error.message;

    if (status === 401) {
      message = 'API Key 无效或已过期，请检查密钥是否正确';
    } else if (status === 402 || message?.includes('insufficient_quota') || message?.includes('balance')) {
      message = 'API 账户余额不足，请前往对应平台充值';
    } else if (status === 429) {
      message = '请求过于频繁或超出配额限制，请稍后再试';
    } else if (status >= 500) {
      message = 'AI 服务商内部错误，请稍后重试';
    }

    console.error('[OpenAI-Compat Translate Error]', status, errData || error.message);
    throw Object.assign(new Error(message), { code: `OPENAI_${status || 'ERROR'}` });
  }
}

async function translateBatch(items, credentials, concurrency = 5) {
  const results = new Array(items.length);

  async function processChunk(start) {
    const end = Math.min(start + concurrency, items.length);
    const promises = [];
    for (let i = start; i < end; i++) {
      promises.push(
        translate(items[i].text, items[i].from, items[i].to, credentials)
          .then(r => { results[i] = r; })
          .catch(err => {
            console.warn('[OpenAI-Compat Batch] Single item failed:', err.message);
            results[i] = { text: items[i].text, inputTokens: 0, outputTokens: 0 };
          })
      );
    }
    await Promise.all(promises);
    if (end < items.length) {
      await new Promise(r => setTimeout(r, 100));
    }
  }

  for (let i = 0; i < items.length; i += concurrency) {
    await processChunk(i);
  }
  return results;
}

module.exports = { translate, translateBatch };
