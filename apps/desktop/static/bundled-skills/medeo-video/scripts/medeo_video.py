#!/usr/bin/env python3
"""Medeo Video Skill - AI video generation via Medeo Gateway

Usage:
  medeo_video.py setup --api-key mgk_xxx
  medeo_video.py check
  medeo_video.py update-key --api-key mgk_xxx
  medeo_video.py remove-key
  medeo_video.py recipes [--limit N]
  medeo_video.py upload --file /path/to/image.jpg
  medeo_video.py spawn-task --text "description" [--duration 5000] [--media-ids id1,id2]
  medeo_video.py task-status --task-id xxx
  medeo_video.py wait-and-deliver --task-id xxx
  medeo_video.py recover
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from datetime import datetime
from pathlib import Path

# ── Config management ──

def _nexu_home():
    return os.environ.get("NEXU_HOME", "").strip() or os.path.expanduser("~/.nexu")

def _medeo_config_path():
    return os.path.join(_nexu_home(), "medeo.json")

def _load_medeo_config():
    path = _medeo_config_path()
    if not os.path.exists(path):
        return {}
    with open(path, "r") as f:
        return json.load(f)

def _save_medeo_config(config):
    path = _medeo_config_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(config, f, indent=2, ensure_ascii=False)
    os.replace(tmp, path)

GATEWAY_URL = "https://medeo-gateway.powerformer.workers.dev"

def _get_gateway():
    config = _load_medeo_config()
    api_key = config.get("apiKey", "")
    return api_key, GATEWAY_URL

# ── Task persistence ──

def _tasks_file_path():
    return os.path.join(_nexu_home(), "medeo-tasks.json")

def _load_tasks():
    path = _tasks_file_path()
    if not os.path.exists(path):
        return []
    with open(path, "r") as f:
        return json.load(f)

def _save_task(task_id, status="pending", text=""):
    tasks = _load_tasks()
    for t in tasks:
        if t["task_id"] == task_id:
            t["status"] = status
            break
    else:
        tasks.append({
            "task_id": task_id,
            "status": status,
            "text": text[:50],
            "created_at": datetime.now().isoformat(),
        })
    tasks = tasks[-50:]
    path = _tasks_file_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(tasks, f, indent=2, ensure_ascii=False)
    os.replace(tmp, path)

def _get_pending_tasks():
    return [t for t in _load_tasks() if t["status"] not in ("completed", "failed", "timeout")]

# ── Video delivery ──

def deliver_video(video_url, thumbnail_url, task_id):
    """Deliver the video to the user's chat platform.

    Delivery strategy (by priority):
    1. OpenClaw message tool (sub-agent environment) — output a specific format for the agent to send
    2. Platform-specific script (feishu_send_video.py / telegram_send_video.py)
    3. Fallback: print the video link for the agent to forward

    In an OpenClaw sub-agent environment, the sub-agent reads stdout and sends via message tool.
    The script only needs to output video info; the actual sending is handled by the agent.
    """
    script_dir = os.path.dirname(os.path.abspath(__file__))

    # Detect chat platform from environment variables
    platform = os.environ.get("OPENCLAW_CHANNEL_TYPE", "").lower()
    chat_id = os.environ.get("OPENCLAW_CHAT_ID", "")

    if platform == "feishu" and chat_id:
        feishu_script = os.path.join(script_dir, "feishu_send_video.py")
        if os.path.exists(feishu_script):
            try:
                result = subprocess.run(
                    ["python3", feishu_script, "--video-url", video_url,
                     "--chat-id", chat_id,
                     *(["--thumbnail-url", thumbnail_url] if thumbnail_url else [])],
                    capture_output=True, text=True, timeout=60
                )
                if result.returncode == 0:
                    print(f"✅ Video sent to Feishu")
                    return
                print(f"⚠️ Feishu delivery failed: {result.stderr[:200]}", file=sys.stderr)
            except Exception as e:
                print(f"⚠️ Feishu delivery error: {e}", file=sys.stderr)

    elif platform == "telegram" and chat_id:
        telegram_script = os.path.join(script_dir, "telegram_send_video.py")
        if os.path.exists(telegram_script):
            try:
                result = subprocess.run(
                    ["python3", telegram_script, "--video-url", video_url,
                     "--chat-id", chat_id],
                    capture_output=True, text=True, timeout=60
                )
                if result.returncode == 0:
                    print(f"✅ Video sent to Telegram")
                    return
                print(f"⚠️ Telegram delivery failed: {result.stderr[:200]}", file=sys.stderr)
            except Exception as e:
                print(f"⚠️ Telegram delivery error: {e}", file=sys.stderr)

    # Fallback: output for the OpenClaw agent to send via message tool
    # This is the most universal approach, works for all platforms
    print(f"\n📹 Video generation complete. Please send to the user:")
    print(f"Video URL: {video_url}")
    if thumbnail_url:
        print(f"Thumbnail: {thumbnail_url}")

def deliver_failure(error_msg, task_id):
    """Notify the user that video generation failed"""
    print(f"\nPlease inform the user that video generation failed:")
    print(f"❌ {error_msg}")
    print(f"Suggest the user try again later.")

# ── Gateway API calls ──

def call_gateway(method, path, **kwargs):
    """Unified gateway call wrapper"""
    import urllib.request
    import urllib.error

    api_key, gateway_url = _get_gateway()
    if not api_key:
        print("❌ API Key not configured. Please run: medeo_video.py setup --api-key mgk_yourkey")
        sys.exit(1)

    url = f"{gateway_url}{path}"
    headers = {"X-API-KEY": api_key, "User-Agent": "MedeoSkill/2.0"}

    json_data = kwargs.get("json_data")
    files = kwargs.get("files")

    if files:
        # multipart upload
        import urllib.request
        filepath = files["file"]
        filename = os.path.basename(filepath)

        # Detect MIME type
        ext = os.path.splitext(filename)[1].lower()
        mime_map = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
                    ".webp": "image/webp", ".gif": "image/gif"}
        content_type = mime_map.get(ext, "application/octet-stream")

        boundary = "----MedeoSkillBoundary" + str(int(time.time()))
        body = bytearray()
        body.extend(f"--{boundary}\r\n".encode())
        body.extend(f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'.encode())
        body.extend(f"Content-Type: {content_type}\r\n\r\n".encode())
        with open(filepath, "rb") as f:
            body.extend(f.read())
        body.extend(f"\r\n--{boundary}--\r\n".encode())

        req = urllib.request.Request(url, data=bytes(body), method="POST")
        req.add_header("X-API-KEY", api_key)
        req.add_header("User-Agent", "MedeoSkill/2.0")
        req.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
    elif json_data is not None:
        data = json.dumps(json_data).encode()
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("X-API-KEY", api_key)
        req.add_header("User-Agent", "MedeoSkill/2.0")
        req.add_header("Content-Type", "application/json")
    else:
        req = urllib.request.Request(url, method=method)
        req.add_header("X-API-KEY", api_key)
        req.add_header("User-Agent", "MedeoSkill/2.0")

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        err_body = e.read().decode()
        try:
            error = json.loads(err_body).get("error", {})
            user_msg = error.get("user_message", f"Request failed (HTTP {e.code})")
            code = error.get("code", "unknown")
            print(f"❌ {user_msg}")
            if code == "quota_exceeded":
                details = error.get("details", {})
                used = details.get("used_count", "?")
                total = details.get("max_uses", "?")
                print(f"📊 Used {used}/{total}")
            elif code == "key_expired":
                print("⏰ Please contact the admin for a new Key")
            elif code == "medeo_credits_exhausted":
                print("📞 Please contact the Nexu admin")
        except (json.JSONDecodeError, KeyError):
            print(f"❌ Request failed (HTTP {e.code}): {err_body[:200]}")
        sys.exit(1)
    except urllib.error.URLError as e:
        print(f"❌ Cannot connect to gateway: {e.reason}")
        print(f"   Gateway URL: {gateway_url}")
        print("   Please check your network connection or verify the gateway URL")
        sys.exit(1)

# ── Image compression ──

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}

def _find_compress_tool():
    if shutil.which("sips"):
        return "sips"
    if shutil.which("ffmpeg"):
        return "ffmpeg"
    try:
        import PIL
        return "pillow"
    except ImportError:
        pass
    return None

def _get_install_hint():
    import platform
    system = platform.system().lower()
    if system == "darwin":
        return "brew install ffmpeg"
    return "sudo apt install ffmpeg"

def compress_image(filepath):
    """Aggressively compress image with zero additional dependencies"""
    tool = _find_compress_tool()
    if tool is None:
        hint = _get_install_hint()
        print(f"\n⚠️ A compression tool is needed to reduce upload size.")
        print(f"📦 Install command: {hint}")
        print(f"Type 'y' to retry after installing, or anything else to skip:")
        try:
            answer = input().strip().lower()
        except (EOFError, KeyboardInterrupt):
            answer = ""
        if answer == "y":
            tool = _find_compress_tool()
        if tool is None:
            print("⏭️ Skipping compression, uploading original image")
            return filepath

    original_size = os.path.getsize(filepath)
    if original_size < 200 * 1024:
        return filepath

    try:
        tmp = tempfile.NamedTemporaryFile(suffix=".jpg", delete=False)
        tmp.close()

        if tool == "sips":
            subprocess.run([
                "sips", "--resampleHeightWidthMax", "1920",
                "--setProperty", "formatOptions", "70",
                "-s", "format", "jpeg", filepath, "--out", tmp.name
            ], capture_output=True, timeout=30)
        elif tool == "ffmpeg":
            subprocess.run([
                "ffmpeg", "-y", "-i", filepath,
                "-vf", "scale='min(1920,iw)':'-1'",
                "-q:v", "8", tmp.name
            ], capture_output=True, timeout=30)
        elif tool == "pillow":
            from PIL import Image
            img = Image.open(filepath)
            if img.mode not in ("RGB", "L"):
                img = img.convert("RGB")
            img.thumbnail((1920, 1920), Image.LANCZOS)
            img.save(tmp.name, "JPEG", quality=70, optimize=True)

        compressed_size = os.path.getsize(tmp.name)
        if compressed_size == 0 or compressed_size >= original_size:
            os.unlink(tmp.name)
            return filepath

        ratio = (1 - compressed_size / original_size) * 100
        print(f"📦 Image compressed ({tool}): {original_size//1024}KB → {compressed_size//1024}KB (-{ratio:.0f}%)")
        return tmp.name
    except Exception as e:
        print(f"⚠️ Compression skipped: {e}")
        if os.path.exists(tmp.name):
            os.unlink(tmp.name)
        return filepath

# ── Subcommand implementations ──

def cmd_setup(args):
    config = _load_medeo_config()
    if args.api_key:
        if not args.api_key.startswith("mgk_"):
            print("❌ Invalid API Key format. It should start with mgk_. Please verify the Key from your admin.")
            sys.exit(1)
        config["apiKey"] = args.api_key
        print(f"✅ API Key saved (****{args.api_key[-4:]})")
    _save_medeo_config(config)
    print(f"📁 Config written to: {_medeo_config_path()}")

def cmd_check(args):
    config = _load_medeo_config()
    if not config.get("apiKey"):
        print("❌ API Key not configured.")
        print("📋 Please obtain a Key from the admin, then run:")
        print("   python3 medeo_video.py setup --api-key mgk_yourkey")
        sys.exit(1)

    key = config["apiKey"]
    print(f"🔑 API Key: ****{key[-4:]}")
    print(f"🌐 Gateway: {GATEWAY_URL}")
    print(f"📁 Config: {_medeo_config_path()}")

    result = call_gateway("GET", "/api/v1/key/status")
    print(f"✅ Key valid")
    print(f"📊 Remaining uses: {result['remaining_uses']}/{result['max_uses']}")
    if result.get("expires_at"):
        print(f"⏰ Expires at: {result['expires_at']}")

def cmd_update_key(args):
    config = _load_medeo_config()
    old_key = config.get("apiKey")
    if not args.api_key.startswith("mgk_"):
        print("❌ Invalid API Key format. It should start with mgk_.")
        sys.exit(1)
    config["apiKey"] = args.api_key
    _save_medeo_config(config)
    if old_key:
        print(f"✅ API Key updated: ****{old_key[-4:]} → ****{args.api_key[-4:]}")
    else:
        print(f"✅ API Key saved: ****{args.api_key[-4:]}")

def cmd_remove_key(args):
    config = _load_medeo_config()
    if not config.get("apiKey"):
        print("ℹ️ No API Key saved locally.")
        return
    old_key = config.pop("apiKey")
    _save_medeo_config(config)
    print(f"✅ API Key removed (****{old_key[-4:]})")

def cmd_recipes(args):
    limit = args.limit or 10
    result = call_gateway("GET", f"/oapi/v1/recipes?limit={limit}")
    recipes = result.get("list", [])
    print(f"📋 {len(recipes)} templates found:")
    for r in recipes:
        name = r.get("name", "?")
        rid = r.get("id", "?")
        est = r.get("estimated_credits", "?")
        free = "🆓" if r.get("is_free") else ""
        print(f"  {free} {name} (id={rid[:20]}... credits≈{est})")

def cmd_upload(args):
    filepath = args.file
    if not os.path.exists(filepath):
        print(f"❌ File not found: {filepath}")
        sys.exit(1)

    ext = os.path.splitext(filepath)[1].lower()
    if ext not in IMAGE_EXTENSIONS:
        print(f"❌ Unsupported file format: {ext}")
        print("   Supported: JPG, PNG, WebP, GIF")
        sys.exit(1)

    # Compress
    upload_path = compress_image(filepath)

    try:
        result = call_gateway("POST", "/api/v1/files/upload", files={"file": upload_path})
        print(f"✅ Upload successful")
        print(f"   file_id: {result['fileId']}")
        print(f"   public_url: {result['publicUrl']}")

        # Register with Medeo using the R2 URL
        print("🔄 Registering with Medeo...")
        media_result = call_gateway("POST", "/oapi/v1/media:create_from_url",
                                     json_data={"url": result["publicUrl"]})
        job_id = media_result.get("id", "")
        print(f"   media_job_id: {job_id}")

        # Poll media upload status
        for i in range(20):
            status_result = call_gateway("GET", f"/oapi/v1/media:create_from_url_status?job_id={job_id}")
            state = status_result.get("state", "?")
            media_ids = status_result.get("media_ids", [])
            if state == "completed" and media_ids:
                print(f"✅ Media registration complete: media_id={media_ids[0]}")
                return
            if state == "failed":
                print(f"❌ Media registration failed")
                sys.exit(1)
            time.sleep(3)

        print("⚠️ Media registration timed out, please try again later")
    finally:
        if upload_path != filepath and os.path.exists(upload_path):
            os.unlink(upload_path)

def cmd_spawn_task(args):
    # Pre-flight check
    config = _load_medeo_config()
    if not config.get("apiKey"):
        print("❌ API Key not configured. Please run setup first.")
        sys.exit(1)

    # Duration validation
    duration = args.duration or 5000
    if duration > 20000:
        print("❌ Video duration cannot exceed 20 seconds. Please shorten the duration and try again.")
        sys.exit(1)

    body = {
        "text": args.text,
        "settings": {
            "duration_ms": duration,
            "aspect_ratio": args.aspect_ratio or "16:9",
        }
    }
    if args.media_ids:
        body["media_ids"] = args.media_ids.split(",")

    result = call_gateway("POST", "/oapi/v1/videos:create", json_data=body)
    task_id = result["task_id"]
    job_id = result.get("job_id", "")

    # Persist task
    _save_task(task_id, status="composing", text=args.text)

    # Output task info to stderr for the agent to read
    print(f"✅ Video generation submitted (task_id: {task_id})", file=sys.stderr)
    print(f"⏳ Typically takes 5-15 minutes.", file=sys.stderr)
    print(f"📋 Set up a cron monitor with: cron add schedule.kind=every schedule.everyMs=180000 sessionTarget=main payload.kind=systemEvent payload.text=\"[medeo-progress] task_id={task_id}\"", file=sys.stderr)

def cmd_wait_and_deliver(args):
    """Legacy blocking wait — kept for backward compatibility and manual use."""
    task_id = args.task_id
    if not task_id:
        pending = _get_pending_tasks()
        if pending:
            task_id = pending[-1]["task_id"]
            print(f"Recovered task from persistence file: {task_id}")
        else:
            print("❌ No pending video tasks found")
            return

    poll_interval = 60
    max_polls = 90

    for i in range(max_polls):
        result = call_gateway("GET", f"/api/v1/tasks/{task_id}")
        status = result.get("status", "unknown")
        _save_task(task_id, status=status)

        if status == "completed":
            video_url = result.get("video_url", "")
            thumbnail_url = result.get("thumbnail_url", "")
            print(f"✅ Video generation complete!")
            print(f"🎬 Video URL: {video_url}")
            deliver_video(video_url, thumbnail_url, task_id)
            return
        if status == "failed":
            error_msg = result.get("error_message", "Unknown error")
            print(f"❌ Video generation failed: {error_msg}")
            _save_task(task_id, status="failed")
            deliver_failure(error_msg, task_id)
            return

        status_labels = {
            "pending": "Queued", "composing": "AI composing",
            "composed": "Composed, preparing to render", "rendering": "Rendering",
            "rendered": "Rendered, transferring", "storing": "Transferring video",
        }
        label = status_labels.get(status, status)
        elapsed = i + 1
        print(f"⏳ [{elapsed}min/{max_polls}min] {label}...")
        time.sleep(poll_interval)

    print("❌ Video generation timed out (exceeded 90 minutes)")
    _save_task(task_id, status="timeout")

def cmd_task_status(args):
    task_id = args.task_id
    result = call_gateway("GET", f"/api/v1/tasks/{task_id}")
    status = result.get("status", "unknown")
    _save_task(task_id, status=status)

    status_labels = {
        "pending": "Queued", "composing": "AI composing",
        "composed": "Composed, awaiting render", "rendering": "Rendering",
        "rendered": "Rendered, transferring", "storing": "Transferring video",
        "completed": "Completed", "failed": "Failed",
    }
    print(f"Task status: {status_labels.get(status, status)}")
    if status == "completed":
        print(f"🎬 Video URL: {result.get('video_url', 'N/A')}")
        print(f"⚠️ Task finished. Remove the cron monitor if one is active.")
    elif status == "failed":
        print(f"❌ Error: {result.get('error_message', 'N/A')}")
        print(f"⚠️ Task finished. Remove the cron monitor if one is active.")

def cmd_recover(args):
    pending = _get_pending_tasks()
    if not pending:
        print("No pending video tasks.")
        return

    print(f"Found {len(pending)} pending task(s):")
    for t in pending:
        tid = t["task_id"]
        result = call_gateway("GET", f"/api/v1/tasks/{tid}")
        server_status = result.get("status", "unknown")
        _save_task(tid, status=server_status)

        if server_status == "completed":
            print(f"  ✅ {tid[:16]}... Completed! Video: {result.get('video_url', 'N/A')}")
        elif server_status == "failed":
            print(f"  ❌ {tid[:16]}... Failed: {result.get('error_message', 'N/A')}")
        else:
            status_labels = {"composing": "AI composing", "rendering": "Rendering", "storing": "Transferring"}
            label = status_labels.get(server_status, server_status)
            print(f"  ⏳ {tid[:16]}... {label}")

# ── CLI entry point ──

def main():
    parser = argparse.ArgumentParser(description="Medeo Video Skill")
    sub = parser.add_subparsers(dest="command")

    # setup
    p = sub.add_parser("setup", help="Configure API Key and gateway URL")
    p.add_argument("--api-key", help="API Key starting with mgk_")

    # check
    sub.add_parser("check", help="Check configuration and Key status")

    # update-key
    p = sub.add_parser("update-key", help="Update API Key")
    p.add_argument("--api-key", required=True, help="New mgk_ Key")

    # remove-key
    sub.add_parser("remove-key", help="Remove local API Key")

    # recipes
    p = sub.add_parser("recipes", help="Browse video templates")
    p.add_argument("--limit", type=int, default=10)

    # upload
    p = sub.add_parser("upload", help="Upload an image")
    p.add_argument("--file", required=True, help="Image file path")

    # spawn-task
    p = sub.add_parser("spawn-task", help="Submit video generation (async)")
    p.add_argument("--text", required=True, help="Video description")
    p.add_argument("--duration", type=int, default=15000, help="Duration in ms (min 15000, max 20000)")
    p.add_argument("--aspect-ratio", default="16:9", choices=["16:9", "9:16"])
    p.add_argument("--media-ids", help="Media IDs (comma-separated)")

    # wait-and-deliver
    p = sub.add_parser("wait-and-deliver", help="Wait for video completion and deliver (used by sub-agent)")
    p.add_argument("--task-id", help="Task ID")

    # task-status
    p = sub.add_parser("task-status", help="Query task status")
    p.add_argument("--task-id", required=True, help="Task ID")

    # recover
    sub.add_parser("recover", help="Recover pending tasks")

    args = parser.parse_args()

    commands = {
        "setup": cmd_setup,
        "check": cmd_check,
        "update-key": cmd_update_key,
        "remove-key": cmd_remove_key,
        "recipes": cmd_recipes,
        "upload": cmd_upload,
        "spawn-task": cmd_spawn_task,
        "wait-and-deliver": cmd_wait_and_deliver,
        "task-status": cmd_task_status,
        "recover": cmd_recover,
    }

    if args.command in commands:
        commands[args.command](args)
    else:
        parser.print_help()

if __name__ == "__main__":
    main()
