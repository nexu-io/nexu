type PostHogIdentityInput = {
  userId?: string | null;
  userEmail?: string | null;
  userName?: string | null;
};

export type DesktopPostHogIdentityState = {
  currentUserId: string | null;
  currentIdentifyKey: string | null;
};

type PostHogIdentityClient = {
  identify: (
    userId: string,
    properties: { email: string | null; name: string | null },
  ) => void;
  reset: () => void;
  register: (properties: Record<string, string>) => void;
};

export function buildPostHogPersonPropertiesKey(input: {
  email?: string | null;
  name?: string | null;
}): string {
  return JSON.stringify([
    ["email", input.email ?? null],
    ["name", input.name ?? null],
  ]);
}

export function syncDesktopPostHogIdentity(
  client: PostHogIdentityClient,
  superProperties: Record<string, string>,
  state: DesktopPostHogIdentityState,
  input: PostHogIdentityInput,
): DesktopPostHogIdentityState {
  const userId =
    typeof input.userId === "string" && input.userId.trim().length > 0
      ? input.userId
      : null;

  if (!userId) {
    if (state.currentUserId === null) {
      return state;
    }

    client.reset();
    client.register(superProperties);
    return {
      currentUserId: null,
      currentIdentifyKey: null,
    };
  }

  const nextIdentifyKey = JSON.stringify([
    userId,
    buildPostHogPersonPropertiesKey({
      email: input.userEmail ?? null,
      name: input.userName ?? null,
    }),
  ]);

  if (state.currentIdentifyKey === nextIdentifyKey) {
    return state;
  }

  if (state.currentUserId && state.currentUserId !== userId) {
    client.reset();
    client.register(superProperties);
  }

  client.identify(userId, {
    email: input.userEmail ?? null,
    name: input.userName ?? null,
  });

  return {
    currentUserId: userId,
    currentIdentifyKey: nextIdentifyKey,
  };
}
