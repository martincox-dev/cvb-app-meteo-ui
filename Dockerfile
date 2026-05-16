FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
# Chromium + deps para whatsapp-web.js (Puppeteer)
RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
COPY package*.json ./
RUN PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
EXPOSE 3001
CMD ["node", "server/runtime.mjs"]
