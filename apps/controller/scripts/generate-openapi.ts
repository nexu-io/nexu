import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createContainer } from "../src/app/container.js";
import { createApp } from "../src/app/create-app.js";

const container = await createContainer();
const app = createApp(container);
const spec = app.getOpenAPIDocument({
  openapi: "3.1.0",
  info: { title: "nexu Controller API", version: "1.0.0" },
});

const outputPath = fileURLToPath(new URL("../openapi.json", import.meta.url));
fs.writeFileSync(outputPath, JSON.stringify(spec, null, 2));
console.log(`OpenAPI spec written to ${outputPath}`);
