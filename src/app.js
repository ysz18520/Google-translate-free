const express = require('express');
const cors = require('cors');
const path = require('path');
const config = require('./config');

const shopifyRoutes = require('./routes/shopify');
const translateRoutes = require('./routes/translate');
const widgetRoutes = require('./routes/widget');

const app = express();

app.use(cors({
  origin: true,
  credentials: true,
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// API 路由
app.use('/api/shopify', shopifyRoutes);
app.use('/api/translate', translateRoutes);
app.use('/api/widget', widgetRoutes);

// 前端管理页面静态文件
app.use('/translator', express.static(path.join(__dirname, '../public/translator')));
app.get('/translator/*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/translator/index.html'));
});

// 店铺前端脚本（通过 ScriptTag 注入）
app.get('/translator-widget.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, '../public/widget.js'));
});

// 健康检查
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

// 错误处理
app.use((err, req, res, next) => {
  console.error('[Error]', err);
  res.status(500).json({ error: err.message || 'Internal Server Error' });
});

module.exports = app;
