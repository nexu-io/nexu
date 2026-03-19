---
id: "20260319-slack-reply-probe"
name: "Slack Reply Probe"
status: new
created: "2026-03-19"
---

## Overview

- Add a local `pnpm probe:slack` developer probe that verifies the main Slack reply path is still alive after local runtime or OpenClaw dependency changes.
- Target a single high-signal case: open the Nexu bot DM in Slack Web with a reused logged-in browser profile, send one message, and observe whether Nexu posts a reply back into the same conversation.
- Treat this as a developer environment probe rather than a general-purpose test suite or CI e2e flow. The goal is fast confidence that the real end-to-end path is not broken in local development.
- Background:
  - Existing browser e2e coverage in `apps/web` is outdated for this purpose and only exercises Nexu-owned UI.
  - Sending Slack messages purely through bot-side APIs was already tried and is not feasible.
  - OpenClaw dependency trimming can break the integrated Slack -> API -> Gateway/OpenClaw -> Slack reply chain in ways that unit tests do not catch.
- Success means one command can be run in a prepared local environment to give a clear pass/fail signal on whether the Slack DM reply loop still works.

## Research

### Findings

- The reliable path is a local probe that drives Slack Web directly, not bot-side API injection.
- Reusing a browser session by launching Playwright with `launchPersistentContext(...)` was not stable for Slack. Even with a prepared profile, Slack often redirected back to workspace sign-in or showed a load error screen.
- Reusing a real, already-running browser session over Chrome DevTools Protocol works. `chromium.connectOverCDP("http://127.0.0.1:9222")` can attach to Chrome Canary and operate an authenticated Slack DM page.
- A dedicated Chrome Canary profile isolates the probe from the developer's normal Chrome usage and avoids disturbing everyday browsing sessions.
- Keeping the Slack DM URL out of source is important because it is user-specific. The final flow requires `PROBE_SLACK_URL` or `--url` at runtime instead of committing any real workspace URL into the repo.

### Options considered

1. Send Slack messages only through bot/API calls
   - Not sufficient for validating the user-visible DM interaction path
   - Does not prove the Slack Web flow still works end to end
2. Launch Playwright with its own persistent Slack profile
   - Explored first
   - Unstable for Slack login/session reuse in practice
3. Launch real Chrome Canary, then attach over CDP (chosen)
   - Preserves a real authenticated browser session
   - Keeps automation and login concerns separated
   - Fits the local-only developer probe goal well

### Final recommendation

- Use a two-step local workflow:
  - `pnpm probe:slack prepare` to launch dedicated Chrome Canary with remote debugging and a repo-local profile
  - `pnpm probe:slack run` to attach to that browser, send one probe message, and wait for a new reply
- Treat login as a one-time manual setup step inside the dedicated Canary profile.

## Design

### Architecture

`pnpm probe:slack prepare` -> launch Chrome Canary with dedicated profile + CDP port -> user logs into Slack if needed

`pnpm probe:slack run` -> connect over CDP -> open/reuse target DM -> send unique probe message -> wait for new Slack reply -> print pass/fail

### Implementation choices

- Single entry script: `scripts/probe/slack-reply-probe.mjs`
- Runtime URL input via `PROBE_SLACK_URL` or `--url`
- Default CDP endpoint: `http://127.0.0.1:9222`
- Dedicated profile dir: `.tmp/slack-reply-probe/chrome-canary-profile`
- Browser binary default: macOS Chrome Canary app path, overridable by `SLACK_PROBE_CANARY_BIN`
- Structured output levels:
  - `[probe][info]` for key lifecycle and result lines
  - `[probe][debug]` for detailed state and selector diagnostics
  - `[probe][error]` for failures

### DM automation details

- Compose selector: `[role="textbox"][aria-label*="Message to"]`
- Send button selector: `button[data-qa="texty_send_button"]`
- Message container selector: `[data-qa="message_container"]`
- The probe sends a unique message like `probe:<timestamp>-<nonce>`
- Success is defined as observing a new Slack message after the probe message, where the newest message text no longer contains the probe payload

### Commands

- `prepare`
  - Launches Chrome Canary with the dedicated probe profile and CDP enabled
  - First run may require manual Slack login in the opened Canary window
- `run`
  - Connects to the running Canary session
  - Sends one message and waits for a reply
- `session`
  - Confirms the DM page looks ready
- `inspect`
  - Prints selector diagnostics for debugging Slack DOM changes

## Plan

- [x] Phase 1: Explore session reuse approaches
  - [x] Test Playwright persistent-profile reuse
  - [x] Test manual profile preparation
  - [x] Confirm CDP attachment to a real authenticated browser is viable
- [x] Phase 2: Build the local probe flow
  - [x] Implement `prepare` to launch dedicated Chrome Canary
  - [x] Implement `run` to send a probe message and wait for a reply
  - [x] Implement `session` and `inspect` for diagnostics
- [x] Phase 3: Validate the developer workflow
  - [x] Verify local pass/fail output is clear
  - [x] Verify the flow works with sanitized runtime URL configuration

## Notes

- This probe is intentionally local-only. It depends on an authenticated Slack browser session and is not intended for CI.
- The current launcher assumes macOS Chrome Canary by default. Other local setups can override the binary path.
- `scripts/probe/README.md` is the user-facing usage guide for this workflow.
