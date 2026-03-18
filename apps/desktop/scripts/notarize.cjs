const { access } = require("node:fs/promises");
const { constants } = require("node:fs");
const path = require("node:path");

module.exports = async function notarize(context) {
  if (context.electronPlatformName !== "darwin") {
    return;
  }

  const unsignedMode =
    process.env.NEXU_DESKTOP_MAC_UNSIGNED === "1" ||
    process.env.NEXU_DESKTOP_MAC_UNSIGNED === "true";

  if (unsignedMode) {
    console.log("[notarize] skipping notarization in unsigned mode");
    return;
  }

  const appleId = process.env.NEXU_APPLE_ID ?? process.env.APPLE_ID;
  const appleIdPassword =
    process.env.NEXU_APPLE_APP_SPECIFIC_PASSWORD ??
    process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.NEXU_APPLE_TEAM_ID ?? process.env.APPLE_TEAM_ID;
  const missingEnv = [
    ["NEXU_APPLE_ID", appleId],
    ["NEXU_APPLE_APP_SPECIFIC_PASSWORD", appleIdPassword],
    ["NEXU_APPLE_TEAM_ID", teamId],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missingEnv.length > 0) {
    console.log(
      `[notarize] skipping notarization; missing env: ${missingEnv.join(", ")}`,
    );
    return;
  }

  const productFilename = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${productFilename}.app`);

  try {
    await access(appPath, constants.F_OK);
  } catch {
    console.log(
      `[notarize] skipping notarization; app not found at ${appPath}`,
    );
    return;
  }

  const { notarize: notarizeApp } = await import("@electron/notarize");

  await notarizeApp({
    appPath,
    appleId,
    appleIdPassword,
    teamId,
  });
};
