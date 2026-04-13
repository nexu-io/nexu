import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pluginDir = path.dirname(fileURLToPath(import.meta.url));
const statePath = path.resolve(
  pluginDir,
  "..",
  "..",
  "nexu-runtime-model.json",
);

let cachedRaw = null;
let cachedState = null;

function loadState() {
  try {
    const raw = readFileSync(statePath, "utf8");
    if (cachedState && cachedRaw === raw) {
      return cachedState;
    }
    const parsed = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.selectedModelRef !== "string" ||
      typeof parsed.promptNotice !== "string"
    ) {
      return null;
    }
    cachedRaw = raw;
    cachedState = parsed;
    return parsed;
  } catch {
    return cachedState;
  }
}

const plugin = {
  id: "nexu-runtime-model",
  name: "Nexu Runtime Model",
  description:
    "Injects Nexu runtime model selection into model routing and prompt context.",
  register(api) {
    api.on("before_model_resolve", async () => {
      const state = loadState();
      if (!state || !state.selectedModelRef) {
        return;
      }
      const slashIndex = state.selectedModelRef.indexOf("/");
      if (slashIndex <= 0) {
        return {
          modelOverride: state.selectedModelRef,
        };
      }
      const providerOverride = state.selectedModelRef.slice(0, slashIndex);
      const modelOverride = state.selectedModelRef.slice(slashIndex + 1);
      return {
        providerOverride,
        modelOverride,
      };
    });

    api.on("before_prompt_build", async () => {
      const state = loadState();
      if (!state?.selectedModelRef || !state?.promptNotice) {
        return;
      }
      return {
        prependSystemContext: state.promptNotice,
      };
    });
  },
};

export default plugin;
