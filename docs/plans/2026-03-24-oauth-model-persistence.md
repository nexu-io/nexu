# OAuth Model Persistence + Z.AI Coding Plan Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix OpenAI OAuth to persist models after login, and add a Z.AI Coding Plan quick-setup section on the GLM provider panel.

**Architecture:** Two independent features sharing a UI pattern — a special auth section above the generic API key form. OpenAI OAuth persists known Codex models when the flow completes. Z.AI Coding Plan pre-fills `https://api.z.ai/api/coding/paas/v4` and saves known free models on submit.

**Tech Stack:** Hono (controller routes), Zod (shared schemas), React + TanStack Query (frontend), Vitest (tests), pnpm monorepo

**Worktree:** `/Users/alche/Documents/digit-sutando/nexu/.worktrees/openai-oauth` (branch `feat/openai-codex-oauth`)

---

### Task 1: Add `models` field to OAuth status response schema

**Files:**
- Modify: `packages/shared/src/schemas/provider.ts`

**Step 1: Update the schema**

Find `oauthStatusResponseSchema` and add the optional `models` field:

```typescript
export const oauthStatusResponseSchema = z.object({
  status: z.enum(["idle", "pending", "completed", "failed"]),
  error: z.string().optional(),
  models: z.array(z.string()).optional(),
});
```

**Step 2: Regenerate types**

Run: `pnpm generate-types`
Expected: "Done! Your output is in ./apps/web/lib/api"

**Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: All 4 projects pass

**Step 4: Commit**

```bash
git add packages/shared/src/schemas/provider.ts apps/controller/openapi.json apps/web/lib/api/sdk.gen.ts apps/web/lib/api/types.gen.ts
git commit -m "feat: add models field to oauth status response schema"
```

---

### Task 2: Persist models on OAuth completion in status route

**Files:**
- Modify: `apps/controller/src/routes/provider-oauth-routes.ts`

**Step 1: Add known models constant at top of file**

After the imports, add:

```typescript
// Known models for OpenAI Codex subscription (ChatGPT Plus/Pro OAuth).
// Source: https://docs.openclaw.ai/providers/openai
// Codex tokens lack api.model.read scope, so models can't be fetched dynamically.
const OPENAI_CODEX_KNOWN_MODELS = [
  "gpt-5.4",
  "gpt-5.1",
  "gpt-5-mini",
  "o4-mini",
];
```

**Step 2: Update the GET /oauth/status route handler**

Replace the current status handler with one that consumes completed results and persists models:

```typescript
async (c) => {
  const { providerId } = c.req.valid("param");
  const flowStatus = container.openclawAuthService.getFlowStatus();

  if (flowStatus.status === "completed") {
    const completed = container.openclawAuthService.consumeCompleted();
    if (completed) {
      const models =
        completed.models.length > 0
          ? completed.models
          : OPENAI_CODEX_KNOWN_MODELS;

      await container.modelProviderService.upsertProvider(providerId, {
        displayName: "OpenAI",
        enabled: true,
        modelsJson: JSON.stringify(models),
      });
      await container.openclawSyncService.syncAll();
      return c.json({ ...flowStatus, models }, 200);
    }
  }

  return c.json(flowStatus, 200);
},
```

**Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add apps/controller/src/routes/provider-oauth-routes.ts
git commit -m "fix: persist OAuth models to provider config on flow completion"
```

---

### Task 3: Remove broken fetchModels call in auth service

**Files:**
- Modify: `apps/controller/src/services/openclaw-auth-service.ts`

**Step 1: Find the fetchModels call in handleCallback**

Search for `fetchModels` in the `handleCallback` method. Replace the call with an empty array:

```typescript
// Codex OAuth tokens lack api.model.read scope; known models provided by route handler
const models: string[] = [];
```

The `fetchModels` private method can be kept (it's not harmful) or removed — either way the call site should pass `[]`.

**Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add apps/controller/src/services/openclaw-auth-service.ts
git commit -m "fix: remove broken fetchModels call (Codex token lacks model.read scope)"
```

---

### Task 4: Update DEFAULT_MODELS for openai and zai

**Files:**
- Modify: `apps/web/src/pages/models.tsx`

**Step 1: Update the openai entry in DEFAULT_MODELS (around line 220)**

```typescript
openai: ["gpt-5.4", "gpt-5.1", "gpt-5-mini", "o4-mini"],
```

**Step 2: Update the zai entry in DEFAULT_MODELS (around line 249)**

```typescript
zai: ["glm-5", "glm-4.7", "glm-4.7-flash", "glm-4.7-flashx"],
```

**Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add apps/web/src/pages/models.tsx
git commit -m "fix: update default models for openai (add gpt-5.4) and zai (coding plan models)"
```

---

### Task 5: Add Z.AI Coding Plan i18n keys

**Files:**
- Modify: `apps/web/src/i18n/locales/en.ts`
- Modify: `apps/web/src/i18n/locales/zh-CN.ts`

**Step 1: Add English keys**

Find the existing `models.byok.oauthDescription` key and add after it:

```typescript
"models.byok.zaiCodingPlan": "Z.AI Coding Plan",
"models.byok.zaiCodingPlanDesc": "Free models with your Z.AI Coding Plan subscription",
"models.byok.zaiOrGeneralApi": "Or use General API key",
```

**Step 2: Add Chinese keys**

Find the corresponding section in zh-CN.ts and add:

```typescript
"models.byok.zaiCodingPlan": "智谱 Coding Plan",
"models.byok.zaiCodingPlanDesc": "使用你的智谱 Coding Plan 订阅（免费模型）",
"models.byok.zaiOrGeneralApi": "或使用通用 API Key",
```

**Step 3: Commit**

```bash
git add apps/web/src/i18n/locales/en.ts apps/web/src/i18n/locales/zh-CN.ts
git commit -m "feat: add Z.AI Coding Plan i18n keys"
```

---

### Task 6: Add Z.AI Coding Plan UI section to GLM provider panel

**Files:**
- Modify: `apps/web/src/pages/models.tsx`

**Step 1: Add constants and state**

Near the top of `ByokProviderDetail`, after the `isOAuthProvider` state declarations, add:

```typescript
const ZAI_CODING_PLAN_BASE_URL = "https://api.z.ai/api/coding/paas/v4";
const ZAI_CODING_PLAN_MODELS = ["glm-5", "glm-4.7", "glm-4.7-flash", "glm-4.7-flashx"];
```

Inside the component, after the OAuth state block, add:

```typescript
// ── Z.AI Coding Plan state ───────────────────────────
const isZaiProvider = providerId === "zai";
const [codingPlanKey, setCodingPlanKey] = useState("");

const saveCodingPlanMutation = useMutation({
  mutationFn: () =>
    saveProvider(providerId, {
      apiKey: codingPlanKey,
      baseUrl: ZAI_CODING_PLAN_BASE_URL,
      displayName: "GLM",
      enabled: true,
      modelsJson: JSON.stringify(ZAI_CODING_PLAN_MODELS),
    }),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["providers"] });
    queryClient.invalidateQueries({ queryKey: ["models"] });
    setCodingPlanKey("");
    markSetupComplete();
    const preferred = selectPreferredModel(ZAI_CODING_PLAN_MODELS);
    if (preferred) {
      onAutoSelectModel(preferred);
    }
  },
});
```

Also reset `codingPlanKey` in the existing `useEffect` that resets form on provider change:

```typescript
setCodingPlanKey("");
```

**Step 2: Add Z.AI Coding Plan JSX**

After the OAuth section `{isOAuthProvider && (...)}` block and before the `{/* API Key + API Proxy URL */}` section, add:

```tsx
{/* Z.AI Coding Plan section (GLM only) */}
{isZaiProvider && !dbProvider?.hasApiKey && (
  <div className="mb-6">
    <div className="rounded-lg border border-border bg-surface-0 p-4">
      <div className="text-[12px] font-medium text-text-primary mb-1">
        {t("models.byok.zaiCodingPlan")}
      </div>
      <div className="text-[10px] text-text-muted mb-3">
        {t("models.byok.zaiCodingPlanDesc")}
      </div>
      <div className="flex gap-2">
        <input
          type="password"
          value={codingPlanKey}
          onChange={(e) => setCodingPlanKey(e.target.value)}
          placeholder="sk-..."
          className="flex-1 rounded-lg border border-border bg-surface-0 px-3 py-2 text-[12px] text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-primary)]/20 focus:border-[var(--color-brand-primary)]/30"
        />
        <button
          type="button"
          disabled={!codingPlanKey || saveCodingPlanMutation.isPending}
          onClick={() => saveCodingPlanMutation.mutate()}
          className={cn(
            "px-4 py-2 rounded-lg text-[12px] font-medium transition-colors",
            codingPlanKey
              ? "bg-accent text-accent-fg hover:bg-accent/90"
              : "bg-surface-2 text-text-muted cursor-not-allowed",
          )}
        >
          {saveCodingPlanMutation.isPending ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            t("models.byok.saveAndEnable")
          )}
        </button>
      </div>
    </div>

    {/* Divider */}
    <div className="flex items-center gap-3 my-4">
      <div className="flex-1 border-t border-border" />
      <span className="text-[10px] text-text-muted">
        {t("models.byok.zaiOrGeneralApi")}
      </span>
      <div className="flex-1 border-t border-border" />
    </div>
  </div>
)}
```

**Step 3: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS (format if needed with `pnpm format`)

**Step 4: Commit**

```bash
git add apps/web/src/pages/models.tsx
git commit -m "feat: add Z.AI Coding Plan quick-setup section on GLM provider panel"
```

---

### Task 7: Final verification

**Step 1: Run all checks**

```bash
pnpm typecheck && pnpm lint && pnpm test
```
Expected: All pass

**Step 2: Manual test — OpenAI OAuth**

1. Navigate to Settings → Providers → OpenAI
2. Click Disconnect (if connected)
3. Click "Login with ChatGPT" → authenticate
4. After completion, model list should show: gpt-5.4, gpt-5.1, gpt-5-mini, o4-mini
5. Refresh page → models persist

**Step 3: Manual test — Z.AI Coding Plan**

1. Navigate to Settings → Providers → GLM
2. See "Z.AI Coding Plan" section with API key input
3. Enter a Coding Plan API key → click Save
4. Model list shows: glm-5, glm-4.7, glm-4.7-flash, glm-4.7-flashx
5. Base URL saved as `https://api.z.ai/api/coding/paas/v4`
