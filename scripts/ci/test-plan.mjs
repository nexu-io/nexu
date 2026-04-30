#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import path from "node:path";

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function hasRef(ref) {
  try {
    git(["rev-parse", "--verify", ref]);
    return true;
  } catch {
    return false;
  }
}

function ensureBaseRefAvailable(baseRef) {
  const remoteRef = `origin/${baseRef}`;
  if (hasRef(remoteRef)) {
    return remoteRef;
  }

  git([
    "fetch",
    "--no-tags",
    "--depth=1",
    "origin",
    `refs/heads/${baseRef}:refs/remotes/${remoteRef}`,
  ]);

  return remoteRef;
}

function listChangedFiles() {
  const eventName = process.env.GITHUB_EVENT_NAME;
  if (eventName !== "pull_request") {
    return [];
  }

  const baseRef = process.env.GITHUB_BASE_REF || "main";
  const availableBaseRef = ensureBaseRefAvailable(baseRef);
  const mergeBase = git(["merge-base", "HEAD", availableBaseRef]);
  const diff = git(["diff", "--name-only", `${mergeBase}...HEAD`]);
  return diff ? diff.split("\n").filter(Boolean) : [];
}

const CORE_SMOKE_TESTS = [
  "tests/controller/runtime-stability-regressions.test.ts",
  "tests/controller/nexu-credit-guard.test.ts",
  "tests/controller/desktop-rewards-share-templates.test.ts",
  "tests/controller/provider-oauth-routes.test.ts",
  "tests/web/home.test.tsx",
  "tests/web/budget-banner-dismissal.test.tsx",
  "tests/web/workspace-layout-platform.test.tsx",
  "tests/web/desktop-links.test.ts",
  "tests/dev/stale-port-recovery.test.ts",
  "tests/desktop/launchd-manager-ops.test.ts",
  "tests/desktop/webview-preload-url.test.ts",
  "tests/desktop/develop-set-balance-dialog.test.ts",
  "tests/desktop/model-selection.test.ts",
  "tests/desktop/runtime-config.test.ts",
];

const EXTENDED_GLOBS = [
  "tests/extended/",
  "tests/desktop/launchd-",
  "tests/desktop/update-server-integration.test.ts",
  "tests/desktop/skill-dir-watcher",
  "tests/desktop/daemon-supervisor",
  "tests/desktop/lifecycle-teardown.test.ts",
];

const FULL_TEST_PATH_PREFIXES = [
  "packages/shared/",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.base.json",
  "vitest.config.ts",
  "vitest.core.config.ts",
  "vitest.extended.config.ts",
  ".github/workflows/ci.yml",
];

const TARGET_MAP = [
  {
    match: (file) => file.startsWith("apps/controller/static/runtime-plugins/"),
    tests: ["tests/controller/nexu-credit-guard.test.ts"],
  },
  {
    match: (file) =>
      file === "apps/controller/src/lib/openclaw-config-compiler.ts" ||
      file === "apps/controller/src/services/openclaw-sync-service.ts",
    tests: [
      "tests/controller/runtime-stability-regressions.test.ts",
      "tests/desktop/openclaw-config-compiler.test.ts",
      "tests/desktop/model-selection.test.ts",
    ],
  },
  {
    match: (file) =>
      file === "apps/controller/src/services/skillhub/skill-dir-watcher.ts" ||
      file.startsWith("apps/controller/src/services/skillhub/"),
    tests: [
      "tests/desktop/skill-dir-watcher.test.ts",
      "tests/desktop/skill-dir-watcher-workspace.test.ts",
    ],
  },
  {
    match: (file) =>
      file === "apps/web/src/layouts/workspace-layout.tsx" ||
      file === "apps/web/src/lib/desktop-platform.ts",
    tests: ["tests/web/workspace-layout-platform.test.tsx"],
  },
  {
    match: (file) => file === "apps/web/src/lib/desktop-links.ts",
    tests: ["tests/web/desktop-links.test.ts"],
  },
  {
    match: (file) => file.startsWith("scripts/dev/"),
    tests: ["tests/dev/stale-port-recovery.test.ts"],
  },
  {
    match: (file) => file.startsWith("apps/desktop/main/services/launchd-"),
    tests: [
      "tests/desktop/launchd-manager-ops.test.ts",
      "tests/desktop/launchd-bootstrap-edge.test.ts",
      "tests/desktop/launchd-bootstrap.test.ts",
    ],
  },
  {
    match: (file) => file.startsWith("tests/"),
    tests: [],
  },
];

