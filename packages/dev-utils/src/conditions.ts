type WaitForOptions = {
  attempts?: number;
  delayMs?: number;
};

export async function waitFor<T>(
  attempt: () => Promise<T> | T,
  createError: () => Error,
  options: WaitForOptions = {},
): Promise<T> {
  const attempts = options.attempts ?? 20;
  const delayMs = options.delayMs ?? 250;

  for (let index = 0; index < attempts; index += 1) {
    try {
      return await attempt();
    } catch {
      if (index === attempts - 1) {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw createError();
}
