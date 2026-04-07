type Ensure = {
  orThrow: (createError: () => Error) => void;
};

export function ensure(condition: boolean): Ensure {
  return {
    orThrow(createError) {
      if (!condition) {
        throw createError();
      }
    },
  };
}
