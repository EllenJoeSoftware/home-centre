# syntax=docker/dockerfile:1

# ---------- build stage: compile TypeScript + native better-sqlite3 ----------
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
# better-sqlite3 downloads a prebuilt binary for the target arch (linux-x64 / linux-arm64, glibc);
# the toolchain above is the fallback if no prebuilt matches. Building from source under QEMU
# (arm64 image on an amd64 CI runner) is very slow, so prefer the prebuilt.
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build \
 && npm prune --omit=dev

# ---------- runtime stage ----------
FROM node:22-bookworm-slim AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PORT=8096 \
    MEDIA_DIRS=/media \
    BROWSE_ROOTS=/media,/host \
    DATA_DIR=/data

WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

# Non-root user (the node image ships "node" uid 1000); /data must be writable by it.
RUN mkdir -p /media /host /data && chown node:node /data
USER node

EXPOSE 8096
VOLUME ["/media", "/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8096)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/index.js"]
