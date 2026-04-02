---
name: LibTV Video
description: Seedance 2.0 video generation via LibTV Gateway - AI text-to-video, image-to-video, video continuation, style transfer using Seedance 2.0 model. Also supports Kling 3.0, Wan 2.6, Midjourney. Trigger phrases: "seedance", "generate video", "make a video", "libtv", "liblib".
homepage: https://www.liblib.tv/
metadata:
  {
    "openclaw":
      {
        "emoji": "🎬",
        "requires": { "bins": ["python3"] },
      },
  }
---

# LibTV Video / Image Generation

Generate AI videos and images via LibTV Gateway. Supports text-to-video, image-to-video, video continuation, style transfer, short drama generation, and more.

The backend agent automatically selects the best model. **When sending prompts, always append "use Seedance 2.0 model" to the message unless the user explicitly requests a different model.** Available models: Seedance 2.0, Kling 3.0/O3, Wan 2.6, Midjourney, Seedream 5.0.

## Requirements

- Python 3.8+
- `apiKey` configured in `~/.nexu/libtv.json`

## First-Time Setup

If the user has not configured an API Key, guide them to:
1. Contact the admin to obtain an API Key starting with `mgk_`
2. Run: `python3 scripts/libtv_video.py setup --api-key mgk_yourkey`
3. Run: `python3 scripts/libtv_video.py check` to confirm the configuration is correct

## Pre-Generation Check (must run before each generation)

1. Run `python3 scripts/libtv_video.py check`
2. Interpret the output:
   - "API Key not configured" → guide the user to contact the admin for a key, then run setup
   - "Key valid, N uses remaining" → inform the user of remaining quota, proceed with generation
   - "Key expired / exhausted" → guide the user to contact the admin, run update-key
   - "Cannot connect to gateway" → suggest checking network connectivity
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

### Text-Only Generation

```bash
python3 scripts/libtv_video.py create-session "user's video description"
```

The script automatically appends "please use Seedance 2.0" unless the user specifies another model.

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
python3 scripts/libtv_video.py create-session "new description" --session-id SESSION_ID
```

### After Submission

1. `create-session` returns immediately without blocking
2. **Reply to the user immediately**: "Your video is being generated. It typically takes 1-3 minutes and will be sent to you automatically when ready."
3. **Do not wait** — resume normal conversation
4. A sub-agent will automatically wait in the background and deliver the results

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
2. It reads historical sessions from the local persistence file and queries the gateway for latest status
3. Completed sessions → send the result URLs to the user directly
4. Still in progress → inform the user it's still generating

## Presenting Results

When generation completes, show both:
- **Result links** (video/image URLs)
- **Project canvas link** (projectUrl)

Do NOT show the project canvas link while generation is in progress.

### URL Rules

The only valid result URL prefix is `https://libtv-res.liblib.art/sd-gen-save-img/`. Any other domain (e.g. `medeo-res.liblib.art`) is a gateway proxy URL and must be ignored.

**Always present the URL exactly as extracted by the script.** Do not:
- Rewrite or transform URLs
- Use proxy/cache domain URLs as results
- Fabricate URLs by guessing paths

The `extract_result_urls()` function in the script extracts only `libtv-res.liblib.art/sd-gen-save-img/` URLs. Trust its output.

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

## Command Reference

| Scenario | Command | Blocking? |
|---|---|---|
| First-time setup | `setup --api-key mgk_xxx` | No |
| Check status | `check` | No |
| Update key | `update-key --api-key mgk_xxx` | No |
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
