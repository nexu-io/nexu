# Probe Scripts

This directory contains local developer probe scripts for checking high-signal runtime paths.

This is a local developer probe, not a CI-safe browser test.

## Model Call Probe

The model call probe sends one prompt directly through the repo-local OpenClaw runtime (no Slack/Feishu path).

### Basic usage

```bash
pnpm probe:model
```

### Override options

```bash
pnpm probe:model -- \
  --session-id local-probe \
  --message "hello from probe" \
  --timeout-sec 60
```

### Test a specific provider/model

```bash
pnpm probe:model -- \
  --provider custom-openai/litellm \
  --model anthropic/claude-3.5-haiku \
  --message "Reply with exactly: PROVIDER_TEST_OK"
```

The probe prints the selected provider + model before sending the prompt.
If you pass `--provider` / `--model`, it temporarily switches the desktop default model for the probe run, then restores the original default model afterward.

Defaults assume the standard repo-local desktop dev paths:

- config: `.tmp/desktop/nexu-home/runtime/openclaw/state/openclaw.json`
- state: `.tmp/desktop/electron/user-data/runtime/openclaw/state`

## Prepare

Install Chrome Canary, instead of using Chrome.

### Why Chrome Canary

- Keeps the probe isolated from a normal Chrome profile
- Uses a dedicated repo-local user data directory
- Exposes Chrome DevTools Protocol so the probe can attach to a real authenticated browser session

## Slack Reply Probe

The Slack reply probe verifies a single end-to-end Slack DM path:

1. Open an authenticated Slack DM in Chrome Canary
2. Send one probe message
3. Wait for the bot to post a new reply

### Required input

Set the target Slack DM URL at runtime:

```bash
export PROBE_SLACK_URL="https://app.slack.com/client/<team-id>/<dm-id>"
```

Do not commit real workspace or DM URLs into source.

### Basic workflow

Launch Chrome Canary for the probe:

```bash
pnpm probe:slack prepare
```

On the first run:

- Log into Slack in the opened Canary window
- Open the target DM if needed

Run the probe:

```bash
pnpm probe:slack run
```

Expected success output includes:

```text
[probe][info] result=pass
[probe][info] ===== PASS =====
```
