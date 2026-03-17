import { cp, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  copyRuntimeDependencyClosure,
  electronRoot,
  getSidecarRoot,
  linkOrCopyDirectory,
  pathExists,
  removePathIfExists,
  repoRoot,
  resetDir,
  shouldCopyRuntimeDependencies,
} from "./lib/sidecar-paths.mjs";

const sidecarRoot = getSidecarRoot("pglite");
const sidecarNodeModules = resolve(sidecarRoot, "node_modules");
const electronNodeModules = resolve(electronRoot, "node_modules");
const migrationsRoot = resolve(repoRoot, "apps/api/migrations");

async function preparePgliteSidecar() {
  if (!(await pathExists(electronNodeModules))) {
    throw new Error(
      "Missing electron/node_modules. Install electron dependencies first.",
    );
  }

  await resetDir(sidecarRoot);

  await writeFile(
    resolve(sidecarRoot, "package.json"),
    `${JSON.stringify({ name: "pglite-sidecar", private: true, type: "module" }, null, 2)}\n`,
  );

  await writeFile(
    resolve(sidecarRoot, "index.js"),
    `import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const host = process.env.PGLITE_HOST ?? "127.0.0.1";
const port = Number.parseInt(process.env.PGLITE_PORT ?? "50832", 10);
const dataDir = process.env.PGLITE_DATA_DIR;
const migrationsDir = process.env.PGLITE_MIGRATIONS_DIR;

if (!dataDir) {
  throw new Error("PGLITE_DATA_DIR is required.");
}

console.log(
  JSON.stringify({
    event: "pglite_boot",
    dataDir,
    migrationsDir,
    host,
    port,
  })
);

const db = await PGlite.create({ dataDir });

async function runMigrations() {
  if (!migrationsDir) {
    return;
  }

  await db.exec(\`create table if not exists desktop_sidecar_migrations (
    name text primary key,
    applied_at text not null
  )\`);

  const rows = await db.query("select name from desktop_sidecar_migrations");
  const applied = new Set(rows.rows.map((row) => row.name));
  const files = (await readdir(migrationsDir))
    .filter((name) => name.endsWith(".sql"))
    .sort();

  for (const file of files) {
    if (applied.has(file)) {
      continue;
    }

    const sql = await readFile(join(migrationsDir, file), "utf8");
    const statements = sql
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter(Boolean);

    for (const statement of statements) {
      await db.exec(statement);
    }

      await db.query("insert into desktop_sidecar_migrations (name, applied_at) values ($1, $2)", [
        file,
        new Date().toISOString(),
      ]);
    console.log(\`Applied migration \${file}\`);
  }
}

await runMigrations();

const server = new PGLiteSocketServer({
  db,
  host,
  port,
  maxConnections: 32,
});

server.addEventListener("listening", (event) => {
  const detail = event.detail ?? { host, port };
  console.log(\`PGLiteSocketServer listening on \${JSON.stringify(detail)}\`);
});

await server.start();

async function shutdown() {
  await server.stop();
  await db.close();
  process.exit(0);
}

process.on("SIGTERM", () => {
  void shutdown();
});

process.on("SIGINT", () => {
  void shutdown();
});
`,
  );

  if (await pathExists(migrationsRoot)) {
    await cp(migrationsRoot, resolve(sidecarRoot, "migrations"), {
      recursive: true,
    });
  }

  if (shouldCopyRuntimeDependencies()) {
    await copyRuntimeDependencyClosure({
      packageRoot: electronRoot,
      targetNodeModules: sidecarNodeModules,
      dependencyNames: ["@electric-sql/pglite", "@electric-sql/pglite-socket"],
    });
  } else {
    await linkOrCopyDirectory(electronNodeModules, sidecarNodeModules);
    await removePathIfExists(resolve(sidecarNodeModules, "electron"));
    await removePathIfExists(resolve(sidecarNodeModules, "electron-builder"));
  }
}

await preparePgliteSidecar();
