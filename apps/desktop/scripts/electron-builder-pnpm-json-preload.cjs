const path = require("node:path");
const {
  extractJsonFromPossiblyPollutedOutput,
} = require("./electron-builder-json-extractor.cjs");

function patchNodeModulesCollector() {
  const modulePath = require.resolve(
    "app-builder-lib/out/node-module-collector/nodeModulesCollector.js",
    {
      paths: [
        process.cwd(),
        path.resolve(__dirname, ".."),
        path.resolve(__dirname, "../../.."),
      ],
    },
  );
  const collectorModule = require(modulePath);
  const collectorPrototype = collectorModule.NodeModulesCollector?.prototype;

  if (!collectorPrototype) {
    console.warn(
      "[nexu] NodeModulesCollector prototype not found; JSON extractor patch skipped. electron-builder internals may have changed.",
    );
    return;
  }

  if (collectorPrototype.__nexuJsonExtractorPatched === true) {
    return;
  }

  collectorPrototype.extractJsonFromPollutedOutput =
    function patchedExtractJson(shellOutput) {
      return extractJsonFromPossiblyPollutedOutput(shellOutput);
    };
  collectorPrototype.__nexuJsonExtractorPatched = true;
}

patchNodeModulesCollector();
