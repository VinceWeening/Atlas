# Bouwt de Atlas-server met het webscherm erin, voor ZimaOS.
FROM node:22-alpine AS bouw
WORKDIR /app
COPY package.json package-lock.json ./
COPY web/package.json web/
COPY server/package.json server/
RUN npm ci
COPY web web
COPY server server
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8790 WEB_DIR=/app/web/dist DATA_DIR=/app/data
COPY package.json package-lock.json ./
COPY web/package.json web/
COPY server/package.json server/
RUN npm ci --omit=dev --workspace server && npm cache clean --force
COPY --from=bouw /app/server/dist server/dist
COPY --from=bouw /app/web/dist web/dist
# Koppelingen en instellingen; in compose een eigen volume zodat ze updates overleven.
RUN mkdir -p /app/data && chown node:node /app/data
ARG ATLAS_VERSION=dev
ENV ATLAS_VERSION=$ATLAS_VERSION
EXPOSE 8790
USER node
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8790/api/health || exit 1
CMD ["node", "server/dist/index.js"]
