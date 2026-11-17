# --- Stage 1: build the web app ---
FROM node:24.22.2-slim AS builder
WORKDIR /app
ENV HUSKY=0

# Only the root app and the shared workspace are needed for ng build; the
# server workspace's runtime dependencies are skipped.
COPY package.json package-lock.json ./
COPY shared ./shared
COPY server/package.json ./server/package.json
RUN npm ci --ignore-scripts --include-workspace-root --workspace @pokepaper/shared

COPY angular.json tsconfig.json tsconfig.app.json ionic.config.json ngsw-config.json .browserslistrc ./
COPY public ./public
COPY src ./src
RUN npm run build

# --- Stage 2: Caddy serving the app and proxying the API ---
FROM caddy:2.11-alpine
ENV TZ=UTC

COPY edge/Caddyfile /etc/caddy/Caddyfile
COPY edge/well-known /srv-well-known
# Fail the image build (CI builds this without pushing) rather than ship a
# Caddyfile that crash-loops the container on the NAS.
RUN caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
COPY --from=builder /app/www /srv

EXPOSE 8080
