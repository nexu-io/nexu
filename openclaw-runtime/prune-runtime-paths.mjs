// Baseline installed size: 665M.

export const pruneTargets = [
  // Round 1: actual savings 191M; actual pruned size 474M.
  // - Why these targets:
  //   biggest early size win
  // - Impact:
  //   `koffi`: may break native/system-level integrations or FFI-backed helpers.
  //   `pdfjs-dist` + `@napi-rs`: may break PDF parsing, image extraction,
  //   or attachment ingestion paths involving PDFs.
  //   `node-llama-cpp` + `@node-llama-cpp`: may break local/on-device llama
  //   execution; hosted provider paths should still work.
  "node_modules/koffi",
  "node_modules/pdfjs-dist",
  "node_modules/node-llama-cpp",
  "node_modules/@node-llama-cpp",
  "node_modules/@napi-rs",

  // Round 2: actual savings 37M; actual pruned size 437M.
  // - Why these targets:
  //   focus on packages that are extraneous or not observed as startup-time imports.
  //   `@google` is intentionally excluded because pruning it broke startup via
  //   a static import in `@mariozechner/pi-ai`.
  // - Impact:
  //   `@mistralai`: may break direct Mistral SDK usage exposed via pi-ai.
  //   `@octokit` + `octokit`: may break GitHub skills, app auth, or bundled
  //   GitHub automation clients.
  //   `@cloudflare`: may break Cloudflare/Workers-adjacent helper features
  //   pulled in through `@buape/carbon`.
  "node_modules/@mistralai",
  "node_modules/@octokit",
  "node_modules/octokit",
  "node_modules/@cloudflare",

  // Round 3: actual savings 16M; actual pruned size 421M.
  // - Why these targets:
  //   browser/runtime-adjacent packages, and a few small low-risk cleanup
  //   targets that are extraneous or type-only in the current install tree.
  // - Impact:
  //   `playwright-core`: may break browser control, pw-ai, or other Playwright-backed automation features.
  //   `bun-types`: should mainly affect Bun-oriented typing/tooling paths, not normal Node runtime behavior.
  //   `simple-git` + `ipull`: may break Git/download helper flows if any plugin still expects these extraneous packages to be present.
  //   `fast-xml-builder`: may break provider paths that depend on AWS XML serialization, such as Bedrock-related integrations.
  "node_modules/playwright-core",
  "node_modules/bun-types",
  "node_modules/simple-git",
  "node_modules/ipull",
  "node_modules/fast-xml-builder",
];
