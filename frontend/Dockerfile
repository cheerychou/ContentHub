FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# 注：nginx:1.27-slim（debian slim 变体）已从 Docker Hub 下架，改用现行 stable 线的 alpine-slim 等价标签
FROM nginx:1.30-alpine-slim
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
