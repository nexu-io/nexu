import { spawn } from "node:child_process";

const repoRoot = process.cwd();
const children = [];
let shuttingDown = false;

function createCommand(command, args) {
  if (process.platform === "win32") {
    return {
      command: "cmd.exe",
      args: ["/d", "/s", "/c", [command, ...args].join(" ")],
    };
  }

  return { command, args };
}

function createNodeOptions() {
  const existing = process.env.NODE_OPTIONS?.trim();
  return existing
    ? `${existing} --conditions=development`
    : "--conditions=development";
}

function terminateChild(child) {
  if (!child.pid) {
    return;
  }

  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
    });
    killer.once("error", () => {});
    return;
  }

  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {}
  }
}

function shutdown(exitCode = 0) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  for (const child of children) {
    terminateChild(child);
  }

  setTimeout(() => {
    process.exit(exitCode);
  }, 250).unref();
}

function startProcess(args) {
  const commandSpec = createCommand("pnpm", args);
  const child = spawn(commandSpec.command, commandSpec.args, {
    cwd: repoRoot,
    env: {
      ...process.env,
      NODE_OPTIONS: createNodeOptions(),
    },
    stdio: "inherit",
    detached: process.platform !== "win32",
  });

  child.once("error", (error) => {
    console.error(error instanceof Error ? error.message : String(error));
    shutdown(1);
  });

  child.once("exit", (code, signal) => {
    if (shuttingDown) {
      return;
    }

    if (signal) {
      console.error(`dev process exited from signal ${signal}`);
      shutdown(1);
      return;
    }

    shutdown(code ?? 1);
  });

  children.push(child);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

startProcess(["--filter", "@nexu/controller", "dev"]);
startProcess(["--filter", "@nexu/web", "dev"]);
