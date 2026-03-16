const { access, mkdtemp, rm, writeFile } = require("node:fs/promises");
const { constants } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `${command} ${args.join(" ")} exited with code ${code ?? "null"}.`,
        ),
      );
    });
  });
}

module.exports = async function notarize(context) {
  if (context.electronPlatformName !== "darwin") {
    return;
  }

  const requiredEnv = ["APPLE_API_KEY", "APPLE_API_KEY_ID", "APPLE_API_ISSUER"];
  const missingEnv = requiredEnv.filter((name) => !process.env[name]);

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

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "nexu-notary-"));
  const apiKeyPath = path.join(tempDir, "AuthKey.p8");
  const zipPath = path.join(tempDir, `${productFilename}.zip`);

  try {
    await writeFile(
      apiKeyPath,
      process.env.APPLE_API_KEY.replace(/\\n/g, "\n"),
    );

    await run("ditto", [
      "-c",
      "-k",
      "--sequesterRsrc",
      "--keepParent",
      appPath,
      zipPath,
    ]);

    const submitArgs = [
      "notarytool",
      "submit",
      zipPath,
      "--wait",
      "--issuer",
      process.env.APPLE_API_ISSUER,
      "--key-id",
      process.env.APPLE_API_KEY_ID,
      "--key",
      apiKeyPath,
    ];

    if (process.env.APPLE_TEAM_ID) {
      submitArgs.push("--team-id", process.env.APPLE_TEAM_ID);
    }

    await run("xcrun", submitArgs);
    await run("xcrun", ["stapler", "staple", appPath]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
};
