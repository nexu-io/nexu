import { beforeEach, describe, expect, it, vi } from "vitest";

const { identifyMock, resetMock, registerMock, initMock } = vi.hoisted(() => ({
  identifyMock: vi.fn(),
  resetMock: vi.fn(),
  registerMock: vi.fn(),
  initMock: vi.fn(),
}));

vi.mock("posthog-js", () => ({
  default: {
    init: initMock,
    identify: identifyMock,
    reset: resetMock,
    register: registerMock,
    capture: vi.fn(),
    setPersonProperties: vi.fn(),
  },
}));

import {
  identifyAuthenticatedUser,
  initializeAnalytics,
  resetAnalytics,
} from "../src/lib/tracking";

describe("tracking identity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAnalytics();
  });

  it("identifies with backend user id and person properties in one call", () => {
    initializeAnalytics({
      apiKey: "phc_test",
      environment: "test",
      appName: "nexu-web",
      appVersion: "1.0.0",
    });

    identifyAuthenticatedUser("user_123", {
      email: "user@nexu.io",
      name: "Nexu User",
    });

    expect(identifyMock).toHaveBeenCalledTimes(1);
    expect(identifyMock).toHaveBeenCalledWith("user_123", {
      email: "user@nexu.io",
      name: "Nexu User",
    });
  });

  it("does not re-identify when user id and props are unchanged", () => {
    initializeAnalytics({
      apiKey: "phc_test",
      environment: "test",
    });

    identifyAuthenticatedUser("user_123", {
      email: "user@nexu.io",
      name: "Nexu User",
    });
    identifyAuthenticatedUser("user_123", {
      name: "Nexu User",
      email: "user@nexu.io",
    });

    expect(identifyMock).toHaveBeenCalledTimes(1);
  });

  it("resets identity on logout", () => {
    initializeAnalytics({
      apiKey: "phc_test",
      environment: "test",
    });
    resetMock.mockClear();

    identifyAuthenticatedUser("user_123", {
      email: "user@nexu.io",
      name: "Nexu User",
    });
    resetAnalytics();

    expect(resetMock).toHaveBeenCalledTimes(1);
  });
});
