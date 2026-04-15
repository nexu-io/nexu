import { describe, expect, it } from "vitest";

import { isAlreadyRunningStartError } from "../../tools/dev/src/shared/default-start";

describe("isAlreadyRunningStartError", () => {
  it("matches the standard already-running message for the same target", () => {
    expect(
      isAlreadyRunningStartError(
        "openclaw",
        new Error(
          "openclaw dev process is already running; run `pnpm dev stop openclaw` first",
        ),
      ),
    ).toBe(true);
  });

  it("does not match already-running errors for a different target", () => {
    expect(
      isAlreadyRunningStartError(
        "controller",
        new Error(
          "openclaw dev process is already running; run `pnpm dev stop openclaw` first",
        ),
      ),
    ).toBe(false);
  });

  it("ignores unrelated failures", () => {
    expect(
      isAlreadyRunningStartError(
        "web",
        new Error("web dev server failed health check"),
      ),
    ).toBe(false);
  });
});
