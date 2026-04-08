import { type OpenAPIHono, createRoute } from "@hono/zod-openapi";
import {
  claimDesktopRewardRequestSchema,
  claimDesktopRewardResponseSchema,
  desktopRewardsStatusSchema,
  prepareGithubStarSessionRequestSchema,
  prepareGithubStarSessionResponseSchema,
  rewardTaskRequiresGithubStarSession,
  rewardTaskRequiresUrlProof,
  validateRewardProofUrl,
} from "@nexu/shared";
import { z } from "zod";
import type { ControllerContainer } from "../app/container.js";
import { logger } from "../lib/logger.js";
import type { ControllerBindings } from "../types.js";

const errorResponseSchema = z.object({
  message: z.string(),
});
const setDesktopRewardBalanceRequestSchema = z.object({
  balance: z.number().int().nonnegative(),
});
const GITHUB_STAR_REWARD_DISABLED_MESSAGE =
  "GitHub star reward is temporarily unavailable";

export function registerDesktopRewardsRoutes(
  app: OpenAPIHono<ControllerBindings>,
  container: ControllerContainer,
): void {
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/internal/desktop/rewards",
      tags: ["Desktop"],
      responses: {
        200: {
          content: {
            "application/json": { schema: desktopRewardsStatusSchema },
          },
          description: "Desktop rewards status",
        },
      },
    }),
    async (c) => {
      const status = await container.configStore.getDesktopRewardsStatus();
      return c.json(status, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/internal/desktop/rewards/github-star-session",
      tags: ["Desktop"],
      request: {
        body: {
          content: {
            "application/json": {
              schema: prepareGithubStarSessionRequestSchema,
            },
          },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": {
              schema: prepareGithubStarSessionResponseSchema,
            },
          },
          description: "Prepare a GitHub star verification session",
        },
        400: {
          content: {
            "application/json": { schema: errorResponseSchema },
          },
          description: "GitHub star verification is temporarily unavailable",
        },
      },
    }),
    async (c) => {
      try {
        const result =
          await container.githubStarVerificationService.prepareSession();
        return c.json(result, 200);
      } catch (error) {
        logger.warn(
          { error: error instanceof Error ? error.message : String(error) },
          "github_star_session_failed",
        );
        return c.json({ message: GITHUB_STAR_REWARD_DISABLED_MESSAGE }, 400);
      }
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/internal/desktop/rewards/claim",
      tags: ["Desktop"],
      request: {
        body: {
          content: {
            "application/json": {
              schema: claimDesktopRewardRequestSchema,
            },
          },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: claimDesktopRewardResponseSchema },
          },
          description: "Claim a desktop reward",
        },
        400: {
          content: {
            "application/json": { schema: errorResponseSchema },
          },
          description: "Invalid claim proof",
        },
      },
    }),
    async (c) => {
      const body = c.req.valid("json");
      const proofUrl = body.proof?.url?.trim();

      if (rewardTaskRequiresUrlProof(body.taskId)) {
        if (!proofUrl || !validateRewardProofUrl(body.taskId, proofUrl)) {
          return c.json({ message: "Invalid proof URL for reward task" }, 400);
        }
      }

      if (rewardTaskRequiresGithubStarSession(body.taskId)) {
        const sessionId = body.proof?.githubSessionId;
        if (!sessionId) {
          return c.json({ message: "Missing GitHub star session" }, 400);
        }
        const verifyResult =
          await container.githubStarVerificationService.verifySession(
            sessionId,
          );
        if (!verifyResult.ok) {
          const reason =
            verifyResult.reason === "not_increased"
              ? "You haven't starred the repository yet"
              : verifyResult.reason === "expired"
                ? "Session expired, please start over"
                : "Invalid session";
          return c.json({ message: reason }, 400);
        }
      }

      return c.json(
        await container.configStore.claimDesktopReward(body.taskId, body.proof),
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/internal/desktop/rewards/set-balance",
      tags: ["Desktop"],
      request: {
        body: {
          content: {
            "application/json": {
              schema: setDesktopRewardBalanceRequestSchema,
            },
          },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: desktopRewardsStatusSchema },
          },
          description: "Update the desktop test balance",
        },
        400: {
          content: {
            "application/json": { schema: errorResponseSchema },
          },
          description: "Unable to update the desktop test balance",
        },
      },
    }),
    async (c) => {
      const body = c.req.valid("json");

      try {
        return c.json(
          await container.configStore.setDesktopRewardBalance(body.balance),
          200,
        );
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Unable to update the desktop test balance";
        logger.warn(
          { error: error instanceof Error ? error.message : String(error) },
          "desktop_reward_balance_update_failed",
        );
        return c.json({ message }, 400);
      }
    },
  );
}
