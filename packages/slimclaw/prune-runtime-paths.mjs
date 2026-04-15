// Baseline installed size: 652M.

const clipboardNativeTargets = [
  "node_modules/@mariozechner/clipboard-darwin-arm64/clipboard.darwin-arm64.node",
  "node_modules/@mariozechner/clipboard-darwin-x64/clipboard.darwin-x64.node",
  "node_modules/@mariozechner/clipboard-darwin-universal/clipboard.darwin-universal.node",
];

const daveyNativeTargets = [
  "node_modules/@snazzah/davey-darwin-arm64/davey.darwin-arm64.node",
  "node_modules/@snazzah/davey-darwin-x64/davey.darwin-x64.node",
  "node_modules/@snazzah/davey-darwin-universal/davey.darwin-universal.node",
];

const shouldPruneDavey = process.env.NEXU_OPENCLAW_PRUNE_DAVEY === "1";

export const pruneDependencyTargets = [
  // Round 1: actual savings 124M; actual pruned size 528M.
  // - Why these targets:
  //   biggest early size win
  // - Impact:
  //   `koffi`: may break native/system-level integrations or FFI-backed helpers.
  //   `node-llama-cpp` + `@node-llama-cpp`: may break local/on-device llama
  //   execution; hosted provider paths should still work.
  "node_modules/koffi",
  "node_modules/node-llama-cpp",
  "node_modules/@node-llama-cpp",

  // Round 2: actual savings 37M; actual pruned size 491M.
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

  // Round 3: actual savings 6M; actual pruned size 485M.
  // - Why these targets:
  //   browser/runtime-adjacent packages, and a few small low-risk cleanup
  //   targets that are extraneous or type-only in the current install tree.
  // - Impact:
  //   `bun-types`: should mainly affect Bun-oriented typing/tooling paths, not normal Node runtime behavior.
  //   `simple-git` + `ipull`: may break Git/download helper flows if any plugin still expects these extraneous packages to be present.
  //   `fast-xml-builder`: may break provider paths that depend on AWS XML serialization, such as Bedrock-related integrations.
  "node_modules/bun-types",
  "node_modules/simple-git",
  "node_modules/ipull",
  "node_modules/fast-xml-builder",

  // Round 4: desktop signing/packaging focused pruning.
  // - Why these targets:
  //   remove only the signed macOS native binaries that are currently bloating
  //   the packaged OpenClaw sidecar and slowing `codesign`, while keeping the
  //   surrounding JS packages in place for the lowest-risk desktop optimization.
  // - Impact:
  //   these paths are the exact Mach-O files currently re-signed during desktop
  //   packaging. If one of the related optional features is actually exercised at
  //   runtime, that feature may fail to load on macOS arm64, but the package
  //   metadata and JS wrappers remain intact.
  "node_modules/@img/sharp-darwin-arm64/lib/sharp-darwin-arm64.node",
  "node_modules/@img/sharp-libvips-darwin-arm64/lib/libvips-cpp.8.17.3.dylib",
  "node_modules/@lydell/node-pty-darwin-arm64/prebuilds/darwin-arm64/pty.node",
  "node_modules/@lydell/node-pty-darwin-arm64/prebuilds/darwin-arm64/spawn-helper",
  ...clipboardNativeTargets,
  "node_modules/@reflink/reflink-darwin-arm64/reflink.darwin-arm64.node",
  // Keep davey by default - required for OpenClaw Discord DAVE protocol.
  // Set NEXU_OPENCLAW_PRUNE_DAVEY=1 only for builds that never enable Discord voice.
  ...(shouldPruneDavey ? daveyNativeTargets : []),
  "node_modules/sqlite-vec-darwin-arm64/vec0.dylib",
];

// Package-content pruning must stay compatible with the runtime's published
// extension entrypoints. Many `extensions/*/index.ts` files still import
// `./src/*`, so deleting extension source trees here breaks runtime loading in
// desktop sidecars while leaving plain local runtime installs unaffected.
//
// `openclaw/docs` must be preserved because the runtime reads
// `docs/reference/templates/*` as workspace seed files while handling inbound
// messages. Keep docs pruning explicit so we do not accidentally remove runtime
// assets hidden under generic `docs/` paths.
export const docsPruneTargets = [
  "node_modules/@mariozechner/pi-coding-agent/docs",
  "node_modules/pino/docs",
  "node_modules/smart-buffer/docs",
  "node_modules/socks/docs",
  "node_modules/undici/docs",
  // OpenClaw docs: only prune large non-essential subdirectories.
  // MUST keep docs/reference/templates/ — runtime-required workspace templates.
  "node_modules/openclaw/docs/assets",
  "node_modules/openclaw/docs/images",
  "node_modules/openclaw/docs/zh-CN",
  "node_modules/openclaw/docs/ja-JP",
];

export const pruneTargets = [...pruneDependencyTargets, ...docsPruneTargets];
