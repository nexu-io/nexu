import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { type RequestListener, createServer } from "node:http";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const scriptPath = resolve(
  process.cwd(),
  "apps/desktop/static/bundled-skills/libtv-video/scripts/libtv_video.py",
);

function makeTempDir(): string {
  return mkdtempSync(resolve(tmpdir(), "libtv-video-skill-"));
}

function writeConfig(
  nexuHome: string,
  overrides: Record<string, unknown> = {},
): void {
  writeFileSync(
    resolve(nexuHome, "libtv.json"),
    JSON.stringify({ apiKey: "mgk_test_key", ...overrides }, null, 2),
  );
}

async function runScript(args: string[], env: NodeJS.ProcessEnv) {
  return await new Promise<{
    status: number | null;
    stdout: string;
    stderr: string;
  }>((resolvePromise, rejectPromise) => {
    const child = spawn("python3", [scriptPath, ...args], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", rejectPromise);
    child.on("close", (status) => {
      resolvePromise({ status, stdout, stderr });
    });
  });
}

async function withGatewayServer(
  handler: RequestListener,
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = createServer(handler);
  await new Promise<void>((resolvePromise) => {
    server.listen(0, "127.0.0.1", () => resolvePromise());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind test gateway server.");
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () =>
      await new Promise<void>((resolvePromise, rejectPromise) => {
        server.close((error) => {
          if (error) {
            rejectPromise(error);
            return;
          }
          resolvePromise();
        });
      }),
  };
}

describe("libtv bundled skill", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    tempDirs.length = 0;
  });

  it("uses the Seedance production gateway by default", () => {
    const source = readFileSync(scriptPath, "utf8");
    expect(source).toContain('GATEWAY_URL = "https://seedance.nexu.io/"');
  });

  it("persists the Feishu delivery context and returns a submit confirmation", async () => {
    const nexuHome = makeTempDir();
    tempDirs.push(nexuHome);
    writeConfig(nexuHome);
    const createSessionRequests: Array<Record<string, unknown>> = [];

    const gateway = await withGatewayServer((request, response) => {
      if (request.url === "/libtv/v1/session" && request.method === "POST") {
        let rawBody = "";
        request.setEncoding("utf8");
        request.on("data", (chunk) => {
          rawBody += chunk;
        });
        request.on("end", () => {
          createSessionRequests.push(
            JSON.parse(rawBody) as Record<string, unknown>,
          );
          response.writeHead(200, { "Content-Type": "application/json" });
          response.end(
            JSON.stringify({
              sessionId: "session_123",
              projectUuid: "project_456",
              projectUrl: "https://www.liblib.tv/canvas?projectId=project_456",
            }),
          );
        });
        return;
      }

      response.writeHead(404, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: { user_message: "not found" } }));
    });

    try {
      const result = await runScript(
        [
          "create-session",
          "make a calm ocean video",
          "--channel",
          "feishu",
          "--chat-id",
          "ou_test_user",
        ],
        {
          ...process.env,
          NEXU_HOME: nexuHome,
          LIBTV_GATEWAY_URL: gateway.baseUrl,
          // Disable the background fork so the test does not leave a
          // detached process running after the assertions complete.
          LIBTV_SKIP_BACKGROUND_WAITER: "1",
        },
      );

      expect(result.status).toBe(0);
      expect(String(createSessionRequests[0]?.message)).toContain(
        "video ratio 16:9",
      );

      // stdout is a single-line submit confirmation JSON (not sessions_spawn).
      const payload = JSON.parse(result.stdout.trim()) as {
        status: string;
        sessionId: string;
        projectUuid: string;
        projectUrl: string;
        channel: string;
        deliverable: boolean;
        note: string;
      };
      expect(payload).toMatchObject({
        status: "submitted",
        sessionId: "session_123",
        projectUuid: "project_456",
        channel: "feishu",
        deliverable: true,
      });
      expect(payload.projectUrl).toContain("project_456");

      const persisted = JSON.parse(
        readFileSync(resolve(nexuHome, "libtv-sessions.json"), "utf8"),
      ) as Array<Record<string, unknown>>;
      expect(persisted).toHaveLength(1);
      expect(persisted[0]).toMatchObject({
        session_id: "session_123",
        project_uuid: "project_456",
        status: "submitted",
        auth_mode: "nexu_gateway",
        delivery: {
          channel: "feishu",
          chat_id: "ou_test_user",
        },
      });
      // No stale routing fields from the old libtv-notify era.
      const delivery = persisted[0]?.delivery as Record<string, unknown>;
      expect(delivery).not.toHaveProperty("account_id");
      expect(delivery).not.toHaveProperty("session_key");
      expect(delivery).not.toHaveProperty("thread_id");
    } finally {
      await gateway.close();
    }
  }, 15000);

  it("records an empty delivery block when no channel context is present", async () => {
    const nexuHome = makeTempDir();
    tempDirs.push(nexuHome);
    writeConfig(nexuHome);

    const gateway = await withGatewayServer((request, response) => {
      if (request.url === "/libtv/v1/session" && request.method === "POST") {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({
            sessionId: "session_no_ctx",
            projectUuid: "project_no_ctx",
          }),
        );
        return;
      }
      response.writeHead(404, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: { user_message: "not found" } }));
    });

    try {
      const env = { ...process.env };
      // Explicitly drop any inherited OPENCLAW_* so the skill sees no
      // channel context.
      env.OPENCLAW_CHANNEL_TYPE = "";
      env.OPENCLAW_CHAT_ID = "";
      env.NEXU_HOME = nexuHome;
      env.LIBTV_GATEWAY_URL = gateway.baseUrl;
      env.LIBTV_SKIP_BACKGROUND_WAITER = "1";

      const result = await runScript(
        ["create-session", "a city at night"],
        env,
      );
      expect(result.status).toBe(0);
      const payload = JSON.parse(result.stdout.trim()) as {
        deliverable: boolean;
        channel: string;
      };
      expect(payload.deliverable).toBe(false);
      expect(payload.channel).toBe("");

      const persisted = JSON.parse(
        readFileSync(resolve(nexuHome, "libtv-sessions.json"), "utf8"),
      ) as Array<Record<string, unknown>>;
      expect(persisted[0]?.delivery).toEqual({});
    } finally {
      await gateway.close();
    }
  });

  it("relays an explicitly configured video ratio instead of the default", async () => {
    const nexuHome = makeTempDir();
    tempDirs.push(nexuHome);
    writeFileSync(
      resolve(nexuHome, "libtv.json"),
      JSON.stringify({ apiKey: "mgk_test_key", videoRatio: "9:16" }, null, 2),
    );
    const createSessionRequests: Array<Record<string, unknown>> = [];

    const gateway = await withGatewayServer((request, response) => {
      if (request.url === "/libtv/v1/session" && request.method === "POST") {
        let rawBody = "";
        request.setEncoding("utf8");
        request.on("data", (chunk) => {
          rawBody += chunk;
        });
        request.on("end", () => {
          createSessionRequests.push(
            JSON.parse(rawBody) as Record<string, unknown>,
          );
          response.writeHead(200, { "Content-Type": "application/json" });
          response.end(
            JSON.stringify({
              sessionId: "session_ratio_123",
              projectUuid: "project_ratio_456",
            }),
          );
        });
        return;
      }

      response.writeHead(404, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: { user_message: "not found" } }));
    });

    try {
      const result = await runScript(
        [
          "create-session",
          "make a portrait dance video",
          "--channel",
          "feishu",
          "--chat-id",
          "ou_test_user",
        ],
        {
          ...process.env,
          NEXU_HOME: nexuHome,
          LIBTV_GATEWAY_URL: gateway.baseUrl,
          LIBTV_SKIP_BACKGROUND_WAITER: "1",
        },
      );

      expect(result.status).toBe(0);
      expect(String(createSessionRequests[0]?.message)).toContain(
        "video ratio 9:16",
      );
      expect(String(createSessionRequests[0]?.message)).not.toContain(
        "video ratio 16:9",
      );
    } finally {
      await gateway.close();
    }
  });

  it("routes sk-libtv keys through the direct LibTV API with the same delivery contract", async () => {
    const nexuHome = makeTempDir();
    tempDirs.push(nexuHome);
    writeConfig(nexuHome, { apiKey: "sk-libtv-direct-key" });

    const directRequests: Array<{
      method: string;
      url: string;
      body: Record<string, unknown>;
    }> = [];
    const directApi = await withGatewayServer((request, response) => {
      let rawBody = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        rawBody += chunk;
      });
      request.on("end", () => {
        const body =
          rawBody.trim().length > 0
            ? (JSON.parse(rawBody) as Record<string, unknown>)
            : {};
        directRequests.push({
          method: request.method ?? "",
          url: request.url ?? "",
          body,
        });
        expect(request.headers.authorization).toBe(
          "Bearer sk-libtv-direct-key",
        );
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({
            code: 0,
            message: "success",
            data: {
              sessionId: "direct_session_123",
              projectUuid: "direct_project_456",
              projectUrl:
                "https://www.liblib.tv/canvas?projectId=direct_project_456",
            },
          }),
        );
      });
    });

    try {
      const result = await runScript(
        [
          "create-session",
          "make a calm ocean video",
          "--channel",
          "feishu",
          "--chat-id",
          "ou_direct_user",
        ],
        {
          ...process.env,
          NEXU_HOME: nexuHome,
          LIBTV_DIRECT_BASE_URL: directApi.baseUrl,
          LIBTV_SKIP_BACKGROUND_WAITER: "1",
        },
      );

      expect(result.status).toBe(0);
      expect(directRequests).toHaveLength(1);
      expect(directRequests[0]).toMatchObject({
        method: "POST",
        url: "/openapi/session",
      });

      const payload = JSON.parse(result.stdout.trim()) as {
        status: string;
        sessionId: string;
        channel: string;
      };
      expect(payload).toMatchObject({
        status: "submitted",
        sessionId: "direct_session_123",
        channel: "feishu",
      });

      const persisted = JSON.parse(
        readFileSync(resolve(nexuHome, "libtv-sessions.json"), "utf8"),
      ) as Array<Record<string, unknown>>;
      expect(persisted[0]).toMatchObject({
        session_id: "direct_session_123",
        project_uuid: "direct_project_456",
        status: "submitted",
        auth_mode: "libtv_direct",
        delivery: {
          channel: "feishu",
          chat_id: "ou_direct_user",
        },
      });
    } finally {
      await directApi.close();
    }
  });

  it("rejects malformed submit responses that omit projectUuid", async () => {
    const nexuHome = makeTempDir();
    tempDirs.push(nexuHome);
    writeConfig(nexuHome);

    const gateway = await withGatewayServer((request, response) => {
      if (request.url === "/libtv/v1/session" && request.method === "POST") {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({
            sessionId: "session_123",
          }),
        );
        return;
      }

      response.writeHead(404, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: { user_message: "not found" } }));
    });

    try {
      const result = await runScript(
        [
          "create-session",
          "make a city at night",
          "--channel",
          "feishu",
          "--chat-id",
          "ou_test_user",
        ],
        {
          ...process.env,
          NEXU_HOME: nexuHome,
          LIBTV_GATEWAY_URL: gateway.baseUrl,
          LIBTV_SKIP_BACKGROUND_WAITER: "1",
        },
      );

      expect(result.status).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toContain("projectUuid");
    } finally {
      await gateway.close();
    }
  });
});
