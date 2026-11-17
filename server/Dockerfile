# PokePaper API server: Fastify + better-sqlite3, run with tsx (no build step).
FROM node:24.22.2-slim
WORKDIR /app
ENV NODE_ENV=production HUSKY=0 TZ=UTC

# Install only the server workspace's production dependencies (plus the
# linked shared workspace), not the Angular app's. --ignore-scripts skips the
# root "prepare" (husky). better-sqlite3 ships prebuilt bindings, so no
# compile step is needed.
COPY package.json package-lock.json ./
COPY shared ./shared
COPY server/package.json ./server/package.json
RUN npm ci --omit=dev --ignore-scripts --workspace @pokepaper/server \
  && npm cache clean --force

COPY server/src ./server/src

# Runs as the unprivileged `node` user (uid 1000). The data and backup
# directories are bind mounts on the NAS: they must be writable by uid 1000
# (see docs/nas-deployment.md).
RUN mkdir -p /app/server/data /app/server/backups \
  && chown -R node:node /app/server/data /app/server/backups
USER node

WORKDIR /app/server
EXPOSE 3000
CMD ["node", "--import", "tsx", "src/index.ts"]
