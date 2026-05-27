# Coollaa Shopify 多语言翻译插件

> 版本：v1.2.1

Shopify 店铺一站式多语言解决方案，支持英语、西班牙语、法语、阿拉伯语、中文。

## 功能特性

- **OAuth 授权**：完整的 Shopify App 授权流程，HMAC 签名校验
- **前端悬浮切换器**：右下角/左下角固定悬浮，支持品牌图标，下拉选择器
- **动态文本替换**：切换语言时不保留原文，直接替换页面文本
- **批量翻译**：支持商品、页面、博客批量翻译
- **翻译缓存**：减少 API 调用，降低成本
- **RTL 支持**：阿拉伯语自动启用从右到左布局
- **响应式适配**：PC 端和移动端自适应

## 技术栈

- 后端：Node.js + Express
- 数据库：MySQL（Prisma ORM）
- 翻译 API：百度翻译 API
- 前端：纯 HTML/CSS/JS（管理后台）+ 注入脚本（店铺前端）

## 项目结构

```
shopify插件开发/
├── .env                    # 环境变量（不要提交到 Git）
├── .env.example            # 环境变量模板
├── package.json
├── prisma/
│   └── schema.prisma       # 数据库模型
├── src/
│   ├── server.js           # 服务入口
│   ├── app.js              # Express 应用配置
│   ├── config/
│   │   └── index.js        # 配置读取
│   ├── routes/
│   │   ├── shopify.js      # Shopify OAuth、商品/页面读取
│   │   ├── translate.js    # 翻译 API
│   │   └── widget.js       # 前端小部件配置
│   ├── services/
│   │   ├── baidu.js        # 百度翻译 API 封装
│   │   └── shopify.js      # Shopify Admin API 封装
│   └── utils/
│       └── hmac.js         # HMAC 签名校验
└── public/
    ├── widget.js           # 店铺前端语言切换器脚本
    └── translator/
        └── index.html      # 管理后台页面
```

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env 填入你的凭证
```

### 3. 初始化数据库

```bash
npx prisma db push
```

### 4. 启动服务

```bash
# 开发模式
npm run dev

# 生产模式
npm start
```

服务默认运行在 `http://localhost:3001`

## 部署指南

### 服务器配置

服务器：`107.172.230.133`
部署目录：`/shanzhao/translator`

### 使用 PM2 部署

```bash
# 安装 PM2
npm install -g pm2

# 启动应用
cd /shanzhao/translator
pm2 start src/server.js --name translator-app

# 保存配置
pm2 save
pm2 startup
```

### Nginx 配置

在现有 Nginx 配置中添加路径反代：

```nginx
# /translator 路径反代到新插件
location /translator {
    proxy_pass http://localhost:3001;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_cache_bypass $http_upgrade;
}

# API 路径反代
location /api/ {
    proxy_pass http://localhost:3001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

### Shopify App 配置

1. 登录 [Shopify Partners](https://partners.shopify.com)
2. 进入你的 App 设置
3. 配置以下地址：
   - **App URL**: `https://admin.coollaa.com/translator`
   - **Allowed redirection URL(s)**: `https://admin.coollaa.com/api/shopify/callback`
4. 确保已申请以下权限：
   - `read_products`
   - `read_content`
   - `write_script_tags`
   - `read_script_tags`

## API 端点

### Shopify 授权
- `GET /api/shopify/auth?shop=xxx.myshopify.com` - 发起授权
- `GET /api/shopify/callback` - 授权回调
- `GET /api/shopify/shop?shop=xxx` - 获取店铺信息
- `GET /api/shopify/products?shop=xxx` - 获取商品列表
- `GET /api/shopify/pages?shop=xxx` - 获取页面列表

### 翻译
- `POST /api/translate/text` - 单文本翻译
- `POST /api/translate/batch` - 批量翻译
- `GET /api/translate/languages` - 获取支持语言
- `POST /api/translate/product` - 翻译商品

### 小部件配置
- `GET /api/widget/config?shop=xxx` - 获取配置
- `POST /api/widget/config` - 更新配置
- `GET /api/widget/translations?shop=xxx&locale=xx` - 获取翻译内容

### 前端脚本
- `GET /translator-widget.js` - 店铺语言切换器脚本

## 开发计划

- [x] 基础框架搭建 + .env 配置
- [x] Shopify OAuth 授权流程
- [x] 百度翻译 API 对接
- [x] 读取店铺商品列表并批量翻译
- [x] 前端翻译脚本注入（ScriptTag）
- [x] 前端语言切换器 UI（悬浮组件）
- [ ] 管理页面完善（用量统计、缓存管理）
- [ ] 数据库持久化（当前使用内存存储）
- [ ] 翻译结果写回 Shopify

## 注意事项

1. 当前店铺信息存储在内存中，重启服务会丢失，生产环境请接入 MySQL
2. 百度翻译 API 有 QPS 限制，批量翻译会自动限流
3. 前端脚本通过 Shopify ScriptTag 自动注入，授权后即可生效

## 许可证

MIT
