import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ControllerEnv } from "../app/env.js";

export interface AuthProfilesData {
  version: number;
  profiles: Record<string, unknown>;
  lastGood?: Record<string, unknown>;
  usageStats?: Record<string, unknown>;
}

export interface OAuthConnectionState {
  connectedProviderIds: string[];
}

const OAUTH_PROVIDER_ID_MAP: Record<string, string> = {
  "openai-codex": "openai",
};

function parseAuthProfilesData(
  content: string,
  filePath: string,
): AuthProfilesData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse auth profiles at ${filePath}: ${message}`);
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(
      `Failed to parse auth profiles at ${filePath}: root must be an object`,
    );
  }

  const record = parsed as Record<string, unknown>;
  return {
    version: typeof record.version === "number" ? record.version : 1,
    profiles:
      typeof record.profiles === "object" &&
      record.profiles !== null &&
      !Array.isArray(record.profiles)
        ? (record.profiles as Record<string, unknown>)
        : {},
    ...(typeof record.lastGood === "object" && record.lastGood !== null
      ? { lastGood: record.lastGood as Record<string, unknown> }
      : {}),
    ...(typeof record.usageStats === "object" && record.usageStats !== null
      ? { usageStats: record.usageStats as Record<string, unknown> }
      : {}),
  };
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function createEmptyAuthProfilesData(): AuthProfilesData {
  return {
    version: 1,
    profiles: {},
  };
}

export class OpenClawAuthProfilesStore {
  private readonly updateQueues = new Map<string, Promise<void>>();

  constructor(private readonly env: ControllerEnv) {}

  async listAgentAuthProfilesPaths(): Promise<string[]> {
    const agentsDir = path.join(this.env.openclawStateDir, "agents");
    try {
      const entries = await readdir(agentsDir, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isDirectory())
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((entry) =>
          path.join(agentsDir, entry.name, "agent", "auth-profiles.json"),
        );
    } catch (error) {
      if (isMissingFileError(error)) {
        return [];
      }
      throw error;
    }
  }

  sharedAuthProfilesPath(): string {
    return path.join(this.env.openclawStateDir, "auth-profiles.json");
  }

  async listWritableAuthProfilesPaths(): Promise<string[]> {
    return [
      this.sharedAuthProfilesPath(),
      ...(await this.listAgentAuthProfilesPaths()),
    ];
  }

  async listExistingAuthProfilesPaths(): Promise<string[]> {
    const candidates = await this.listWritableAuthProfilesPaths();
    const existingPaths: string[] = [];

    for (const filePath of candidates) {
      const data = await this.readAuthProfiles(filePath, { missingOk: true });
      if (data) {
        existingPaths.push(filePath);
      }
    }

    return existingPaths;
  }

  authProfilesPathForWorkspace(workspace: string): string {
    return path.join(workspace, "agent", "auth-profiles.json");
  }

  async readAuthProfiles(
    filePath: string,
    options?: { missingOk?: boolean },
  ): Promise<AuthProfilesData | null> {
    try {
      const content = await readFile(filePath, "utf8");
      return parseAuthProfilesData(content, filePath);
    } catch (error) {
      if (isMissingFileError(error) && options?.missingOk) {
        return null;
      }
      throw error;
    }
  }

  async updateAuthProfiles(
    filePath: string,
    updater: (
      current: AuthProfilesData,
    ) => AuthProfilesData | Promise<AuthProfilesData>,
  ): Promise<void> {
    const previous = this.updateQueues.get(filePath) ?? Promise.resolve();
    const updatePromise = previous
      .catch(() => {})
      .then(async () => {
        const current =
          (await this.readAuthProfiles(filePath, { missingOk: true })) ??
          createEmptyAuthProfilesData();
        const next = await updater(current);
        await mkdir(path.dirname(filePath), { recursive: true });
        await writeFile(filePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
      });

    this.updateQueues.set(filePath, updatePromise);
    try {
      await updatePromise;
    } finally {
      if (this.updateQueues.get(filePath) === updatePromise) {
        this.updateQueues.delete(filePath);
      }
    }
  }

  async getOAuthConnectionState(): Promise<OAuthConnectionState> {
    const connectedProviderIds = new Set<string>();
    const filePaths = await this.listAgentAuthProfilesPaths();

    for (const filePath of filePaths) {
      const data = await this.readAuthProfiles(filePath, { missingOk: true });
      if (!data) {
        continue;
      }

      for (const profile of Object.values(data.profiles)) {
        if (typeof profile !== "object" || profile === null) {
          continue;
        }
        const typed = profile as Record<string, unknown>;
        if (typed.type !== "oauth") {
          continue;
        }
        const provider =
          typeof typed.provider === "string" ? typed.provider : undefined;
        const expiresAt =
          typeof typed.expires === "number" ? typed.expires : undefined;
        const providerId =
          provider === undefined ? undefined : OAUTH_PROVIDER_ID_MAP[provider];
        if (!providerId || expiresAt === undefined || expiresAt <= Date.now()) {
          continue;
        }
        connectedProviderIds.add(providerId);
      }
    }

    return {
      connectedProviderIds: [...connectedProviderIds].sort(),
    };
  }
}
