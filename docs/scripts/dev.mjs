import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const docsDir = path.resolve(__dirname, "..");
const vitepressCliPath = path.join(
  docsDir,
  "node_modules",
  "vitepress",
  "bin",
  "vitepress.js",
);

const commands = [
  {
    name: "assets",
    command: process.execPath,
    args: ["./scripts/watch-assets.mjs"],
  },
  {
    name: "vitepress",
    command: process.execPath,
    args: [vitepressCliPath, "dev", ".", "--host", "0.0.0.0"],
  },
];

const children = [];
let isShuttingDown = false;

function shutdown(code = 0) {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;

  for (const child of children) {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }

  setTimeout(() => {
    for (const child of children) {
      if (!child.killed) {
        child.kill("SIGKILL");
      }
    }
  }, 1000).unref();

  process.exitCode = code;
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => shutdown(0));
}

for (const entry of commands) {
  const child = spawn(entry.command, entry.args, {
    cwd: docsDir,
    stdio: "inherit",
  });

  children.push(child);

  child.on("exit", (code, signal) => {
    if (isShuttingDown) {
      return;
    }

    if (signal !== null) {
      console.error(`[docs:${entry.name}] exited from signal ${signal}`);
      shutdown(1);
      return;
    }

    if ((code ?? 0) !== 0) {
      console.error(`[docs:${entry.name}] exited with code ${code}`);
      shutdown(code ?? 1);
      return;
    }

    console.error(`[docs:${entry.name}] exited unexpectedly`);
    shutdown(0);
  });
}
