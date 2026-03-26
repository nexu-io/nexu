# Fix Sentry-linked GitHub Issue

Investigate a GitHub issue that references a Sentry error, diagnose the root cause, and prepare a fix.

## Input

$ARGUMENTS — GitHub issue number (e.g. `535`)

## Steps

### 1. Fetch GitHub issue

```bash
gh issue view $ARGUMENTS --json title,body,labels,comments
```

Extract the Sentry issue URL or ID from the issue body/comments. The Sentry issue ID is in the URL path: `https://refly-ai.sentry.io/issues/{issue_id}/`.

### 2. Load Sentry credentials

```bash
export SENTRY_AUTH_TOKEN="$(python - <<'PY'
from pathlib import Path

for line in Path("apps/desktop/.env").read_text().splitlines():
    if line.startswith("SENTRY_AUTH_TOKEN="):
        print(line.split("=", 1)[1])
        break
PY
)"
test -n "$SENTRY_AUTH_TOKEN" || { echo "Missing SENTRY_AUTH_TOKEN"; exit 1; }
```

This reads only `SENTRY_AUTH_TOKEN` from the dotenv file; it does not execute the rest of `apps/desktop/.env` as shell code.

Sentry org: `refly-ai`. API base: `https://us.sentry.io/api/0`.

Refer to `specs/current/sentry/troubleshooting.md` for the full API query reference.

### 3. Fetch Sentry issue metadata

```bash
curl -s -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" \
  "https://us.sentry.io/api/0/issues/{issue_id}/" \
  | jq '{title, status, level, count, firstSeen, lastSeen, shortId, isUnhandled, platform, firstRelease: .firstRelease.shortVersion}'
```

### 4. Fetch latest event — structured extraction

Fetch the latest event and extract the three most useful sections in a single `jq` pass:

```bash
curl -s -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" \
  "https://us.sentry.io/api/0/issues/{issue_id}/events/latest/" \
  | jq '{
    exception: [.entries[] | select(.type == "exception") | .data.values[] | {type, value, mechanism: .mechanism.type, frames: [(.stacktrace.frames // [])[] | select(.inApp == true) | {filename, function, lineNo, colNo}]}],
    breadcrumbs: [.entries[] | select(.type == "breadcrumbs") | .data.values[-20:][]] | map({timestamp, category, message, level, url: (.data // {}).url} | del(.[] | nulls)),
    tags: [.tags[] | {(.key): .value}] | add,
    contexts: {os: .contexts.os, runtime: .contexts.runtime, app: .contexts.app}
  }'
```

This gives you:
- **exception**: error type, value, mechanism, and in-app stack frames
- **breadcrumbs**: last 20 events leading to the error (HTTP calls, console logs, lifecycle events)
- **tags**: OS, architecture, version, release, process origin, handled status
- **contexts**: runtime environment details (OS, Electron/Node version, app info)

For native crashes, also check `debugmeta` to identify which process crashed:

```bash
export EVENT_URL="https://us.sentry.io/api/0/issues/{issue_id}/events/latest/"
curl -s -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" \
  "$EVENT_URL" \
  | jq '[.entries[] | select(.type == "debugmeta") | .data.images[] | select(.code_file | test("nexu|node|electron"; "i")) | {code_file, type, debug_status}]'
```

### 5. Optional — compare multiple events for patterns

If the issue has many occurrences, check for clustering:

```bash
curl -s -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" \
  "https://us.sentry.io/api/0/issues/{issue_id}/events/?limit=10" \
  | jq '[.[] | {id: .eventID, dateCreated, title: .title[:80]}]'
```

### 6. Diagnose

Based on the Sentry data:

1. **Classify the error** from `mechanism` — JS exception (`generic`, `onunhandledrejection`, `onerror`) vs native crash (`minidump`, `osx_exception`)
2. **Trace in-app stack frames** to source code — read the relevant files
3. **Analyze breadcrumbs** for the sequence of events leading up to the error — look for failed HTTP calls, console errors, lifecycle transitions
4. **Check tags** — `event.process` (main vs renderer), `handled` (yes/no), `release`, `os`
5. **Identify root cause** and determine the minimal fix

### 7. Fix and verify

1. Make the code fix
2. Run `pnpm typecheck` and `pnpm lint`
3. Run `pnpm test` if logic changes were made

### 8. Present findings

Summarize to the user:
- **Sentry issue**: short ID, title, occurrence count, time range
- **Root cause**: what's happening and why
- **Fix**: what was changed and why it resolves the issue
- **Verification**: which checks passed

Do NOT commit or create a PR unless the user explicitly asks. Follow `AGENTS.md` commit and PR conventions when they do.
