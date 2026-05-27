# Coollaa Shopify 多语言翻译插件

> 版本：v2.0.0

Shopify 店铺一站式多语言解决方案，基于 Google Translate 免费网页组件，零成本、支持 100+ 种语言。

## 功能特性

- **OAuth 授权**：完整的 Shopify App 授权流程
- **前端悬浮切换器**：右下角/左下角/隐藏三种模式，下拉语言选择器
- **Google Translate 免费组件**：零成本实时翻译，支持 100+ 种语言
- **套壳自定义 UI**：隐藏 Google 默认横幅，使用品牌一致的悬浮按钮
- **RTL 支持**：阿拉伯语自动启用从右到左布局
- **语言持久化**：localStorage 记住用户选择
- **响应式适配**：PC 端和移动端自适应

## 技术栈

- 后端：Node.js + Express
- 数据库：MySQL（Prisma ORM）
- 翻译引擎：Google Translate 免费网页组件（前端实时翻译，零成本）
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
│   │   ├── shopify.js      # Shopify OAuth、店铺数据读取
│   │   ├── translate.js    # 翻译引擎配置
│   │   └── widget.js       # 前端小部件配置
│   └── services/
│       └── shopify.js      # Shopify Admin API 封装
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
- `GET /api/translate/languages` - 获取支持语言列表
- `GET /api/translate/config?shop=xxx` - 获取翻译引擎配置
- `POST /api/translate/config` - 保存翻译引擎配置

### 小部件配置
- `GET /api/widget/config?shop=xxx` - 获取配置
- `POST /api/widget/config` - 更新配置

### 调试
- `POST /api/widget/debug-auth` - 生成店主调试授权 token
- `GET /api/widget/verify-debug?shop=xxx&token=xxx` - 验证调试 token

### 前端脚本
- `GET /translator-widget.js` - 店铺语言切换器脚本

## 开发计划

- [x] 基础框架搭建 + .env 配置
- [x] Shopify OAuth 授权流程
- [x] Google Translate 免费组件集成（前端实时翻译）
- [x] 前端翻译脚本注入（ScriptTag）
- [x] 前端语言切换器 UI（悬浮组件）
- [x] 管理后台（店铺信息、设置页）
- [x] 数据库持久化（MySQL + Prisma）
- [ ] 多店铺支持

## 注意事项

1. 前端脚本通过 Shopify ScriptTag 自动注入，授权后即可生效
2. 国内用户需开启 VPN 以确保 Google Translate API 正常加载
3. 如需添加更多语言，可在管理后台设置页通过「自定义语言」扩展

## 许可证

MIT
