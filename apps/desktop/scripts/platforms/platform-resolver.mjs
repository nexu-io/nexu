import {
  NEXU_TARGET_PLATFORM_ENV,
  isDesktopRuntimePlatform,
  resolveDesktopRuntimePlatform,
} from "./desktop-platform.mjs";

export function readBuildTargetPlatformEnv(env = process.env) {
  const value = env[NEXU_TARGET_PLATFORM_ENV];
  if (value === undefined || value === "") {
    return null;
  }

  if (isDesktopRuntimePlatform(value)) {
    return value;
  }

  throw new Error(
    `Unsupported ${NEXU_TARGET_PLATFORM_ENV} value: ${value}. Expected "mac" or "win".`,
  );
}

export function resolveBuildTargetPlatform({
  env = process.env,
  allowPlatformFallback = true,
  platform = process.platform,
} = {}) {
  const explicitTarget = readBuildTargetPlatformEnv(env);
  if (explicitTarget) {
    return explicitTarget;
  }

  if (!allowPlatformFallback) {
    throw new Error(
      `Missing ${NEXU_TARGET_PLATFORM_ENV}. Build target platform must be provided explicitly in this context.`,
    );
  }

  return resolveDesktopRuntimePlatform(platform);
}

export function assertSupportedBuildTargetPlatform(options) {
  return resolveBuildTargetPlatform(options);
}
