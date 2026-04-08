import path from "node:path";
import { fileURLToPath } from "node:url";

import runtimeMaintenance from "./runtime-maintenance.cjs";
import runtimePolicy from "./runtime-policy.cjs";

const { refreshRepoLocalOpenClawRuntimeLock } = runtimeMaintenance;
const { pruneTargets } = runtimePolicy;

const runtimeDir = path.dirname(fileURLToPath(import.meta.url));

await refreshRepoLocalOpenClawRuntimeLock({
  runtimeDir,
  pruneTargets,
  logger: console,
});
