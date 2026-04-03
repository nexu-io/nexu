# Smoke

Temporary local smoke scripts for isolating Windows runtime issues from the main desktop flow.

## Feishu websocket smoke

Uses the Feishu app credentials already present in the active desktop runtime config by default.

```bash
pnpm --dir smoke feishu:ws
pnpm --dir smoke feishu:ws -- --reply
pnpm --dir smoke feishu:ws -- --account cli_xxx
pnpm --dir smoke feishu:ws -- --config path/to/openclaw.json
docker run --rm -it -v "%CD%:/workspace" -w /workspace/smoke node:22-bookworm node ./feishu-ws-smoke.mjs
```

Environment overrides:

```bash
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx
FEISHU_ACCOUNT_ID=cli_xxx
FEISHU_CONFIG_PATH=path/to/openclaw.json
FEISHU_DOMAIN=https://open.feishu.cn
```

What it does:

- starts a standalone Feishu `WSClient`
- logs `im.message.receive_v1` payload summaries
- logs chat/session bootstrap events
- optionally sends a plain-text echo reply when `--reply` is present
