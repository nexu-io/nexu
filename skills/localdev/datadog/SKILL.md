---
name: datadog
description: Use when the user says "check Datadog", "查 Datadog", "查日志", "check logs", "crash logs", "查 crash", "gateway crash", "查告警", "check alerts", "check metrics", or needs to investigate production issues via Datadog Logs API.
---

# Datadog Log Investigation

Query Datadog Logs API to investigate production issues for the Nexu platform.

## Authentication

**Before making any Datadog API call, you MUST ask the user for these two keys:**

- `DD_API_KEY` — Datadog API Key (Organization Settings → API Keys)
- `DD_APP_KEY` — Datadog Application Key (Organization Settings → Application Keys, requires `logs_read_data` scope)

Store them in shell variables for the session. Never hardcode or commit them.

Site: `datadoghq.com` (US)

## API Base

All requests go to `https://api.datadoghq.com/api/v2/logs/events/search`.

Headers:
```
DD-API-KEY: <api_key>
DD-APPLICATION-KEY: <app_key>
Content-Type: application/json
```

## Common Queries

### OpenClaw Crash Events

```bash
curl -s "https://api.datadoghq.com/api/v2/logs/events/search" \
  -H "DD-API-KEY: $DD_API_KEY" \
  -H "DD-APPLICATION-KEY: $DD_APP_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "filter": {
      "query": "service:nexu-gateway @event:openclaw_crash",
      "from": "now-1h",
      "to": "now"
    },
    "sort": "-timestamp",
    "page": {"limit": 20}
  }'
```

Key fields in results:
- `attributes.attributes.exitCode` — process exit code (1 = fatal error, null = signal)
- `attributes.attributes.signal` — kill signal (SIGKILL, SIGTERM, etc.)
- `attributes.tags` → `pod_name`, `image_tag` — which pod and which version

### OpenClaw stderr Output (Crash Details)

```bash
curl -s "https://api.datadoghq.com/api/v2/logs/events/search" \
  -H "DD-API-KEY: $DD_API_KEY" \
  -H "DD-APPLICATION-KEY: $DD_APP_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "filter": {
      "query": "service:nexu-gateway @stream:stderr",
      "from": "now-1h",
      "to": "now"
    },
    "sort": "-timestamp",
    "page": {"limit": 50}
  }'
```

This shows the actual error output from the OpenClaw process (e.g., `invalid_auth`, `EADDRINUSE`, config validation failures).

### Gateway Startup / Recovery Events

```bash
curl -s "https://api.datadoghq.com/api/v2/logs/events/search" \
  -H "DD-API-KEY: $DD_API_KEY" \
  -H "DD-APPLICATION-KEY: $DD_APP_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "filter": {
      "query": "service:nexu-gateway (\"starting gateway\" OR \"gateway is ready\" OR \"spawned openclaw\")",
      "from": "now-1h",
      "to": "now"
    },
    "sort": "timestamp",
    "page": {"limit": 30}
  }'
```

### Slack Token Health Check

```bash
curl -s "https://api.datadoghq.com/api/v2/logs/events/search" \
  -H "DD-API-KEY: $DD_API_KEY" \
  -H "DD-APPLICATION-KEY: $DD_APP_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "filter": {
      "query": "service:nexu-api slack_token_health*",
      "from": "now-1h",
      "to": "now"
    },
    "sort": "-timestamp",
    "page": {"limit": 20}
  }'
```

### API HTTP Request Logs

```bash
curl -s "https://api.datadoghq.com/api/v2/logs/events/search" \
  -H "DD-API-KEY: $DD_API_KEY" \
  -H "DD-APPLICATION-KEY: $DD_APP_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "filter": {
      "query": "service:nexu-api http_request @attributes.status:>=500",
      "from": "now-1h",
      "to": "now"
    },
    "sort": "-timestamp",
    "page": {"limit": 20}
  }'
```

### Filter by Pod

Add `pod_name:<name>` to the query:

```
service:nexu-gateway pod_name:nexu-gateway-1 @event:openclaw_crash
```

### Filter by Time Window

Use ISO 8601 timestamps:

```json
{
  "from": "2026-03-10T05:00:00Z",
  "to": "2026-03-10T06:00:00Z"
}
```

Or relative: `"now-30m"`, `"now-1h"`, `"now-24h"`.

## Parsing Results

Use python3 inline to extract key fields:

```bash
curl -s ... | python3 -c "
import json, sys
data = json.load(sys.stdin)
events = data.get('data', [])
print(f'Total events: {len(events)}')
for e in events:
    attrs = e['attributes']['attributes']
    tags = e['attributes']['tags']
    pod = next((t.split(':',1)[1] for t in tags if t.startswith('pod_name:')), '?')
    ts = attrs.get('time', '?')
    msg = e['attributes'].get('message', '')[:120]
    print(f'{ts} | pod={pod} | {msg}')
"
```

## Services and Events Reference

| Service | Description |
|---------|-------------|
| `nexu-gateway` | Gateway sidecar (manages OpenClaw process) |
| `nexu-api` | API server |

| Event | Meaning |
|-------|---------|
| `openclaw_crash` | OpenClaw process exited unexpectedly |
| `openclaw_restart_scheduled` | Sidecar scheduling a restart |
| `openclaw_restart_limit` | Max restart attempts exceeded |
| `openclaw_orphan_killed` | Killed zombie OpenClaw process |
| `slack_token_health_check_invalidated` | Invalid Slack tokens detected and marked |

## Tag Reference

| Tag | Example |
|-----|---------|
| `pod_name` | `nexu-gateway-1`, `nexu-gateway-2` |
| `image_tag` | `sha-55f13372bb72abc7db1538cca3db2bcda0d35eba` |
| `kube_stateful_set` | `nexu-gateway` |

## Investigation Playbook

When investigating a crash:

1. **Check crash events** — get exit codes, signals, timestamps, affected pods
2. **Check stderr** — get the actual error message from OpenClaw
3. **Check startup events** — correlate crash with deploy times (`image_tag` changes)
4. **Check token health** — if `invalid_auth`, look for `slack_token_health_check_invalidated`
5. **Check API logs** — if API errors are contributing

## Rules

1. **Never hardcode API keys** in skill files or logs — always use variables
2. **Default time window** — start with `now-1h`, expand to `now-24h` if needed
3. **Always parse and summarize** — don't dump raw JSON to the user
4. **Correlate across services** — crashes often involve both gateway and API logs
5. **Check image_tag** to determine if crashes are related to a specific deployment
