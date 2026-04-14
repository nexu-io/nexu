---
name: libtv-video
catalog-name: "LibTV - Image&Video（Seedance 2.0）"
description: "Seedance 2.0 video & image generation via LibTV Gateway - AI text-to-video, image-to-video, video continuation, style transfer, and text-to-image using Seedance 2.0 model. Also supports Kling 3.0, Wan 2.6, Midjourney, Seedream 5.0. Trigger phrases: seedance, generate video, make a video, generate image, make an image, draw, libtv, liblib."
homepage: https://www.liblib.tv/
metadata:
  openclaw:
    emoji: "🎬"
---

# LibTV - Image & Video Generation (Seedance 2.0)

Generate AI **images** and **videos** through one bundled LibTV skill, powered by Seedance 2.0. Supports text-to-image, image-to-image, text-to-video, and image-to-video workflows, via both Nexu-managed Seedance execution and direct LibTV execution with a user-owned `sk-libtv-...` key.

Key routing:

- `mgk_...` keys use Nexu-managed Seedance through `https://seedance.nexu.io/`
- `sk-libtv-...` keys use direct LibTV OpenAPI through `https://im.liblib.tv`

Delivery architecture (currently Feishu only):
- `create-session` captures `OPENCLAW_CHANNEL_TYPE` + `OPENCLAW_CHAT_ID`,
  persists them as the session's `delivery` block, forks a detached
  `wait-and-deliver` background process via `subprocess.Popen(...,
  start_new_session=True)`, and returns immediately with a single-line
  JSON submit confirmation on stdout.
- The forked waiter polls the upstream LibTV API (Seedance gateway or
  direct LibTV) and, on terminal success, shells out to
  `feishu_send_video.py` — the same proven helper used by `medeo-video` —
  which downloads each result URL, uploads it to Feishu's file API, and
  posts a native media message to the originating chat.
- The waiter's output is captured in `$NEXU_HOME/libtv-waiter-<id>.log`
  for post-hoc debugging. A `delivered_at` timestamp is persisted when
  the Feishu helper reports success, so re-invoking `wait-and-deliver`
  on a delivered session is a safe no-op.

No `sessions_spawn`, no subagent model-speech contract, no HTTP
notification callback, no stale routing fields. Delivery is a direct
HTTP call using stable per-user identifiers (`open_id` / `chat_id`)
that never go stale the way the old `account_id` did.

Multi-channel support is a follow-up: adding Discord / Slack / WeChat
means dropping a new `<channel>_send_video.py` helper next to
`feishu_send_video.py` and adding one branch in `_deliver_results`.

## Requirements

- Python 3.8+
- `apiKey` configured in `~/.nexu/libtv.json`
- default `videoRatio` configured in `~/.nexu/libtv.json` or implicit default `16:9`
- `mgk_...` keys target `https://seedance.nexu.io/`
- `sk-libtv-...` keys target `https://im.liblib.tv`

## First-Time Setup

If the user has not configured an API Key, guide them to:
1. Choose the correct key type:
   - Nexu-managed key: `mgk_...`
   - personal LibTV key: `sk-libtv-...`
2. Run: `python3 scripts/libtv_video.py setup --api-key <your_key> --video-ratio 16:9`
3. Run: `python3 scripts/libtv_video.py check` to confirm the configuration is correct

To change only the default ratio later:

```bash
python3 scripts/libtv_video.py update-ratio --video-ratio 9:16
```

## Pre-Generation Check (must run before each generation)

1. Run `python3 scripts/libtv_video.py check`
2. Interpret the output:
   - "API Key not configured" → guide the user to contact the admin for a key, then run setup
   - Nexu-managed key valid with remaining uses → proceed with generation
   - direct LibTV key configured → proceed with generation
   - "Key expired / exhausted" → guide the user to contact the admin, run update-key
   - "Cannot connect to gateway" or "Cannot connect to direct LibTV API" → suggest checking network connectivity
3. Only proceed with generation after check passes

## Core Principle: Relay, Don't Create

You are a **messenger**, not a creator. The backend agent handles model selection, prompt engineering, and workflow orchestration. Your job is three things only:

1. **Upload**: User provides a local file → `upload` to get OSS URL
2. **Relay**: Pass the user's original description + OSS URL verbatim to `create-session`
3. **Collect**: Poll for results → download → present to user

