import { describe, expect, it } from "vitest";
import { openclawConfigSchema } from "../../packages/shared/src/schemas/openclaw-config.js";

describe("openclawConfigSchema agent skills field", () => {
  it("accepts agent with skills array", () => {
    const config = createMinimalConfig({
      agents: {
        defaults: { model: { primary: "test-model" } },
        list: [{ id: "bot-1", name: "Bot", skills: ["git", "npm"] }],
      },
    });
    const result = openclawConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.agents.list[0].skills).toEqual(["git", "npm"]);
    }
  });

  it("accepts agent without skills field (legacy)", () => {
    const config = createMinimalConfig();
    const result = openclawConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.agents.list[0]).not.toHaveProperty("skills");
    }
  });

  it("accepts agent with empty skills array", () => {
    const config = createMinimalConfig({
      agents: {
        defaults: { model: { primary: "test-model" } },
        list: [{ id: "bot-1", name: "Bot", skills: [] }],
      },
    });
    const result = openclawConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.agents.list[0].skills).toEqual([]);
    }
  });
});

function createMinimalConfig(overrides: Record<string, unknown> = {}) {
  return {
    gateway: {
      port: 18789,
      mode: "local" as const,
      bind: "loopback" as const,
      auth: { mode: "token" as const, token: "test" },
      reload: { mode: "hybrid" as const },
      controlUi: { allowedOrigins: ["http://localhost:5173"] },
      tools: { allow: ["cron"] },
    },
    agents: {
      defaults: { model: { primary: "test-model" } },
      list: [{ id: "bot-1", name: "Bot" }],
    },
    channels: {},
    bindings: [],
    skills: { load: { watch: true } },
    ...overrides,
  };
}
