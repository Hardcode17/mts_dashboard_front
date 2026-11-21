FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_OIDC_AUTHORITY
ENV VITE_BACKEND_MODE=real
RUN npm run lint && npm run build

FROM node:24-alpine AS stand-browser
RUN apk add --no-cache chromium
ENV CHROMIUM_PATH=/usr/bin/chromium
WORKDIR /check
COPY --from=build /app/node_modules/playwright-core ./node_modules/playwright-core
COPY tests/stand-login-smoke.mjs .
USER node
CMD ["node", "stand-login-smoke.mjs"]

FROM node:24-alpine AS production
WORKDIR /app
ENV NODE_ENV=production
ENV NO_UPDATE_NOTIFIER=1
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY server ./server
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/start.mjs"]