**Never do these:**
- Don't rewrite, expand, translate, or embellish the user's prompt
- Don't break tasks into multiple sessions (e.g. don't split "generate 9 storyboards" into 9 calls)
- Don't add your own prompt engineering (e.g. "ultra-realistic, cinematic lighting, 8K")
- Don't arrange shots, plan storylines, or analyze styles yourself

## Video / Image Generation (async, non-blocking)

### CRITICAL: always pass `--channel` and `--chat-id`

Before running `create-session` you **must** extract the originating
channel and the user's stable identifier from the inbound message
metadata block and pass them as CLI args. Without these the background
waiter cannot deliver the finished video back to the user automatically;
the user will have to ask for the result manually.

- For **Feishu**: the inbound user message has an `untrusted metadata`
  JSON block containing `sender_id`. That value is the stable `open_id`
  (always starts with `ou_`). Pass it as `--chat-id` and pass
  `--channel feishu`.

Example extraction and invocation:

```text
Conversation info (untrusted metadata):
{
  "message_id": "om_x100...",
  "sender_id": "ou_33314772052f837a3cb2f919aa4605de",
  ...
}
```

becomes:

```bash
python3 scripts/libtv_video.py create-session "user's video description" \
  --channel feishu \
  --chat-id ou_33314772052f837a3cb2f919aa4605de
```

The `stdout` JSON returned by `create-session` includes a `deliverable`
flag. If it is `false`, your `--channel` / `--chat-id` were missing and
the user will have to ask you for the result later.

### Text-Only Generation

```bash
python3 scripts/libtv_video.py create-session "user's video description" \
  --channel feishu --chat-id <ou_xxx from inbound metadata>
```

Message rules:

- Nexu-managed `mgk_...` mode appends the Seedance 2.0 hint unless the user already chose a model
- direct `sk-libtv-...` mode follows the upstream relay discipline and does not add the Seedance model hint
- both modes relay the configured video ratio, defaulting to `16:9`

### Image+Text Generation (image-to-video)

```bash
# 1. Upload the image first
python3 scripts/libtv_video.py upload --file /path/to/image.png
# Output: url=https://libtv-res.liblib.art/...

# 2. Create session with the image URL in the message
python3 scripts/libtv_video.py create-session "user's description reference: {oss_url}"
```

### Continue in Existing Session

```bash
python3 scripts/libtv_video.py create-session "new description" \
  --session-id SESSION_ID \
  --channel feishu --chat-id <ou_xxx from inbound metadata>
```

### After Submission

1. `create-session` returns immediately without blocking and prints a
   single-line JSON `{"status":"submitted", "sessionId", "projectUuid",
   "projectUrl", "channel", "deliverable", "note"}` to stdout.
2. **Reply to the user immediately** using the `note` field as a hint:
   "Your video task has been submitted and is now generating. I'll notify
   you when it finishes."
3. **Do not wait** — resume normal conversation.
4. Under the hood, `create-session` has forked a detached `wait-and-deliver`
   background process that polls the upstream API for you.
5. When the job finishes, the background waiter delivers each result URL
   as a native video message directly to the originating Feishu chat via
   `feishu_send_video.py`. You do not need to speak the result yourself.
6. If `deliverable` is `false` (no channel context captured), the user will
   need to ask for the result explicitly via `query-session` or `recover`.

## When the User Asks "Is my video ready?"

1. Run `python3 scripts/libtv_video.py query-session SESSION_ID`
   - If you don't remember the session_id, run `python3 scripts/libtv_video.py recover` to see all sessions
2. Reply based on the output:
   - Result URLs found → send the video/image links directly to the user
   - No results yet → "Your video is still being generated, please wait a moment"
   - Error or timeout → relay the error message and suggest retrying

## Session Recovery (after memory loss / agent restart)

If you don't remember whether a video was previously generated:
1. Run `python3 scripts/libtv_video.py recover`
2. It reads historical sessions from the local persistence file and queries the correct backend for latest status
3. Completed sessions → send the result URLs to the user directly
4. Still in progress → inform the user it's still generating and keep the periodic heartbeat schedule

## Presenting Results

When generation completes, show both:
- **Result links** (video/image URLs)
- **Project canvas link** (projectUrl)

Do NOT show the project canvas link while generation is in progress.

### URL Rules

The valid result URL prefixes are:

- `https://libtv-res.liblib.art/sd-gen-save-img/`
- `https://libtv-res.liblib.art/claw/`

Any other domain (for example `medeo-res.liblib.art`) is not a final result URL and must be ignored.

