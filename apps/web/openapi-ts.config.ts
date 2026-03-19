import { defineConfig } from "@hey-api/openapi-ts";

export default defineConfig({
  input: "../controller/openapi.json",
  output: "./lib/api",
  plugins: [
    "@hey-api/typescript",
    {
      name: "@hey-api/client-fetch",
    },
    {
      name: "@hey-api/sdk",
    },
  ],
});
