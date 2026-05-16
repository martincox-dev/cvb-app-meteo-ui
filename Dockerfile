FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true npm ci
COPY . .
RUN npm run build

FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
# Chromium desde apt (evita depender de descarga de Google en build)
RUN apt-get update && apt-get install -y \
    chromium \
    --no-install-recommends && rm -rf /var/lib/apt/lists/*
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
COPY package*.json ./
RUN PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
EXPOSE 3001
CMD ["node", "server/runtime.mjs"]
