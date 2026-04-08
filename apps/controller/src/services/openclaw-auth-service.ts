import crypto from "node:crypto";
import http from "node:http";
import type { ControllerEnv } from "../app/env.js";
import { logger } from "../lib/logger.js";
import { proxyFetch } from "../lib/proxy-fetch.js";
import { OpenClawAuthProfilesStore } from "../runtime/openclaw-auth-profiles-store.js";

// ── Types ───────────────────────────────────────────────────────

export type OAuthFlowStatus = "idle" | "pending" | "completed" | "failed";

export interface OAuthProfile {
  type: "oauth";
  provider: string;
  access: string;
  refresh: string;
  expires: number;
  accountId: string;
}

interface FlowState {
  status: OAuthFlowStatus;
  error?: string;
  completedProfile?: OAuthProfile;
  completedModels?: string[];
}

// ── PKCE Helpers ────────────────────────────────────────────────

function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function generateCodeChallenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

function generateState(): string {
  return crypto.randomBytes(16).toString("hex");
}

function parseAccountIdFromJwt(token: string): string | undefined {
  try {
    const parts = token.split(".");
    const encoded = parts[1];
    if (!encoded) return undefined;
    const payload: unknown = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    );
    if (
      typeof payload === "object" &&
      payload !== null &&
      "https://api.openai.com/auth" in payload
    ) {
      const auth = (payload as Record<string, unknown>)[
        "https://api.openai.com/auth"
      ];
      if (typeof auth === "object" && auth !== null) {
        const accountId = (auth as Record<string, unknown>).chatgpt_account_id;
        if (typeof accountId === "string") return accountId;
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}

// ── Constants ───────────────────────────────────────────────────

const OPENAI_CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const OPENAI_AUTH_URL = "https://auth.openai.com/oauth/authorize";
const OPENAI_TOKEN_URL = "https://auth.openai.com/oauth/token";
const OPENAI_CALLBACK_PORT = 1455;
const OPENAI_REDIRECT_URI = `http://localhost:${OPENAI_CALLBACK_PORT}/auth/callback`;
const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;

// ── HTML Responses ──────────────────────────────────────────────

const SUCCESS_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>OAuth Success</title>
<style>body{font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#f0fdf4}
.card{text-align:center;padding:2rem;border-radius:12px;background:white;box-shadow:0 2px 8px rgba(0,0,0,0.1)}
h1{color:#16a34a;margin-bottom:0.5rem}p{color:#6b7280}</style></head>
<body><div class="card"><h1>Connected!</h1><p>OpenAI account linked successfully. You can close this tab.</p></div></body></html>`;

function errorHtml(message: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>OAuth Error</title>
<style>body{font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#fef2f2}
.card{text-align:center;padding:2rem;border-radius:12px;background:white;box-shadow:0 2px 8px rgba(0,0,0,0.1)}
h1{color:#dc2626;margin-bottom:0.5rem}p{color:#6b7280}</style></head>
<body><div class="card"><h1>Connection Failed</h1><p>${message}</p></div></body></html>`;
}

// ── Service ─────────────────────────────────────────────────────

export class OpenClawAuthService {
  private readonly authProfilesStore: OpenClawAuthProfilesStore;
  private flowState: FlowState = { status: "idle" };
  private callbackServer: http.Server | null = null;
  private timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  constructor(
    env: ControllerEnv,
    authProfilesStore = new OpenClawAuthProfilesStore(env),
  ) {
    this.authProfilesStore = authProfilesStore;
  }

  // ── Public API ──────────────────────────────────────────────

  async startOAuthFlow(
    providerId: string,
  ): Promise<{ browserUrl: string } | { error: string }> {
    if (providerId !== "openai") {
      return { error: `Unsupported OAuth provider: ${providerId}` };
    }

    // Abort any existing flow
    this.abortFlow();

    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const state = generateState();

    try {
      const { server } = await this.startCallbackServer(state, codeVerifier);
      this.callbackServer = server;

      const params = new URLSearchParams({
        response_type: "code",
        client_id: OPENAI_CODEX_CLIENT_ID,
        redirect_uri: OPENAI_REDIRECT_URI,
        scope: "openid profile email offline_access",
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        state,
        id_token_add_organizations: "true",
        codex_cli_simplified_flow: "true",
        originator: "pi",
      });

      const browserUrl = `${OPENAI_AUTH_URL}?${params.toString()}`;

      this.flowState = { status: "pending" };

      this.timeoutHandle = setTimeout(() => {
        this.abortFlow();
        this.flowState = {
          status: "failed",
          error: "OAuth flow timed out after 5 minutes",
        };
      }, CALLBACK_TIMEOUT_MS);

      logger.info(
        { providerId, callbackPort: OPENAI_CALLBACK_PORT },
        "OAuth flow started, waiting for callback",
      );

      return { browserUrl };
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to start OAuth flow";
      this.flowState = { status: "failed", error: message };
      return { error: message };
    }
  }

  getFlowStatus(): { status: OAuthFlowStatus; error?: string } {
    return {
      status: this.flowState.status,
      ...(this.flowState.error ? { error: this.flowState.error } : {}),
    };
  }

  async getProviderOAuthStatus(providerId: string): Promise<{
    connected: boolean;
    provider?: string;
    expiresAt?: number;
    remainingMs?: number;
  }> {
    if (providerId !== "openai") {
      return { connected: false };
    }

    try {
      const profileKey = "openai-codex:default";
      const filePaths =
        await this.authProfilesStore.listExistingAuthProfilesPaths();
      for (const filePath of filePaths) {
        const profiles = await this.authProfilesStore.readAuthProfiles(
          filePath,
          {
            missingOk: true,
          },
        );
        if (!profiles) {
          continue;
        }

        const profile = profiles.profiles[profileKey];
        if (
          typeof profile !== "object" ||
          profile === null ||
          !("type" in profile)
        ) {
          continue;
        }

        const typed = profile as Record<string, unknown>;
        if (typed.type !== "oauth") {
          continue;
        }

        const expiresAt =
          typeof typed.expires === "number" ? typed.expires : undefined;
        if (expiresAt === undefined) {
          continue;
        }

        const now = Date.now();
        const remainingMs = expiresAt - now;
        if (remainingMs <= 0) {
          continue;
        }

        return {
          connected: true,
          provider:
            typeof typed.provider === "string" ? typed.provider : "openai",
          expiresAt,
          remainingMs,
        };
      }

      return { connected: false };
    } catch (err: unknown) {
      logger.warn(
        { error: err instanceof Error ? err.message : String(err) },
        "Failed to read OAuth provider status",
      );
      return { connected: false };
    }
  }

  async disconnectOAuth(providerId: string): Promise<boolean> {
    if (providerId !== "openai") return false;

    try {
      const filePaths =
        await this.authProfilesStore.listExistingAuthProfilesPaths();
      if (filePaths.length === 0) return false;
      const profileKey = "openai-codex:default";
      await Promise.all(
        filePaths.map(async (filePath) => {
          await this.authProfilesStore.updateAuthProfiles(
            filePath,
            async (current) => {
              const { [profileKey]: _removed, ...remainingProfiles } =
                current.profiles;
              return {
                ...current,
                profiles: remainingProfiles,
              };
            },
          );
        }),
      );
      logger.info({ providerId }, "OAuth profile disconnected");
      return true;
    } catch (err: unknown) {
      logger.error(
        { error: err instanceof Error ? err.message : String(err) },
        "Failed to disconnect OAuth profile",
      );
      return false;
    }
  }

  consumeCompleted(): {
    profile: OAuthProfile;
    models: string[];
  } | null {
    if (
      this.flowState.status !== "completed" ||
      !this.flowState.completedProfile
    ) {
      return null;
    }

    const result = {
      profile: this.flowState.completedProfile,
      models: this.flowState.completedModels ?? [],
    };

    this.flowState = { status: "idle" };
    return result;
  }

  dispose(): void {
    this.abortFlow();
  }

  // ── Callback Server ─────────────────────────────────────────

  private startCallbackServer(
    expectedState: string,
    codeVerifier: string,
  ): Promise<{ server: http.Server }> {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        void this.handleCallback(req, res, expectedState, codeVerifier, server);
      });

      server.listen(OPENAI_CALLBACK_PORT, "127.0.0.1", () => {
        resolve({ server });
      });

      server.on("error", (err) => {
        reject(
          new Error(
            `Failed to bind port ${OPENAI_CALLBACK_PORT}: ${err.message}. Is another Codex/OpenClaw process using it?`,
          ),
        );
      });
    });
  }

  private async handleCallback(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    expectedState: string,
    codeVerifier: string,
    server: http.Server,
  ): Promise<void> {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
      if (url.pathname !== "/auth/callback") {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const error = url.searchParams.get("error");

      if (error) {
        const desc =
          url.searchParams.get("error_description") ?? "Unknown error";
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(errorHtml(desc));
        this.flowState = { status: "failed", error: desc };
        this.shutdownServer(server);
        return;
      }

      if (state !== expectedState) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(errorHtml("Invalid state parameter — possible CSRF attempt."));
        this.flowState = { status: "failed", error: "State mismatch" };
        this.shutdownServer(server);
        return;
      }

      if (!code) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(errorHtml("Missing authorization code."));
        this.flowState = { status: "failed", error: "Missing code" };
        this.shutdownServer(server);
        return;
      }

      // Exchange code for tokens
      const tokenResponse = await this.exchangeCode(code, codeVerifier);
      if ("error" in tokenResponse) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(errorHtml(tokenResponse.error));
        this.flowState = { status: "failed", error: tokenResponse.error };
        this.shutdownServer(server);
        return;
      }

      const { accessToken, refreshToken, expiresIn } = tokenResponse;
      const accountId = parseAccountIdFromJwt(accessToken) ?? "unknown";
      const expiresAt = Date.now() + expiresIn * 1000;

      // Codex OAuth tokens lack api.model.read scope; known models provided by route handler
      const models: string[] = [];

      // Build OAuth profile — provider MUST be "openai-codex" to match
      // OpenClaw's token refresh and provider routing.
      const profile: OAuthProfile = {
        type: "oauth",
        provider: "openai-codex",
        access: accessToken,
        refresh: refreshToken,
        expires: expiresAt,
        accountId,
      };

      // Merge into auth-profiles.json
      await this.mergeOAuthProfile("openai-codex:default", profile);

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(SUCCESS_HTML);

      this.flowState = {
        status: "completed",
        completedProfile: profile,
        completedModels: models,
      };

      logger.info(
        { accountId, modelCount: models.length },
        "OAuth flow completed successfully",
      );

      this.shutdownServer(server);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Callback processing failed";
      logger.error({ error: message }, "OAuth callback error");
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(errorHtml(message));
      this.flowState = { status: "failed", error: message };
      this.shutdownServer(server);
    }
  }

  // ── Token Exchange ──────────────────────────────────────────

  private async exchangeCode(
    code: string,
    codeVerifier: string,
  ): Promise<
    | { accessToken: string; refreshToken: string; expiresIn: number }
    | { error: string }
  > {
    try {
      const body = new URLSearchParams({
        grant_type: "authorization_code",
        client_id: OPENAI_CODEX_CLIENT_ID,
        code,
        code_verifier: codeVerifier,
        redirect_uri: OPENAI_REDIRECT_URI,
      });

      const response = await proxyFetch(OPENAI_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });

      if (!response.ok) {
        const text = await response.text();
        return { error: `Token exchange failed (${response.status}): ${text}` };
      }

      const data: unknown = await response.json();
      if (typeof data !== "object" || data === null) {
        return { error: "Invalid token response" };
      }

      const record = data as Record<string, unknown>;
      const accessToken = record.access_token;
      const refreshToken = record.refresh_token;
      const expiresIn = record.expires_in;

      if (typeof accessToken !== "string" || typeof refreshToken !== "string") {
        return { error: "Missing tokens in response" };
      }

      return {
        accessToken,
        refreshToken,
        expiresIn: typeof expiresIn === "number" ? expiresIn : 3600,
      };
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Token exchange failed";
      return { error: message };
    }
  }

  private async mergeOAuthProfile(
    key: string,
    profile: OAuthProfile,
  ): Promise<void> {
    const filePaths =
      await this.authProfilesStore.listWritableAuthProfilesPaths();

    await Promise.all(
      filePaths.map(async (filePath) => {
        await this.authProfilesStore.updateAuthProfiles(
          filePath,
          async (current) => ({
            ...current,
            profiles: {
              ...current.profiles,
              [key]: profile,
            },
          }),
        );
      }),
    );
  }

  // ── Lifecycle Helpers ───────────────────────────────────────

  private abortFlow(): void {
    if (this.timeoutHandle) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }
    if (this.callbackServer) {
      this.callbackServer.close();
      this.callbackServer = null;
    }
  }

  private shutdownServer(server: http.Server): void {
    if (this.timeoutHandle) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }
    server.close();
    if (this.callbackServer === server) {
      this.callbackServer = null;
    }
  }
}
