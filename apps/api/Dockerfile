# ---- Builder ----
FROM node:22-slim AS builder

RUN corepack enable && corepack prepare pnpm@10.26.0 --activate

WORKDIR /app

# Install dependencies first (cache layer)
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/

RUN pnpm install --frozen-lockfile --ignore-scripts

# Copy source and build
COPY packages/shared/ packages/shared/
COPY apps/api/ apps/api/

RUN pnpm --filter @nexu/shared build && \
    pnpm --filter @nexu/api build && \
    test -f apps/api/dist/index.js || (echo "FATAL: apps/api/dist/index.js not found — check tsconfig rootDir" && exit 1)

# ---- Runtime ----
FROM node:22-slim

RUN corepack enable && corepack prepare pnpm@10.26.0 --activate

ARG COMMIT_HASH

WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/

RUN pnpm install --frozen-lockfile --prod --ignore-scripts

# Copy built output
COPY --from=builder /app/packages/shared/dist/ packages/shared/dist/
COPY --from=builder /app/apps/api/dist/ apps/api/dist/

ENV NODE_ENV=production
ENV PORT=3000
ENV COMMIT_HASH=${COMMIT_HASH}

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then(r=>{if(!r.ok)throw 1})"

CMD ["node", "apps/api/dist/index.js"]
