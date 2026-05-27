const config = require('./config');
const app = require('./app');

const PORT = config.port;

app.listen(PORT, () => {
  console.log(`[Shopify Translator] Server running on port ${PORT}`);
  console.log(`[Shopify Translator] Environment: ${config.nodeEnv}`);
  console.log(`[Shopify Translator] App URL: ${config.shopify.appUrl}`);
});