**Always present the URL exactly as extracted by the script.** Do not:
- Rewrite or transform URLs
- Use proxy/cache domain URLs as results
- Fabricate URLs by guessing paths

The `extract_result_urls()` function in the script extracts only valid `libtv-res.liblib.art` result URLs. Trust its output.

## Multi-Session Discipline (CRITICAL)

When running multiple video generations concurrently, you MUST follow these rules strictly:

### 1. Track Every Session Separately

Maintain a clear mapping for each generation request:
- **User request** (what the user asked for, e.g. "scene 1: palace", "scene 2: garden")
- **Session ID** (returned by `create-session`)
- **Project UUID** (returned by `create-session`)

### 2. Never Mix Sessions

Before presenting results, always verify:
- The result URLs came from the correct session ID for that specific request
- Do NOT copy-paste URLs from one session's output into another session's reply

### 3. Label Results Clearly

When presenting results from multiple concurrent sessions, always label which result belongs to which request:
```
Scene 1 (palace): [video URL from session A]
Scene 2 (garden): [video URL from session B]
```

### 4. Handle Partial Completion

If some sessions complete before others:
- Present completed results immediately, clearly labeled
- Note which sessions are still in progress
- Do NOT hold all results until every session finishes

## Error Handling

When any command returns an error:
1. Read the message after "❌" in the output and **relay it to the user as-is**
2. Do not fabricate or translate error messages
3. Provide action suggestions based on the error type:

| Error keyword seen | Suggested action |
|---|---|
| "Invalid API Key" | Run `check`, contact admin to confirm key |
| "Free trial uses exhausted" | Contact admin for a new key |
| "Key expired" | Contact admin for a new key, run `update-key` |
| "Service temporarily unavailable" | Wait a few minutes and retry |
| "File too large" | Suggest the user send a smaller file (max 200MB) |
| "Unsupported file type" | Only image and video files are supported |
| "Cannot connect to gateway" | Check network connectivity |

## Mandatory Guard Checklist

This skill has a hard anti-hallucination rule. The model must verify each step before it can describe that step as successful.

Submit step checks:
- confirm `~/.nexu/libtv.json` exists and contains a non-empty `apiKey`
- confirm the key starts with either `mgk_` or `sk-libtv-`
- confirm `mgk_...` keys target `https://seedance.nexu.io/` unless a deliberate local test override is set
- confirm `sk-libtv-...` keys target `https://im.liblib.tv` unless a deliberate local test override is set
- never route a personal `sk-libtv-...` key through the Nexu Seedance gateway
- confirm the effective video ratio is set, defaulting to `16:9`
- confirm `create-session` returns a real `sessionId`
- confirm `create-session` returns a real `projectUuid`
- confirm the accepted session was persisted locally with matching `session_id`, `project_uuid`, `status=submitted`
- after submit, use the `note` field from `create-session` stdout to acknowledge the submission to the user

Background delivery checks (handled by the detached waiter, not by the model):
- confirm success only when at least one result URL is extracted from the valid LibTV result domain
- the waiter persists `delivered_at` after `feishu_send_video.py` returns success; re-running `wait-and-deliver` on a delivered session is a safe no-op
- if `feishu_send_video.py` fails, the error is logged to `$NEXU_HOME/libtv-waiter-<session-id>.log`; the result URLs remain persisted locally so the user can ask `query-session` to retrieve them
- if terminal polling times out, the session's `status` is set to `timeout`; the user will have to ask later via `query-session` or `recover`

Output rule:
- If any guard check fails, stop and return the explicit guard-check error
- Never claim a video is ready until the terminal success checks have passed
- Never invent session ids, project ids, URLs, or completion state

## Command Reference

| Scenario | Command | Blocking? |
|---|---|---|
| First-time setup | `setup --api-key <mgk_xxx|sk-libtv_xxx>` | No |
| Check status | `check` | No |
| Update key | `update-key --api-key <mgk_xxx|sk-libtv_xxx>` | No |
| Update ratio | `update-ratio --video-ratio 9:16` | No |
| Remove key | `remove-key` | No |
| Upload file | `upload --file /path/to/file` | No |
| **Create session / send message** | **`create-session "description"`** | **No** |
| Query session | `query-session SESSION_ID` | No |
| Download results | `download-results SESSION_ID` | No |
| Wait and deliver | `wait-and-deliver --session-id ID --project-id UUID` | Yes |
| List all tasks | `tasks` | No |
| Recover sessions | `recover` | No |
| Change project | `change-project` | No |

Script path for all commands: `scripts/libtv_video.py`
