# Hono + Zod OpenAPI API Patterns

Nexu's active backend path is `apps/controller`. Use these patterns for all controller HTTP routes.

---

## Core rule

Zod schemas are the single source of truth:

```text
Zod schema
  -> request validation
  -> response typing
  -> OpenAPI document
  -> generated web SDK
```

Do not hand-maintain duplicate request or response types.

---

## Route shape

```typescript
// apps/controller/src/routes/example-routes.ts
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

const exampleResponseSchema = z.object({
  ok: z.literal(true),
});

const getExampleRoute = createRoute({
  method: "get",
  path: "/api/v1/example",
  responses: {
    200: {
      description: "Example response",
      content: {
        "application/json": {
          schema: exampleResponseSchema,
        },
      },
    },
  },
});

export function registerExampleRoutes(app: OpenAPIHono) {
  app.openapi(getExampleRoute, async (c) => {
    return c.json({ ok: true }, 200);
  });
}
```

---

## App registration

```typescript
// apps/controller/src/app.ts
import { OpenAPIHono } from "@hono/zod-openapi";
import { registerExampleRoutes } from "./routes/example-routes";

export function createApp() {
  const app = new OpenAPIHono();

  registerExampleRoutes(app);

  app.doc("/openapi.json", {
    openapi: "3.1.0",
    info: {
      title: "Nexu Controller API",
      version: "1.0.0",
    },
  });

  return app;
}
```

---

## Generated SDK flow

`apps/controller` is the OpenAPI source and `apps/web` consumes the generated client:

```typescript
// apps/web/openapi-ts.config.ts
import { defineConfig } from "@hey-api/openapi-ts";

export default defineConfig({
  input: "../controller/openapi.json",
  output: "./lib/api",
  plugins: [
    "@hey-api/typescript",
    { name: "@hey-api/client-fetch" },
    { name: "@hey-api/sdk" },
  ],
});
```

After route or schema changes run `pnpm generate-types`, then update web call sites to use the generated SDK.

---

## Frontend rule

Frontend code must use `apps/web/lib/api/` and should not call controller routes with raw `fetch` when an SDK function exists.

---

## File map

```text
apps/controller/
  src/app.ts
  src/routes/
  openapi.json

apps/web/
  openapi-ts.config.ts
  lib/api/
```
