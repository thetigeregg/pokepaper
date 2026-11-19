# Image whose iOS OTA bundles (/srv-ota) are carried forward when this build
# doesn't make a new one: CI passes the current pokepaper-edge:main, so a
# release without web changes keeps serving the last bundle instead of
# withdrawing it (go-gather once shipped an empty OTA dir that way). The
# default has none.
ARG OTA_PREVIOUS_IMAGE=caddy:2.11-alpine
FROM ${OTA_PREVIOUS_IMAGE} AS ota-previous

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

# --- Stage 2: iOS OTA bundle (docs/ios.md -> OTA updates) ---
# BUILD_IOS_OTA=true builds a fresh signed bundle for the installed TestFlight
# build (only that build's directory is kept: older builds' devices need a
# TestFlight update anyway). Otherwise the previous image's bundles are
# carried forward unchanged. The signing key and origin arrive as BuildKit
# secrets, never as build args or layers.
FROM builder AS ota
RUN apt-get update && apt-get install -y --no-install-recommends zip \
  && rm -rf /var/lib/apt/lists/*
COPY scripts/ios-live-update-common.mjs scripts/build-ios-live-update-artifacts.mjs \
  scripts/write-environment-ios.mjs scripts/lan-host.mjs scripts/sync-ios-version.mjs ./scripts/
ARG BUILD_IOS_OTA=false
ARG IOS_OTA_NATIVE_BUILD_NUMBER=
RUN --mount=type=secret,id=IOS_LIVE_UPDATE_PRIVATE_KEY,required=false \
    --mount=type=secret,id=IOS_BACKEND_ORIGIN_PROD,required=false \
    --mount=type=bind,from=ota-previous,target=/ota-previous \
    set -eu; \
    mkdir -p /ota/ios; \
    if [ "$BUILD_IOS_OTA" = "true" ]; then \
      test -s /run/secrets/IOS_LIVE_UPDATE_PRIVATE_KEY || { echo "IOS_LIVE_UPDATE_PRIVATE_KEY secret required" >&2; exit 1; }; \
      test -s /run/secrets/IOS_BACKEND_ORIGIN_PROD || { echo "IOS_BACKEND_ORIGIN_PROD secret required" >&2; exit 1; }; \
      IOS_BACKEND_ORIGIN_PROD="$(tr -d '\r\n' < /run/secrets/IOS_BACKEND_ORIGIN_PROD)" \
      IOS_LIVE_UPDATE_PRIVATE_KEY_PATH=/run/secrets/IOS_LIVE_UPDATE_PRIVATE_KEY \
      IOS_OTA_NATIVE_BUILD_NUMBER="$IOS_OTA_NATIVE_BUILD_NUMBER" \
        node scripts/build-ios-live-update-artifacts.mjs --output-root /ota/ios; \
    elif [ -d /ota-previous/srv-ota/ios ]; then \
      cp -a /ota-previous/srv-ota/ios/. /ota/ios/; \
    fi

# --- Stage 3: Caddy serving the app and proxying the API ---
FROM caddy:2.11-alpine
ENV TZ=UTC

COPY edge/Caddyfile /etc/caddy/Caddyfile
COPY edge/well-known /srv-well-known
# Fail the image build (CI builds this without pushing) rather than ship a
# Caddyfile that crash-loops the container on the NAS.
RUN caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
COPY --from=builder /app/www /srv
COPY --from=ota /ota /srv-ota

EXPOSE 8080
