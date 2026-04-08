/**
 * E2E tests for the OpenAI Codex OAuth login feature.
 *
 * Prerequisites:
 *   - Controller running at http://localhost:3010
 *   - Web dev server running at http://localhost:5173
 *
 * Run:
 *   npx playwright test apps/web/e2e/openai-oauth.spec.ts
 *
 * All OAuth tests mock the controller API endpoints because completing
 * a real OpenAI OAuth flow is not feasible in CI. They are marked with
 * a [mock] prefix in the test name.
 */

import { type Page, expect, test } from "@playwright/test";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const BASE_URL = "http://localhost:5173";
const _API_URL = "http://localhost:3010";

// ---------------------------------------------------------------------------
// Mock Data
// ---------------------------------------------------------------------------

const MOCK_PROVIDER_CONFIG_EMPTY = {
  config: {
    mode: "merge",
    providers: {},
  },
};

const MOCK_PROVIDER_CONFIG_OAUTH_CONNECTED = {
  config: {
    mode: "merge",
    providers: {
      openai: {
        enabled: true,
        displayName: "OpenAI",
        baseUrl: "https://chatgpt.com/backend-api/codex/v1",
        auth: "oauth",
        oauthProfileRef: "openai-codex",
        models: [
          { id: "gpt-5.1", name: "gpt-5.1" },
          { id: "gpt-5-mini", name: "gpt-5-mini" },
          { id: "o4-mini", name: "o4-mini" },
        ],
      },
    },
  },
};

const MOCK_OAUTH_START = {
  browserUrl:
    "https://auth.openai.com/oauth/authorize?client_id=test&state=abc",
};

const MOCK_OAUTH_STATUS_PENDING = { status: "pending" as const };
const MOCK_OAUTH_STATUS_COMPLETED = { status: "completed" as const };
const MOCK_OAUTH_STATUS_FAILED = {
  status: "failed" as const,
  error: "User cancelled",
};

const MOCK_PROVIDER_STATUS_CONNECTED = {
  connected: true,
  provider: "openai-codex",
  expiresAt: Date.now() + 3_600_000,
  remainingMs: 3_600_000,
};

