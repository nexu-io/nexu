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
import type { ControllerBindings } from "../types.js";

const errorResponseSchema = z.object({
  message: z.string(),
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
      return c.json({ message: GITHUB_STAR_REWARD_DISABLED_MESSAGE }, 400);
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
        return c.json({ message: GITHUB_STAR_REWARD_DISABLED_MESSAGE }, 400);
      }

      return c.json(
        await container.configStore.claimDesktopReward(body.taskId, body.proof),
        200,
      );
    },
  );
}
