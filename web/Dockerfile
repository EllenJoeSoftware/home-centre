# syntax=docker/dockerfile:1

# ---- build -----------------------------------------------------------------
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# ---- runtime ---------------------------------------------------------------
FROM nginx:1.27-alpine
# Upstream for /api/ (no trailing slash). Rendered into the config at start-up
# by the official image's envsubst template step.
ENV API_UPSTREAM=http://server:8096 \
    NGINX_ENVSUBST_FILTER=^API_UPSTREAM$
RUN rm -f /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1
