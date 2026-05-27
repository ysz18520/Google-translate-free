require('dotenv').config();

module.exports = {
  port: process.env.PORT || 3001,
  nodeEnv: process.env.NODE_ENV || 'development',

  shopify: {
    apiKey: process.env.SHOPIFY_API_KEY,
    apiSecret: process.env.SHOPIFY_API_SECRET,
    appUrl: process.env.SHOPIFY_APP_URL,
    redirectUri: process.env.SHOPIFY_REDIRECT_URI,
    apiVersion: process.env.SHOPIFY_API_VERSION || '2026-04',
    scopes: [
      'read_products',
      'read_content',
      'read_themes',
      'read_script_tags',
      'write_script_tags',
    ],
  },

  session: {
    secret: process.env.SESSION_SECRET || 'default-secret-change-me',
  },

  widget: {
    position: process.env.WIDGET_POSITION || 'bottom-right',
    version: process.env.WIDGET_VERSION || require('../../package.json').version,
  },
};
