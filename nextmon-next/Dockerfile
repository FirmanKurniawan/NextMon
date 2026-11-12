FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:24-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run gen && npm run build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NEXTMON_DATA=/data
RUN mkdir -p /data && chown -R node:node /app /data
COPY --from=builder --chown=node:node /app/.next/standalone ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --retries=5 --start-period=15s \
  CMD node -e "const http=require('node:http');const h=process.env.NEXTMON_BASE_URL?new URL(process.env.NEXTMON_BASE_URL).host:'127.0.0.1:3000';http.get({hostname:'127.0.0.1',port:Number(process.env.PORT||3000),path:'/api/health',headers:{Host:h}},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
CMD ["node", "server.js"]
