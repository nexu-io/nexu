# Hono + Drizzle + Zod 编码模式参考

从 CloudSpec 后端提取的模式，Nexu API 应遵循相同风格。

---

## 核心理念：Zod 是单一类型源

```
Zod Schema
  ├→ API 路由验证 (@hono/zod-openapi)
  ├→ OpenAPI Spec (自动导出)
  ├→ 前端 SDK (@hey-api/openapi-ts 自动生成)
  └→ 类型推导 (z.infer<typeof schema>)
```

**永远不要手写类型再去同步。所有类型从 Zod schema 推导。**

---

## 1. API 路由定义（Hono + Zod OpenAPI）

```typescript
// apps/api/src/routes/bots.ts
import { createRoute, z } from "@hono/zod-openapi";
import { OpenAPIHono } from "@hono/zod-openapi";
import { db } from "../db";
import { bots } from "../db/schema";
import { eq } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";

// ========== Zod Schemas (定义一次，到处用) ==========

const CreateBotSchema = z.object({
  name: z.string().min(1).max(255),
  slug: z.string().regex(/^[a-z0-9-]+$/).max(100),
  systemPrompt: z.string().optional(),
  modelId: z.string().default("gpt-4o"),
});

const BotSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  status: z.enum(["active", "paused", "deleted"]),
  modelId: z.string(),
  createdAt: z.string(),
});

const BotListSchema = z.object({
  bots: z.array(BotSchema),
});

// ========== Route Definitions ==========

const createBot = createRoute({
  method: "post",
  path: "/v1/bots",
  request: {
    body: { content: { "application/json": { schema: CreateBotSchema } } },
  },
  responses: {
    200: {
      content: { "application/json": { schema: BotSchema } },
      description: "Bot created",
    },
  },
});

const listBots = createRoute({
  method: "get",
  path: "/v1/bots",
  responses: {
    200: {
      content: { "application/json": { schema: BotListSchema } },
      description: "Bot list",
    },
  },
});

// ========== Route Implementation ==========

export function registerBotRoutes(app: OpenAPIHono) {
  app.openapi(createBot, async (c) => {
    const input = c.req.valid("json");
    // input 的类型自动是 z.infer<typeof CreateBotSchema>
    const userId = c.get("userId"); // from auth middleware

    const [bot] = await db.insert(bots).values({
      id: createId(),
      userId,
      name: input.name,
      slug: input.slug,
      systemPrompt: input.systemPrompt,
      modelId: input.modelId,
    }).returning();

    return c.json({
      id: bot.id,
      name: bot.name,
      slug: bot.slug,
      status: bot.status,
      modelId: bot.modelId,
      createdAt: bot.createdAt.toISOString(),
    }, 200);
    // 返回值会被 BotSchema 类型检查
  });

  app.openapi(listBots, async (c) => {
    const userId = c.get("userId");
    const result = await db.select().from(bots).where(eq(bots.userId, userId));
    return c.json({
      bots: result.map((b) => ({
        id: b.id,
        name: b.name,
        slug: b.slug,
        status: b.status ?? "active",
        modelId: b.modelId ?? "gpt-4o",
        createdAt: b.createdAt?.toISOString() ?? "",
      })),
    }, 200);
  });
}
```

**要点：**
- `createRoute` 定义请求/响应的 Zod schema + OpenAPI 元数据
- `app.openapi(route, handler)` 注册处理函数，入参和返回值完全类型安全
- 不需要手写 DTO 类，Zod schema 就是 DTO

---

## 2. App 入口和中间件

```typescript
// apps/api/src/app.ts
import { OpenAPIHono } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { registerBotRoutes } from "./routes/bots";
import { registerChannelRoutes } from "./routes/channels";
import { registerPoolRoutes } from "./routes/pools";
import { authMiddleware } from "./middleware/auth";

export function createApp() {
  const app = new OpenAPIHono();

  // Global middleware
  app.use("*", logger());
  app.use("*", cors());

  // Auth middleware (sets c.set("userId", ...))
  app.use("/v1/*", authMiddleware);

  // Register route groups
  registerBotRoutes(app);
  registerChannelRoutes(app);
  registerPoolRoutes(app);

  // OpenAPI JSON endpoint (自动生成)
  app.doc("/openapi.json", {
    openapi: "3.1.0",
    info: { title: "Nexu API", version: "1.0.0" },
  });

  return app;
}
```

