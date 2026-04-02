---
name: Medeo Video
description: AI video generation via Medeo Gateway - generate short videos (15-20 seconds). Supports text-only and image+text generation. Trigger phrases: "generate video", "make a video", "medeo".
homepage: https://www.medeo.app/
metadata:
  {
    "openclaw":
      {
        "emoji": "🎬",
        "requires": { "bins": ["python3"] },
      },
  }
---

# Medeo Video Generation

Generate AI short videos (15-20 seconds) for users via Medeo Gateway. Supports text-only and image+text generation.

## Requirements

- Python 3.8+
- `apiKey` configured in `~/.nexu/medeo.json`
- Optional: `ffmpeg` or `sips` (for image compression)

## First-Time Setup

If the user has not configured an API Key, guide them to:
1. Contact the admin to obtain an API Key starting with `mgk_`
2. Run: `python3 scripts/medeo_video.py setup --api-key mgk_yourkey`
3. Run: `python3 scripts/medeo_video.py check` to confirm the configuration is correct

## Pre-Generation Check (must run before each generation)

1. Run `python3 scripts/medeo_video.py check`
2. Interpret the output:
   - "API Key not configured" → guide the user to contact the admin for a key, then run setup
   - "Key valid, N uses remaining" → inform the user of remaining quota, proceed with generation
   - "Key expired / exhausted" → guide the user to contact the admin, run update-key
   - "Cannot connect to gateway" → suggest checking network connectivity
3. Only proceed with generation after check passes

## Video Generation (async, non-blocking)

### Text-Only Generation

```bash
python3 scripts/medeo_video.py spawn-task --text "user's video description" --duration 5000
```

### Image+Text Generation

```bash
# 1. Upload the image first
python3 scripts/medeo_video.py upload --file /path/to/image.jpg
# Output: media_id=media_xxx

# 2. Generate with the image
python3 scripts/medeo_video.py spawn-task --text "make a video from this image" --duration 5000 --media-ids media_xxx
```

### After Submission

1. `spawn-task` returns immediately. Read `task_id` from the stderr output (line starting with `✅`)
2. **Tell the user** their video is being generated (typically 5-15 minutes) and you'll keep them updated
3. **Set up a progress monitor** — use the `cron` tool to check progress every 3 minutes:
   ```
   cron add {
     "schedule": { "kind": "every", "everyMs": 120000 },
     "sessionTarget": "main",
     "payload": {
       "kind": "systemEvent",
       "text": "[medeo-progress] task_id=<TASK_ID> — Run: python3 scripts/medeo_video.py task-status --task-id <TASK_ID> and act on the result."
     }
   }
   ```
4. **Do not wait** — resume normal conversation immediately
5. When the cron fires, you will receive a system event. Handle it:
   - Run `task-status --task-id <id>` to get the current state
   - If status changed → casually mention it to the user, like a friend giving a quick update (e.g. "your video is rendering now, almost there!")
   - If completed → you MUST send the video URL to the user immediately. Never just say "completed" without the link. Then `cron remove <job_id>`
   - If failed → let the user know, then `cron remove <job_id>`
   - If no change → use your judgement based on how long since your last update. Don't repeat the same status.
   - **Keep it brief and conversational** — no task IDs, no technical jargon, no system-notification style
6. **Important**: Remember the cron `job_id` so you can remove it when done. The script will also remind you.

## When the User Asks "Is my video ready?"

1. Run `python3 scripts/medeo_video.py task-status --task-id <id>`
   - If you don't remember the task_id, run `python3 scripts/medeo_video.py recover` to see all tasks
2. Reply based on the output:
   - "AI composing" → still working on it, the AI is composing the scene
   - "Rendering" → scene is ready, rendering the video now — almost there
   - "Completed" → send the video link directly to the user
   - "Failed" → relay the error message and suggest retrying

## Task Recovery (after memory loss / agent restart)

If you don't remember whether a video was previously generated:
1. Run `python3 scripts/medeo_video.py recover`
2. It reads historical tasks from the local persistence file and queries the gateway for latest status
3. Completed tasks → send the video_url to the user directly
4. Still in progress → inform the user it's still generating, and set up a new cron monitor

## Duration Limit

- Default **15 seconds**, maximum **20 seconds**. If the user requests more than 20 seconds, reject upfront — do not call the API
- Tell the user the video duration limit is 20 seconds and ask them to shorten it.

## Error Handling

When any command returns an error:
1. Read the message after "❌" in the output and **relay it to the user as-is**
2. Do not fabricate or translate error messages
3. Provide action suggestions based on the error type:

| Error keyword seen | Suggested action |
|---|---|
| "Invalid API Key" | Run `check`, contact admin to confirm key |
| "Free trial uses exhausted" | Tell user to visit https://www.medeo.app/ to register for a key |
| "Key expired" | Contact admin for a new key, run `update-key` |
| "Platform credits insufficient" | Inform user service is temporarily unavailable, contact Nexu admin |
| "File too large" | Suggest the user send a smaller file |
| "Video upload not supported" | Tell user only images can be used as source material |
| "Video duration cannot exceed 20 seconds" | Suggest shortening the duration |
| "Service temporarily unavailable" | Wait a few minutes and retry |

## Command Reference

| Scenario | Command | Blocking? |
|---|---|---|
| First-time setup | `setup --api-key mgk_xxx` | No |
| Check status | `check` | No |
| Update key | `update-key --api-key mgk_newkey` | No |
| Remove key | `remove-key` | No |
| Browse templates | `recipes` | No |
| Upload image | `upload --file /path/to/image.jpg` | No |
| **Generate video** | **`spawn-task --text "description" --duration 5000`** | **No** |
| Check task status | `task-status --task-id xxx` | No |
| Recover tasks | `recover` | No |

Script path for all commands: `scripts/medeo_video.py`