const E2E_RELEVANT_PREFIXES = [
  "apps/desktop/",
  "e2e/desktop/",
  "openclaw-runtime/",
  "openclaw-runtime-patches/",
  "scripts/desktop-",
  "scripts/dev-launchd.sh",
  "package.json",
  "pnpm-lock.yaml",
  "apps/controller/src/runtime/",
  "apps/controller/src/lib/openclaw-config-compiler.ts",
  "apps/controller/src/services/openclaw-sync-service.ts",
  "apps/controller/src/routes/desktop-",
  "apps/web/src/layouts/workspace-layout.tsx",
  "apps/web/src/lib/desktop-links.ts",
  "apps/web/src/hooks/use-cloud-connect.ts",
  "apps/web/src/pages/models.tsx",
  "apps/web/src/pages/rewards.tsx",
];

function isExtendedTest(file) {
  return (
    EXTENDED_GLOBS.some((pattern) => file.startsWith(pattern)) ||
    file.includes(".extended.test.")
  );
}

function listAllTests() {
  const files = git(["ls-files", "tests"]);
  return files
    .split("\n")
    .filter(Boolean)
    .filter((file) => /\.test\.(ts|tsx)$/.test(file));
}

function toSearchTokens(file) {
  const parsed = path.parse(file);
  const stem = parsed.name.replace(/\.test$/, "");
  const parts = file.split("/").filter(Boolean);
  const basenameTokens = stem.split(/[-_.]/).filter((part) => part.length >= 4);
  const dirTokens = parts
    .slice(-3, -1)
    .flatMap((part) => part.split(/[-_.]/))
    .filter((part) => part.length >= 4);
  return [...new Set([stem, ...basenameTokens, ...dirTokens])];
}

function discoverMatchingTests(changedFiles, allTests) {
  const selected = new Set();

  for (const file of changedFiles) {
    const tokens = toSearchTokens(file);
    for (const testFile of allTests) {
      if (isExtendedTest(testFile)) continue;
      const normalized = testFile.toLowerCase();
      if (tokens.some((token) => normalized.includes(token.toLowerCase()))) {
        selected.add(testFile);
      }
    }
  }

  return selected;
}

function selectTests(changedFiles) {
  if (
    changedFiles.some((file) =>
      FULL_TEST_PATH_PREFIXES.some((prefix) => file.startsWith(prefix)),
    )
  ) {
    return { runFull: true, tests: [] };
  }

  const allTests = listAllTests();
  const selected = new Set(CORE_SMOKE_TESTS);
  for (const discovered of discoverMatchingTests(changedFiles, allTests)) {
    selected.add(discovered);
  }
  for (const file of changedFiles) {
    if (file.startsWith("tests/") && !isExtendedTest(file)) {
      selected.add(file);
    }
    for (const mapping of TARGET_MAP) {
      if (mapping.match(file)) {
        for (const testFile of mapping.tests) {
          if (!isExtendedTest(testFile)) {
            selected.add(testFile);
          }
        }
      }
    }
  }

  return { runFull: false, tests: [...selected].sort() };
}

function shouldRunDesktopE2E(changedFiles) {
  if (process.env.GITHUB_EVENT_NAME !== "pull_request") {
    return true;
  }
  return changedFiles.some((file) =>
    E2E_RELEVANT_PREFIXES.some((prefix) => file.startsWith(prefix)),
  );
}

function emit(name, value) {
  const outputFile = process.env.GITHUB_OUTPUT;
  const line = `${name}=${value}\n`;
  if (outputFile) {
    appendFileSync(outputFile, line);
  } else {
    process.stdout.write(line);
  }
}

const changedFiles = listChangedFiles();
const { runFull, tests } = selectTests(changedFiles);
const eventName = process.env.GITHUB_EVENT_NAME;

const testCommand =
  eventName === "pull_request"
    ? runFull
      ? "pnpm test:all"
      : `pnpm exec vitest run ${tests.map((file) => JSON.stringify(file)).join(" ")}`
    : "pnpm test:all";

emit("run_full_tests", runFull ? "true" : "false");
emit("test_command", testCommand);
emit("selected_tests", tests.join(","));
emit("run_desktop_e2e", shouldRunDesktopE2E(changedFiles) ? "true" : "false");