```typescript
// apps/api/src/index.ts
import { serve } from "@hono/node-server";
import { createApp } from "./app";

const app = createApp();
const port = Number.parseInt(process.env.PORT ?? "3000");

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Nexu API listening on http://localhost:${info.port}`);
});
```

---

## 3. 数据库（Drizzle，无外键）

```typescript
// apps/api/src/db/schema/index.ts
import { pgTable, text, timestamp, bigint, jsonb, integer, uniqueIndex } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  pk: bigint("pk", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  id: text("id").notNull().unique(),
  email: text("email").notNull().unique(),
  displayName: text("display_name"),
  plan: text("plan").default("free"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const bots = pgTable("bots", {
  pk: bigint("pk", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  id: text("id").notNull().unique(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  systemPrompt: text("system_prompt"),
  modelId: text("model_id").default("gpt-4o"),
  agentConfig: jsonb("agent_config").default({}),
  toolsConfig: jsonb("tools_config").default({}),
  status: text("status").default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  uniqueIndex("bots_user_slug_idx").on(table.userId, table.slug),
]);

export const botChannels = pgTable("bot_channels", {
  pk: bigint("pk", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  id: text("id").notNull().unique(),
  botId: text("bot_id").notNull(),
  channelType: text("channel_type").notNull(),
  accountId: text("account_id").notNull(),
  status: text("status").default("pending"),
  channelConfig: jsonb("channel_config").default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  uniqueIndex("bot_channels_uniq_idx").on(table.botId, table.channelType, table.accountId),
]);

export const channelCredentials = pgTable("channel_credentials", {
  pk: bigint("pk", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  id: text("id").notNull().unique(),
  botChannelId: text("bot_channel_id").notNull(),
  credentialType: text("credential_type").notNull(),
  encryptedValue: text("encrypted_value").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  uniqueIndex("cred_uniq_idx").on(table.botChannelId, table.credentialType),
]);

export const gatewayPools = pgTable("gateway_pools", {
  pk: bigint("pk", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  id: text("id").notNull().unique(),
  poolName: text("pool_name").notNull().unique(),
  poolType: text("pool_type").default("shared"),
  maxBots: integer("max_bots").default(50),
  currentBots: integer("current_bots").default(0),
  status: text("status").default("pending"),
  configVersion: integer("config_version").default(0),
  podIp: text("pod_ip"),
  lastHeartbeat: timestamp("last_heartbeat", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const gatewayAssignments = pgTable("gateway_assignments", {
  pk: bigint("pk", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  id: text("id").notNull().unique(),
  botId: text("bot_id").notNull().unique(),
  poolId: text("pool_id").notNull(),
  assignedAt: timestamp("assigned_at", { withTimezone: true }).defaultNow(),
});

export const webhookRoutes = pgTable("webhook_routes", {
  pk: bigint("pk", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  id: text("id").notNull().unique(),
  channelType: text("channel_type").notNull(),
  externalId: text("external_id").notNull(),
  poolId: text("pool_id").notNull(),
  botChannelId: text("bot_channel_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  uniqueIndex("webhook_routes_uniq_idx").on(table.channelType, table.externalId),
]);

export const usageMetrics = pgTable("usage_metrics", {
  pk: bigint("pk", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  id: text("id").notNull().unique(),
  botId: text("bot_id").notNull(),
  hour: timestamp("hour", { withTimezone: true }).notNull(),
  messagesIn: integer("messages_in").default(0),
  messagesOut: integer("messages_out").default(0),
  tokensIn: bigint("tokens_in", { mode: "number" }).default(0),
  tokensOut: bigint("tokens_out", { mode: "number" }).default(0),
}, (table) => [
  uniqueIndex("usage_metrics_uniq_idx").on(table.botId, table.hour),
]);
```

**规范：**
- **禁止外键**——用应用层 join
- `pk` (bigint, auto-increment) 为内部主键，`id` (cuid2 text) 为公开 ID
- 列名: `snake_case`，Drizzle 字段: `camelCase`
- Schema 集中在 `db/schema/index.ts`
- 用 `drizzle-kit generate` 生成 migration SQL 并提交 `apps/api/migrations/`（复杂场景可在生成后受控编辑）

---

## 4. DB 连接

```typescript
// apps/api/src/db.ts
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./db/schema";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

export const db = drizzle(pool, { schema });
```

---

## 5. Auth 中间件（better-auth）

```typescript
// apps/api/src/middleware/auth.ts
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";

export const authMiddleware = createMiddleware(async (c, next) => {
  const session = c.get("session"); // from better-auth
  if (!session?.user) {
    throw new HTTPException(401, { message: "Unauthorized" });
  }
  c.set("userId", session.user.id);
  await next();
});
```

---

## 6. OpenAPI 导出 + 前端 SDK 生成

```typescript
// apps/api/scripts/generate-openapi.ts
import { createApp } from "../src/app";
import fs from "node:fs";

const app = createApp();
const spec = app.getOpenAPIDocument({
  openapi: "3.1.0",
  info: { title: "Nexu API", version: "1.0.0" },
});

fs.writeFileSync("openapi.json", JSON.stringify(spec, null, 2));
console.log("OpenAPI spec written to openapi.json");
```

```typescript
// openapi-ts.config.ts (repo root)
import { defineConfig } from "@hey-api/openapi-ts";

export default defineConfig({
  input: "apps/api/openapi.json",
  output: "apps/web/lib/api",
  client: "@hey-api/client-next",
});
```

**流程：**
1. 改 route/schema → `pnpm generate-types`
2. 自动更新 `apps/web/lib/api/sdk.gen.ts`
3. 前端直接 import 使用，完全类型安全

---

## 7. 前端使用生成的 SDK

```typescript
// apps/web/src/pages/bot-list.tsx
import { getBots, createBot } from "../lib/api/sdk.gen";

function BotListPage() {
  // getBots() 返回类型自动从 OpenAPI spec 推导
  const { data, isLoading } = useQuery({
    queryKey: ["bots"],
    queryFn: () => getBots(),
  });

  const mutation = useMutation({
    mutationFn: (input) => createBot({ body: input }),
    // input 类型自动是 CreateBotSchema 推导的
  });
}
```

**禁止在前端用 `fetch` 调内部 API。必须用生成的 SDK。**

---

## 8. 错误处理

```typescript
import { HTTPException } from "hono/http-exception";

// 404
throw new HTTPException(404, { message: `Bot ${botId} not found` });

// 400
throw new HTTPException(400, { message: "Invalid channel credentials" });

// 409
throw new HTTPException(409, { message: "Bot slug already exists" });
```

---

## 9. 项目文件组织

```
apps/api/
├── src/
│   ├── index.ts              # Server entry
│   ├── app.ts                # Hono app setup + route registration
│   ├── db.ts                 # Database connection
│   ├── config-generator.ts   # OpenClaw config generator (核心)
│   ├── middleware/
│   │   └── auth.ts           # Auth middleware
│   ├── routes/
│   │   ├── bots.ts           # Bot CRUD
│   │   ├── channels.ts       # Channel connect (Slack OAuth)
│   │   ├── pools.ts          # Gateway pool management (internal)
│   │   ├── usage.ts          # Usage metrics
│   │   └── auth.ts           # Auth routes (better-auth)
│   └── db/
│       ├── schema/
│       │   └── index.ts      # All Drizzle table definitions
│       └── migrations/
├── scripts/
│   └── generate-openapi.ts
├── package.json
└── tsconfig.json
```
