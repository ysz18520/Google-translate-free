# 构建阶段
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npx prisma generate

# 生产阶段
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

# 安装 Prisma 所需的 OpenSSL
RUN apk add --no-cache openssl

COPY package*.json ./
RUN npm install --omit=dev

COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/src ./src
COPY --from=builder /app/public ./public
COPY --from=builder /app/.env ./

EXPOSE 3001

CMD ["node", "src/server.js"]
