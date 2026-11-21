FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run lint && npm run build

FROM node:24-alpine AS production
WORKDIR /app
ENV NODE_ENV=production
ENV NO_UPDATE_NOTIFIER=1
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY mock ./mock
COPY src/demoData.ts ./src/demoData.ts
COPY src/agentDemo.ts ./src/agentDemo.ts
COPY src/desk/types.ts src/desk/recovery.ts ./src/desk/
RUN mkdir -p .mcc-stand && chown node:node .mcc-stand
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "mock/start.mjs"]
