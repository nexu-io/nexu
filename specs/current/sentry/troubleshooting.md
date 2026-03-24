# Sentry API — Troubleshooting Guide

How to fetch the right data from the Sentry REST API when investigating an issue.
Auth: `Authorization: Bearer $SENTRY_AUTH_TOKEN` on all calls.

---

## 1. Start with issue metadata

```bash
GET /api/0/issues/{issue_id}/
```

Returns: title, level, status, first/last seen, event count, SDK name, platform. Good for a quick triage before fetching events.

---

## 2. Discover what's in the latest event

```bash
GET /api/0/issues/{issue_id}/events/latest/
```

The event object is large. First fetch just the keys to understand what's available:

```bash
curl ... | jq 'keys'
```

Typical top-level keys: `contexts`, `entries`, `tags`, `release`, `crashFile`, `platform`.

Then fetch `entries | map(.type)` to see what entry types the event contains:

```bash
curl ... | jq '.entries | map(.type)'
# e.g. ["exception", "threads", "breadcrumbs", "debugmeta"]
```

---

## 3. contexts — runtime environment

```bash
curl ... | jq '.contexts'
```

Contains: `os` (name, version, build), `device` (arch, cpu, memory), `app` (start time, version), `runtime` (Electron/Node version), `chromium_stability_report`, etc.

The `app.app_start_time` field is useful for calculating uptime at crash time.

---

## 4. tags — indexed searchable fields

```bash
curl ... | jq '[.tags[] | select(.key | test("os|arch|version"))]'
```

Tags are the filterable fields shown in the Sentry UI sidebar. Good for confirming OS version, architecture, node version at a glance.

---

## 5. entries — the core payload

Each entry has a `type`. Useful ones:

### exception

```bash
curl ... | jq '.entries[] | select(.type == "exception") | .data.values[0] | {type, value, mechanism, threadId, frames: [.stacktrace.frames[] | {package, function, inApp, trust}]}'
```

- `mechanism.type`: `generic`, `minidump`, `osx_exception` — tells you whether it's a native crash or JS exception
- `inApp: true` frames are your code; `inApp: false` are system/library frames
- `trust` on frames: `context` > `cfi` > `fp` > `scan` — lower trust means less reliable symbolication

### threads

```bash
curl ... | jq '[.entries[] | select(.type == "threads") | .data.values[] | select(.crashed == true)]'
```

Find the crashed thread. If frames are empty, symbols weren't uploaded or couldn't be resolved.

### breadcrumbs

```bash
curl ... | jq '.entries[] | select(.type == "breadcrumbs") | .data.values | sort_by(.timestamp) | map({timestamp, category, message, level, data})'
```

Sorted chronologically. Filter to a window around the crash:

```bash
... | map(select(.timestamp >= "2026-03-22T06:20" and .timestamp <= "2026-03-22T06:35"))
```

Categories to watch: `fetch` (HTTP calls), `electron` (lifecycle events), `console` (JS logs/errors).

### debugmeta

```bash
curl ... | jq '.entries[] | select(.type == "debugmeta") | .data.images | map({code_file, type, debug_status})'
```

**Most useful for native crashes.** Lists every binary image (dylib, framework, executable) loaded in the process. The `code_file` of the main executable tells you *which process actually crashed* — especially important when Electron spawns child processes (e.g. a Node.js controller sidecar). Filter to find your app's binaries:

```bash
... | map(select(.code_file | test("YourApp|node|electron"; "i")))
```

---

## 6. Compare multiple events

```bash
GET /api/0/issues/{issue_id}/events/?limit=10
```

Returns a list of events with metadata. Useful for spotting patterns:
- Are all events from the same OS build? → environment-specific bug
- Do timestamps cluster in bursts? → crash-restart loop
- Does `app_start_time` stay constant across events? → same app instance crashing repeatedly

Fetch a specific older event by ID to compare:

```bash
GET /api/0/issues/{issue_id}/events/{event_id}/
```

---

## Tips

- **For native/minidump crashes**: go straight to `debugmeta` to identify the crashing process, then look at the exception frames. Breadcrumbs are often clean (crash is below the JS layer).
- **For JS exceptions**: focus on `exception` frames with `inApp: true`, then breadcrumbs for the user journey leading up to it.
- **Crash loops**: if event count is high with tight timestamp clustering and `app_start_time` is stable, the process is being relaunched and crashing again immediately.
- **Response size**: the full event JSON is large (40–50KB). Always select specific fields with `jq` rather than piping the whole response to a terminal.
