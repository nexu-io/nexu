import { describe, expect, it, vi } from "vitest";
import {
  buildPostHogPersonPropertiesKey,
  syncDesktopPostHogIdentity,
} from "../../apps/desktop/src/lib/posthog-identity";

describe("syncDesktopPostHogIdentity", () => {
  const superProperties = {
    environment: "test",
    appName: "nexu-desktop",
    appVersion: "1.2.3",
  };

  it("identifies an authenticated user with email and name", () => {
    const client = {
      identify: vi.fn(),
      reset: vi.fn(),
      register: vi.fn(),
    };

    const nextState = syncDesktopPostHogIdentity(
      client,
      superProperties,
      {
        currentUserId: null,
        currentIdentifyKey: null,
      },
      {
        userId: "user-123",
        userEmail: "user@nexu.io",
        userName: "Nexu User",
      },
    );

    expect(client.identify).toHaveBeenCalledWith("user-123", {
      email: "user@nexu.io",
      name: "Nexu User",
    });
    expect(nextState.currentUserId).toBe("user-123");
  });

  it("does not re-identify when the same user and properties are synced again", () => {
    const client = {
      identify: vi.fn(),
      reset: vi.fn(),
      register: vi.fn(),
    };
    const state = {
      currentUserId: "user-123",
      currentIdentifyKey: JSON.stringify([
        "user-123",
        buildPostHogPersonPropertiesKey({
          email: "user@nexu.io",
          name: "Nexu User",
        }),
      ]),
    };

    const nextState = syncDesktopPostHogIdentity(
      client,
      superProperties,
      state,
      {
        userId: "user-123",
        userEmail: "user@nexu.io",
        userName: "Nexu User",
      },
    );

    expect(client.identify).not.toHaveBeenCalled();
    expect(nextState).toBe(state);
  });

  it("resets and re-registers when switching users", () => {
    const client = {
      identify: vi.fn(),
      reset: vi.fn(),
      register: vi.fn(),
    };

    syncDesktopPostHogIdentity(
      client,
      superProperties,
      {
        currentUserId: "user-123",
        currentIdentifyKey: "old-key",
      },
      {
        userId: "user-456",
        userEmail: "next@nexu.io",
        userName: "Next User",
      },
    );

    expect(client.reset).toHaveBeenCalledTimes(1);
    expect(client.register).toHaveBeenCalledWith(superProperties);
    expect(client.identify).toHaveBeenCalledWith("user-456", {
      email: "next@nexu.io",
      name: "Next User",
    });
  });

  it("resets to anonymous on logout", () => {
    const client = {
      identify: vi.fn(),
      reset: vi.fn(),
      register: vi.fn(),
    };

    const nextState = syncDesktopPostHogIdentity(
      client,
      superProperties,
      {
        currentUserId: "user-123",
        currentIdentifyKey: "old-key",
      },
      {
        userId: null,
      },
    );

    expect(client.reset).toHaveBeenCalledTimes(1);
    expect(client.register).toHaveBeenCalledWith(superProperties);
    expect(nextState).toEqual({
      currentUserId: null,
      currentIdentifyKey: null,
    });
  });
});
