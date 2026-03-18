import fs from "node:fs";
import { createContainer } from "../src/app/container.js";
import { createApp } from "../src/app/create-app.js";

const app = createApp(createContainer());
const spec = app.getOpenAPIDocument({
  openapi: "3.1.0",
  info: { title: "Nexu Controller API", version: "1.0.0" },
});

const outputPath = new URL("../openapi.json", import.meta.url).pathname;
fs.writeFileSync(outputPath, JSON.stringify(spec, null, 2));
console.log(`OpenAPI spec written to ${outputPath}`);
