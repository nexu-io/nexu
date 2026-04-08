import crypto from "node:crypto";
import { z } from "zod";
import { proxyFetch } from "../lib/proxy-fetch.js";

const GITHUB_STARS_API = "https://api.github.com/repos/nexu-io/nexu";
const GITHUB_STAR_SESSION_TTL_MS = 15 * 60 * 1000;
const GITHUB_STAR_MIN_VERIFICATION_AGE_MS = 10 * 1000;

const githubRepoSchema = z.object({
  stargazers_count: z.number().int().nonnegative(),
});

type GithubStarSession = {
  baselineStars: number;
  createdAt: number;
  expiresAt: number;
};

export type PrepareGithubStarSessionResult = {
  sessionId: string;
  baselineStars: number;
  expiresAt: string;
};

export type VerifyGithubStarSessionResult =
  | { ok: true; currentStars: number }
  | {
      ok: false;
      reason: "missing" | "expired" | "not_increased" | "too_early";
    };

export class GithubStarVerificationService {
  private readonly sessions = new Map<string, GithubStarSession>();

  async prepareSession(): Promise<PrepareGithubStarSessionResult> {
    // Best-effort baseline fetch — don't fail the whole flow if GitHub
    // is rate-limited or unreachable. The trust-based verify path below
    // does not actually use the baseline, so any value is acceptable.
    let baselineStars = 0;
    try {
      baselineStars = await this.fetchStars();
    } catch {
      // ignore — proceed with baseline 0
    }
    const sessionId = crypto.randomUUID();
    const createdAt = Date.now();
    const expiresAt = Date.now() + GITHUB_STAR_SESSION_TTL_MS;

    this.sessions.set(sessionId, { baselineStars, createdAt, expiresAt });

    return {
      sessionId,
      baselineStars,
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }

  async verifySession(
    sessionId: string,
  ): Promise<VerifyGithubStarSessionResult> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { ok: false, reason: "missing" };
    }

    if (session.expiresAt < Date.now()) {
      this.sessions.delete(sessionId);
      return { ok: false, reason: "expired" };
    }

    if (Date.now() - session.createdAt < GITHUB_STAR_MIN_VERIFICATION_AGE_MS) {
      return { ok: false, reason: "too_early" };
    }

    // Trust-based: skip the live GitHub API check. The desktop frontend
    // opens the GitHub repo page and waits 10 seconds before calling claim,
    // which is long enough for the user to star but too long to call this
    // an instant grant. The minimum age is enforced server-side so API
    // callers cannot bypass it. We deliberately avoid hitting the GitHub
    // API here because the public stars endpoint is rate-limited (60/hr
    // unauthed) and the star count is not real-time, so verification
    // routinely fails immediately after the user actually stars.
    this.sessions.delete(sessionId);
    return { ok: true, currentStars: session.baselineStars };
  }

  private async fetchStars(): Promise<number> {
    const token = process.env.NEXU_GITHUB_TOKEN?.trim();
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "User-Agent": "nexu-desktop",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await proxyFetch(GITHUB_STARS_API, {
      headers,
      timeoutMs: 10_000,
    });

    if (!response.ok) {
      const remaining = response.headers.get("x-ratelimit-remaining");
      const reset = response.headers.get("x-ratelimit-reset");
      const authed = token ? "yes" : "no";
      const suffix =
        remaining !== null
          ? ` (remaining=${remaining} reset=${reset} authed=${authed})`
          : ` (authed=${authed})`;
      throw new Error(
        `Failed to fetch GitHub stars: ${response.status}${suffix}`,
      );
    }

    const parsed = githubRepoSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new Error("Failed to parse GitHub stars response");
    }

    return parsed.data.stargazers_count;
  }
}