const MOCK_PROVIDER_STATUS_DISCONNECTED = { connected: false };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function goToModelsPage(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}/workspace/models?tab=providers`);
  // Wait for the provider sidebar to render
  await page.waitForTimeout(500);
}

/**
 * Mock all provider-related API endpoints with default empty state.
 * Call this in beforeEach, then override specific routes as needed.
 */
async function mockDefaultProviderApis(page: Page): Promise<void> {
  // Mock canonical provider config document
  await page.route("**/api/v1/model-providers/config", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(MOCK_PROVIDER_CONFIG_EMPTY),
      });
    } else {
      await route.continue();
    }
  });

  // Mock models list
  await page.route("**/api/v1/models", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ models: [] }),
    });
  });

  // Mock OAuth provider-status (disconnected by default)
  await page.route(
    "**/api/v1/model-providers/openai/oauth/provider-status",
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(MOCK_PROVIDER_STATUS_DISCONNECTED),
      });
    },
  );

  // Mock OAuth flow status (idle by default)
  await page.route(
    "**/api/v1/model-providers/openai/oauth/status",
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: "idle" }),
      });
    },
  );

  // Mock desktop/ready and other common endpoints
  await page.route("**/api/internal/desktop/ready", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ready: true }),
    });
  });

  await page.route("**/api/internal/desktop/default-model", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ modelId: "openai/gpt-5.1" }),
    });
  });

  await page.route("**/api/internal/desktop/cloud-status", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        connected: false,
        cloudUrl: "https://cloud.nexu.io",
        linkUrl: null,
        activeProfileName: "default",
        profiles: [],
      }),
    });
  });

  await page.route("**/api/v1/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "user-test",
        displayName: "Test User",
        avatarUrl: null,
      }),
    });
  });
}

// ---------------------------------------------------------------------------
// Suite 1: OAuth Connect Flow (mocked)
// ---------------------------------------------------------------------------

test.describe("openai-oauth-connect", () => {
  test.beforeEach(async ({ page }) => {
    await mockDefaultProviderApis(page);
  });

  test("[mock] 'Login with ChatGPT' button is visible on OpenAI provider panel", async ({
    page,
  }) => {
    await goToModelsPage(page);

    // Click OpenAI provider in sidebar
    const openaiItem = page.locator("text=OpenAI").first();
    await openaiItem.click();

    // The OAuth login button should be visible
    const loginBtn = page.getByRole("button", { name: /Login with ChatGPT/i });
    await expect(loginBtn).toBeVisible();
  });

  test("[mock] clicking 'Login with ChatGPT' calls POST /oauth/start and opens browser URL", async ({
    page,
    context,
  }) => {
    // Mock the start endpoint
    await page.route(
      "**/api/v1/model-providers/openai/oauth/start",
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(MOCK_OAUTH_START),
        });
      },
    );

    await goToModelsPage(page);
    await page.locator("text=OpenAI").first().click();

    // Listen for new tab
    const newTabPromise = context.waitForEvent("page", { timeout: 10_000 });

    // Click the login button
    const loginBtn = page.getByRole("button", { name: /Login with ChatGPT/i });
    await loginBtn.click();

    // Verify new tab opened with auth URL
    const newTab = await newTabPromise;
    expect(newTab.url()).toContain("auth.openai.com");
  });

  test("[mock] UI shows spinner during pending state", async ({ page }) => {
    // Mock start
    await page.route(
      "**/api/v1/model-providers/openai/oauth/start",
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(MOCK_OAUTH_START),
        });
      },
    );

    // Mock status to return pending
    await page.unroute("**/api/v1/model-providers/openai/oauth/status");
    await page.route(
      "**/api/v1/model-providers/openai/oauth/status",
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(MOCK_OAUTH_STATUS_PENDING),
        });
      },
    );

    await goToModelsPage(page);
    await page.locator("text=OpenAI").first().click();

    const loginBtn = page.getByRole("button", { name: /Login with ChatGPT/i });
    await loginBtn.click();

    // Should show waiting text
    await expect(page.locator("text=/Waiting for ChatGPT login/i")).toBeVisible(
      {
        timeout: 5_000,
      },
    );
  });

  test("[mock] UI shows error toast when OAuth flow fails", async ({
    page,
  }) => {
    // Mock start
    await page.route(
      "**/api/v1/model-providers/openai/oauth/start",
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(MOCK_OAUTH_START),
        });
      },
    );

    // Mock status: first pending, then failed
    let statusCallCount = 0;
    await page.unroute("**/api/v1/model-providers/openai/oauth/status");
    await page.route(
      "**/api/v1/model-providers/openai/oauth/status",
      async (route) => {
        statusCallCount++;
        const body =
          statusCallCount <= 1
            ? MOCK_OAUTH_STATUS_PENDING
            : MOCK_OAUTH_STATUS_FAILED;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(body),
        });
      },
    );

    await goToModelsPage(page);
    await page.locator("text=OpenAI").first().click();

    const loginBtn = page.getByRole("button", { name: /Login with ChatGPT/i });
    await loginBtn.click();

    // Wait for error toast (sonner toast)
    await expect(page.locator("text=/User cancelled/i")).toBeVisible({
      timeout: 10_000,
    });
  });

  test("[mock] UI updates to connected state when flow completes", async ({
    page,
  }) => {
    // Mock start
    await page.route(
      "**/api/v1/model-providers/openai/oauth/start",
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(MOCK_OAUTH_START),
        });
      },
    );

    // Mock status: first pending, then completed
    let statusCallCount = 0;
    await page.unroute("**/api/v1/model-providers/openai/oauth/status");
    await page.route(
      "**/api/v1/model-providers/openai/oauth/status",
      async (route) => {
        statusCallCount++;
        const body =
          statusCallCount <= 1
            ? MOCK_OAUTH_STATUS_PENDING
            : MOCK_OAUTH_STATUS_COMPLETED;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(body),
        });
      },
    );

    // After completion, provider-status returns connected
    let providerStatusCallCount = 0;
    await page.unroute(
      "**/api/v1/model-providers/openai/oauth/provider-status",
    );
    await page.route(
      "**/api/v1/model-providers/openai/oauth/provider-status",
      async (route) => {
        providerStatusCallCount++;
        const body =
          providerStatusCallCount <= 2
            ? MOCK_PROVIDER_STATUS_DISCONNECTED
            : MOCK_PROVIDER_STATUS_CONNECTED;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(body),
        });
      },
    );

    // After completion, providers list returns connected
    await page.unroute("**/api/v1/model-providers/config");
    let providersCallCount = 0;
    await page.route("**/api/v1/model-providers/config", async (route) => {
      if (route.request().method() === "GET") {
        providersCallCount++;
        const body =
          providersCallCount <= 1
            ? MOCK_PROVIDER_CONFIG_EMPTY
            : MOCK_PROVIDER_CONFIG_OAUTH_CONNECTED;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(body),
        });
      } else {
        await route.continue();
      }
    });

    await goToModelsPage(page);
    await page.locator("text=OpenAI").first().click();

    const loginBtn = page.getByRole("button", { name: /Login with ChatGPT/i });
    await loginBtn.click();

    // Wait for connected banner
    await expect(page.locator("text=/Connected via ChatGPT/i")).toBeVisible({
      timeout: 15_000,
    });
  });
});

// ---------------------------------------------------------------------------
// Suite 2: OAuth Connected State (mocked)
// ---------------------------------------------------------------------------

test.describe("openai-oauth-connected", () => {
  test.beforeEach(async ({ page }) => {
    await mockDefaultProviderApis(page);

    // Override: provider-status returns connected
    await page.unroute(
      "**/api/v1/model-providers/openai/oauth/provider-status",
    );
    await page.route(
      "**/api/v1/model-providers/openai/oauth/provider-status",
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(MOCK_PROVIDER_STATUS_CONNECTED),
        });
      },
    );

    // Override: providers list returns connected with models
    await page.unroute("**/api/v1/model-providers/config");
    await page.route("**/api/v1/model-providers/config", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(MOCK_PROVIDER_CONFIG_OAUTH_CONNECTED),
        });
      } else {
        await route.continue();
      }
    });
  });

  test("[mock] connected banner shows 'Connected via ChatGPT' with disconnect button", async ({
    page,
  }) => {
    await goToModelsPage(page);
    await page.locator("text=OpenAI").first().click();

    await expect(page.locator("text=/Connected via ChatGPT/i")).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Disconnect/i }),
    ).toBeVisible();
  });

  test("[mock] model list displays models from OAuth provider", async ({
    page,
  }) => {
    await goToModelsPage(page);
    await page.locator("text=OpenAI").first().click();

    // Wait for model list
    await expect(page.locator("text=gpt-5.1")).toBeVisible({ timeout: 5_000 });
    await expect(page.locator("text=gpt-5-mini")).toBeVisible();
    await expect(page.locator("text=o4-mini")).toBeVisible();
  });

  test("[mock] API key input is hidden when OAuth is connected", async ({
    page,
  }) => {
    await goToModelsPage(page);
    await page.locator("text=OpenAI").first().click();

    // Connected banner should be visible
    await expect(page.locator("text=/Connected via ChatGPT/i")).toBeVisible();

    // API key input should NOT be visible
    await expect(page.locator("input[type='password']")).not.toBeVisible();
  });

  test("[mock] clicking disconnect returns to API key mode", async ({
    page,
  }) => {
    // Mock disconnect endpoint
    await page.route(
      "**/api/v1/model-providers/openai/oauth/disconnect",
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true }),
        });
      },
    );

    // After disconnect, provider-status returns disconnected
    let disconnected = false;
    await page.unroute(
      "**/api/v1/model-providers/openai/oauth/provider-status",
    );
    await page.route(
      "**/api/v1/model-providers/openai/oauth/provider-status",
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(
            disconnected
              ? MOCK_PROVIDER_STATUS_DISCONNECTED
              : MOCK_PROVIDER_STATUS_CONNECTED,
          ),
        });
      },
    );

    // After disconnect, providers returns empty
    await page.unroute("**/api/v1/model-providers/config");
    await page.route("**/api/v1/model-providers/config", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(
            disconnected
              ? MOCK_PROVIDER_CONFIG_EMPTY
              : MOCK_PROVIDER_CONFIG_OAUTH_CONNECTED,
          ),
        });
      } else {
        await route.continue();
      }
    });

    await goToModelsPage(page);
    await page.locator("text=OpenAI").first().click();

    // Click disconnect
    page.on("dialog", (dialog) => dialog.accept());
    const disconnectBtn = page.getByRole("button", { name: /Disconnect/i });
    await disconnectBtn.click();
    disconnected = true;

    // Login button should reappear
    await expect(
      page.getByRole("button", { name: /Login with ChatGPT/i }),
    ).toBeVisible({ timeout: 10_000 });
  });
});

// ---------------------------------------------------------------------------
// Suite 3: Non-OpenAI providers (negative tests)
// ---------------------------------------------------------------------------

test.describe("openai-oauth-negative", () => {
  test.beforeEach(async ({ page }) => {
    await mockDefaultProviderApis(page);

    // Add Anthropic provider
    await page.unroute("**/api/v1/model-providers/config");
    await page.route("**/api/v1/model-providers/config", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(MOCK_PROVIDER_CONFIG_EMPTY),
        });
      } else {
        await route.continue();
      }
    });
  });

  test("[mock] no OAuth button on Anthropic provider", async ({ page }) => {
    await goToModelsPage(page);

    // Click Anthropic provider
    await page.locator("text=Anthropic").first().click();

    // OAuth login button should NOT exist
    await expect(
      page.getByRole("button", { name: /Login with ChatGPT/i }),
    ).not.toBeVisible();
  });
});
