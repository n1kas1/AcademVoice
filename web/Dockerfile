# Multi-stage: node собирает Vite-статику, итог кладём в caddy-образ.
# Этот image запускается отдельным сервисом, который и торчит наружу 80/443.

FROM node:20-alpine AS build
WORKDIR /app

COPY package.json ./
COPY package-lock.json* ./
RUN npm install --no-audit --no-fund

COPY . .
RUN npm run build

FROM caddy:2-alpine
COPY --from=build /app/dist /srv
COPY Caddyfile /etc/caddy/Caddyfile
