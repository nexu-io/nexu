# ---- Builder ----
FROM node:22-slim AS builder

RUN corepack enable && corepack prepare pnpm@10.26.0 --activate

WORKDIR /app

# Install dependencies first (cache layer)
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/

RUN pnpm install --frozen-lockfile

# Copy source and build
COPY packages/shared/ packages/shared/
COPY apps/web/ apps/web/

ARG VITE_API_URL=""
ARG VITE_COMMIT_HASH=""
ARG VITE_AMPLITUDE_API_KEY=""
ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_COMMIT_HASH=${VITE_COMMIT_HASH}
ENV VITE_AMPLITUDE_API_KEY=${VITE_AMPLITUDE_API_KEY}

RUN pnpm --filter @nexu/web build

# ---- Runtime ----
FROM nginx:1.27-alpine

COPY deploy/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/apps/web/dist/ /usr/share/nginx/html/

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost/nginx-health || exit 1
