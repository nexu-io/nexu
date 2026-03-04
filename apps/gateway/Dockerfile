FROM node:22-slim AS base

ARG OPENCLAW_VERSION=2026.3.2

RUN apt-get update && \
    apt-get install -y --no-install-recommends curl git ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Rewrite git SSH -> HTTPS for public GitHub repos
RUN git config --global url."https://github.com/".insteadOf "ssh://git@github.com/" && \
    git config --global --add url."https://github.com/".insteadOf "git@github.com:"

RUN npm install -g openclaw@${OPENCLAW_VERSION}

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable

FROM base AS build

WORKDIR /app
ENV CI=true

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/gateway/package.json apps/gateway/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN pnpm install --filter @nexu/gateway... --frozen-lockfile

COPY apps/gateway ./apps/gateway
COPY packages/shared ./packages/shared

RUN pnpm --filter @nexu/gateway... build
RUN pnpm --filter @nexu/gateway... install --prod --frozen-lockfile

FROM base AS runtime

WORKDIR /app

ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/gateway/node_modules ./apps/gateway/node_modules
COPY --from=build /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=build /app/apps/gateway/dist ./apps/gateway/dist
COPY --from=build /app/apps/gateway/package.json ./apps/gateway/package.json
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json

CMD ["node", "apps/gateway/dist/index.js"]
