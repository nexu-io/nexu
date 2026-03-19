export function hasSecretValue(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function redactSecret(value: string | null | undefined): string | null {
  if (!hasSecretValue(value)) {
    return null;
  }

  return "***";
}
