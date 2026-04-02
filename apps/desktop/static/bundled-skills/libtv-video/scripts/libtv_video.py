#!/usr/bin/env python3
"""LibTV Video Skill - AI video/image generation via LibTV Gateway

Usage:
  libtv_video.py setup --api-key mgk_xxx
  libtv_video.py check
  libtv_video.py update-key --api-key mgk_xxx
  libtv_video.py remove-key
  libtv_video.py upload --file /path/to/image.png
  libtv_video.py create-session "description" [--session-id SESSION_ID]
  libtv_video.py query-session SESSION_ID [--after-seq N] [--project-id UUID]
  libtv_video.py download-results SESSION_ID [--output-dir DIR] [--prefix PREFIX]
  libtv_video.py download-results --urls URL1 URL2 [--output-dir DIR]
  libtv_video.py wait-and-deliver --session-id SESSION_ID [--project-id UUID]
  libtv_video.py change-project
"""

import argparse
import json
import os
import re
import sys
import time
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime

# ── Config management ──

GATEWAY_URL = "https://medeo-gateway.powerformer.workers.dev"
PROJECT_CANVAS_BASE = "https://www.liblib.tv/canvas?projectId="

def _nexu_home():
    return os.environ.get("NEXU_HOME", "").strip() or os.path.expanduser("~/.nexu")

def _config_path():
    return os.path.join(_nexu_home(), "libtv.json")

def _load_config():
    path = _config_path()
    if not os.path.exists(path):
        return {}
    with open(path, "r") as f:
        return json.load(f)

def _save_config(config):
    path = _config_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(config, f, indent=2, ensure_ascii=False)
    os.replace(tmp, path)

def _get_api_key():
    return _load_config().get("apiKey", "")

# ── Session persistence ──

def _sessions_file_path():
    return os.path.join(_nexu_home(), "libtv-sessions.json")

def _load_sessions():
    path = _sessions_file_path()
    if not os.path.exists(path):
        return []
    with open(path, "r") as f:
        return json.load(f)

def _save_session(session_id, project_uuid="", status="active", text="",
                   result_urls=None, completed_at=""):
    sessions = _load_sessions()
    for s in sessions:
        if s["session_id"] == session_id:
            s["status"] = status
            if project_uuid:
                s["project_uuid"] = project_uuid
            if result_urls:
                s["result_urls"] = result_urls
            if completed_at:
                s["completed_at"] = completed_at
            break
    else:
        entry = {
            "session_id": session_id,
            "project_uuid": project_uuid,
            "status": status,
            "text": text[:80],
            "created_at": datetime.now().isoformat(),
        }
        if result_urls:
            entry["result_urls"] = result_urls
        if completed_at:
            entry["completed_at"] = completed_at
        sessions.append(entry)
    sessions = sessions[-50:]
    path = _sessions_file_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(sessions, f, indent=2, ensure_ascii=False)
    os.replace(tmp, path)

def _get_pending_sessions():
    return [s for s in _load_sessions() if s["status"] not in ("completed", "failed", "timeout")]

# ── URL extraction ──

LIBTV_RES_PATTERN = re.compile(
    r"https://libtv-res\.liblib\.art/sd-gen-save-img/[^\s\"'<>)]+"
)

def extract_result_urls(messages):
    """Extract all result media URLs from session messages."""
    if not messages:
        return []
    urls = []
    for msg in messages:
        content = msg.get("content", "")
        if not content or not isinstance(content, str):
            continue

        role = msg.get("role", "")

        # From tool messages: parse task_result JSON
        if role == "tool":
            try:
                data = json.loads(content)
                task_result = data.get("task_result", {})
                for img in task_result.get("images") or []:
                    preview = img.get("previewPath", "")
                    if preview:
                        urls.append(preview)
                for vid in task_result.get("videos") or []:
                    preview = vid.get("previewPath", vid.get("url", ""))
                    if preview:
                        urls.append(preview)
            except (json.JSONDecodeError, AttributeError):
                pass

        # From assistant messages: extract libtv-res URLs
        if role == "assistant":
            found = LIBTV_RES_PATTERN.findall(content)
            urls.extend(found)

    # Dedupe preserving order
    seen = set()
    unique = []
    for u in urls:
        if u not in seen:
            seen.add(u)
            unique.append(u)
    return unique

# ── Gateway API calls ──

def call_gateway(method, path, **kwargs):
    """Unified gateway call wrapper."""
    api_key = _get_api_key()
    if not api_key:
        print("❌ API Key not configured. Run: libtv_video.py setup --api-key mgk_yourkey")
        sys.exit(1)

    url = f"{GATEWAY_URL}{path}"
    headers = {"X-API-KEY": api_key, "User-Agent": "LibTVSkill/1.0"}

    json_data = kwargs.get("json_data")
    files = kwargs.get("files")
    timeout = kwargs.get("timeout", 30)

    if files:
        filepath = files["file"]
        filename = os.path.basename(filepath)
        import mimetypes
        content_type, _ = mimetypes.guess_type(filepath)
        content_type = content_type or "application/octet-stream"

        boundary = f"----LibTVSkillBoundary{int(time.time())}"
        body = bytearray()
        body.extend(f"--{boundary}\r\n".encode())
        body.extend(f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'.encode())
        body.extend(f"Content-Type: {content_type}\r\n\r\n".encode())
        with open(filepath, "rb") as f:
            body.extend(f.read())
        body.extend(f"\r\n--{boundary}--\r\n".encode())

        req = urllib.request.Request(url, data=bytes(body), method="POST")
        for k, v in headers.items():
            req.add_header(k, v)
        req.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
    elif json_data is not None:
        data = json.dumps(json_data).encode()
        req = urllib.request.Request(url, data=data, method=method)
        for k, v in headers.items():
            req.add_header(k, v)
        req.add_header("Content-Type", "application/json")
    else:
        req = urllib.request.Request(url, method=method)
        for k, v in headers.items():
            req.add_header(k, v)

    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        err_body = e.read().decode()
        try:
            error = json.loads(err_body).get("error", {})
            user_msg = error.get("user_message", f"Request failed (HTTP {e.code})")
            print(f"❌ {user_msg}")
        except (json.JSONDecodeError, KeyError):
            print(f"❌ Request failed (HTTP {e.code}): {err_body[:200]}")
        sys.exit(1)
    except urllib.error.URLError as e:
        print(f"❌ Cannot connect to gateway: {e.reason}")
        sys.exit(1)

# ── Video delivery ──

def deliver_results(urls, project_uuid=""):
    """Output results for the agent to send to the user."""
    print(f"\n✅ Generation complete! {len(urls)} result(s):")
    for i, url in enumerate(urls, 1):
        ext = os.path.splitext(url.split("?")[0])[-1]
        media_type = "Video" if ext in (".mp4", ".mov", ".webm") else "Image"
        print(f"  {i}. [{media_type}] {url}")
    if project_uuid:
        print(f"\n🎨 Project canvas: {PROJECT_CANVAS_BASE}{project_uuid}")

def deliver_failure(error_msg):
    """Notify the user that generation failed."""
    print(f"\n❌ Generation failed: {error_msg}")
    print("Suggest the user try again later.")

# ── File download ──

def download_file(url, filepath):
    """Download a single file."""
    req = urllib.request.Request(url, headers={"User-Agent": "LibTVSkill/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            with open(filepath, "wb") as f:
                while True:
                    chunk = resp.read(8192)
                    if not chunk:
                        break
                    f.write(chunk)
        return filepath, None
    except Exception as e:
        return filepath, str(e)

# ── Subcommand implementations ──

def cmd_setup(args):
    config = _load_config()
    if args.api_key:
        if not args.api_key.startswith("mgk_"):
            print("❌ Invalid API Key format. It should start with mgk_.")
            sys.exit(1)
        config["apiKey"] = args.api_key
        print(f"✅ API Key saved (****{args.api_key[-4:]})")
    _save_config(config)
    print(f"📁 Config: {_config_path()}")

def cmd_check(args):
    config = _load_config()
    if not config.get("apiKey"):
        print("❌ API Key not configured.")
        print("   Run: libtv_video.py setup --api-key mgk_yourkey")
        sys.exit(1)

    key = config["apiKey"]
    print(f"🔑 API Key: ****{key[-4:]}")
    print(f"🌐 Gateway: {GATEWAY_URL}")
    print(f"📁 Config: {_config_path()}")

    result = call_gateway("GET", "/api/v1/key/status")
    print("✅ Key valid")
    print(f"📊 Remaining uses: {result['remaining_uses']}/{result['max_uses']}")
    if result.get("expires_at"):
        print(f"⏰ Expires at: {result['expires_at']}")

def cmd_update_key(args):
    if not args.api_key.startswith("mgk_"):
        print("❌ Invalid API Key format. It should start with mgk_.")
        sys.exit(1)
    config = _load_config()
    old_key = config.get("apiKey")
    config["apiKey"] = args.api_key
    _save_config(config)
    if old_key:
        print(f"✅ Key updated: ****{old_key[-4:]} → ****{args.api_key[-4:]}")
    else:
        print(f"✅ Key saved: ****{args.api_key[-4:]}")

def cmd_remove_key(args):
    config = _load_config()
    if not config.get("apiKey"):
        print("ℹ️ No API Key saved locally.")
        return
    old_key = config.pop("apiKey")
    _save_config(config)
    print(f"✅ Key removed (****{old_key[-4:]})")

def cmd_upload(args):
    filepath = args.file
    if not os.path.exists(filepath):
        print(f"❌ File not found: {filepath}")
        sys.exit(1)

    size_mb = os.path.getsize(filepath) / (1024 * 1024)
    if size_mb > 200:
        print(f"❌ File too large ({size_mb:.1f}MB). Maximum 200MB.")
        sys.exit(1)

    import mimetypes
    mime, _ = mimetypes.guess_type(filepath)
    if mime and not (mime.startswith("image/") or mime.startswith("video/")):
        print(f"❌ Unsupported file type: {mime}. Only image and video files supported.")
        sys.exit(1)

    result = call_gateway("POST", "/libtv/v1/upload", files={"file": filepath}, timeout=120)
    oss_url = result.get("url", "")
    if not oss_url:
        print("❌ Upload failed: no URL returned")
        sys.exit(1)

    print(f"✅ Upload successful")
    print(f"   url: {oss_url}")
    print(json.dumps({"url": oss_url}, ensure_ascii=False))

MODEL_HINT = ", please use Seedance 2.0"

def _append_model_hint(message):
    """Append Seedance 2.0 model hint if no model is explicitly mentioned."""
    if not message:
        return message
    model_keywords = ["seedance", "kling", "wan ", "midjourney", "seedream", "nanobanana"]
    lower = message.lower()
    if any(kw in lower for kw in model_keywords):
        return message
    return message + MODEL_HINT

def cmd_create_session(args):
    body = {}
    if args.session_id:
        body["sessionId"] = args.session_id
    if args.message:
        body["message"] = _append_model_hint(args.message)

    result = call_gateway("POST", "/libtv/v1/session", json_data=body)
    session_id = result.get("sessionId", "")
    project_uuid = result.get("projectUuid", "")

    if not session_id:
        print("❌ Failed: no sessionId returned")
        sys.exit(1)

    # Persist
    _save_session(session_id, project_uuid=project_uuid, text=args.message or "")

    # Collect env vars for sub-agent
    passthrough_env = {}
    for var in [
        "OPENCLAW_CHANNEL_TYPE", "OPENCLAW_CHAT_ID",
        "OPENCLAW_CONFIG", "OPENCLAW_STATE_DIR",
        "FEISHU_APP_ID", "FEISHU_APP_SECRET",
        "NEXU_HOME",
    ]:
        val = os.environ.get(var, "")
        if val:
            passthrough_env[var] = val

    # Output sessions_spawn payload for OpenClaw
    spawn_payload = {
        "sessions_spawn": {
            "instruction": (
                f"Wait for LibTV session {session_id} to complete, then send results to user. "
                f"Use command: python3 scripts/libtv_video.py wait-and-deliver "
                f"--session-id {session_id} --project-id {project_uuid}"
            ),
            "runTimeoutSeconds": 600,
            **({"env": passthrough_env} if passthrough_env else {}),
        }
    }
    print(json.dumps(spawn_payload))

    # Info to stderr
    out = {
        "projectUuid": project_uuid,
        "sessionId": session_id,
        "projectUrl": f"{PROJECT_CANVAS_BASE}{project_uuid}",
    }
    print(json.dumps(out, ensure_ascii=False, indent=2), file=sys.stderr)
    print("⏳ Generation submitted. Results will be delivered automatically.", file=sys.stderr)

def cmd_query_session(args):
    session_id = args.session_id
    path = f"/libtv/v1/session/{session_id}"
    if args.after_seq > 0:
        path += f"?afterSeq={args.after_seq}"

    result = call_gateway("GET", path)
    messages = result.get("messages") or []

    # Extract result URLs
    urls = extract_result_urls(messages)

    # Persist results to local so recover can read without API
    if urls:
        _save_session(session_id, project_uuid=args.project_id or "", status="completed",
                      result_urls=urls, completed_at=datetime.now().isoformat())

    out = {"messages": messages}
    if args.project_id:
        out["projectUrl"] = f"{PROJECT_CANVAS_BASE}{args.project_id}"
    if urls:
        out["result_urls"] = urls

    print(json.dumps(out, ensure_ascii=False, indent=2))

def cmd_download_results(args):
    urls = list(args.urls or [])

    if args.session_id:
        result = call_gateway("GET", f"/libtv/v1/session/{args.session_id}/results")
        extracted = result.get("urls", [])
        urls.extend(extracted)

    if not urls:
        print(json.dumps({"error": "No result URLs found", "downloaded": []},
                         ensure_ascii=False, indent=2))
        sys.exit(1)

    output_dir = args.output_dir or os.path.expanduser("~/Downloads/libtv_results")
    os.makedirs(output_dir, exist_ok=True)

    tasks = []
    for i, url in enumerate(urls, 1):
        ext = os.path.splitext(url.split("?")[0])[-1] or ".png"
        if args.prefix:
            filename = f"{args.prefix}_{i:02d}{ext}"
        else:
            filename = f"{i:02d}{ext}"
        filepath = os.path.join(output_dir, filename)
        tasks.append((url, filepath))

    results = []
    errors = []
    with ThreadPoolExecutor(max_workers=5) as pool:
        futures = {pool.submit(download_file, url, fp): (url, fp) for url, fp in tasks}
        for future in as_completed(futures):
            fp, err = future.result()
            if err:
                errors.append({"file": fp, "error": err})
            else:
                results.append(fp)

    results.sort()
    output = {
        "output_dir": output_dir,
        "downloaded": results,
        "total": len(results),
    }
    if errors:
        output["errors"] = errors
    print(json.dumps(output, ensure_ascii=False, indent=2))

def cmd_wait_and_deliver(args):
    session_id = args.session_id
    project_uuid = args.project_id or ""
    poll_interval = 8
    max_polls = 23  # ~3 minutes (23 x 8s = 184s)

    for i in range(max_polls):
        result = call_gateway("GET", f"/libtv/v1/session/{session_id}")
        messages = result.get("messages") or []
        urls = extract_result_urls(messages)

        if urls:
            _save_session(session_id, project_uuid=project_uuid, status="completed",
                          result_urls=urls, completed_at=datetime.now().isoformat())
            deliver_results(urls, project_uuid=project_uuid)

            # Auto-download
            output_dir = os.path.expanduser("~/Downloads/libtv_results")
            os.makedirs(output_dir, exist_ok=True)
            downloaded = []
            for j, url in enumerate(urls, 1):
                ext = os.path.splitext(url.split("?")[0])[-1] or ".png"
                filepath = os.path.join(output_dir, f"{session_id[:8]}_{j:02d}{ext}")
                fp, err = download_file(url, filepath)
                if not err:
                    downloaded.append(fp)
            if downloaded:
                print(f"\n📥 Downloaded {len(downloaded)} file(s) to {output_dir}")
                for d in downloaded:
                    print(f"   {d}")
            return

        elapsed = (i + 1) * poll_interval
        total = max_polls * poll_interval
        print(f"⏳ [{elapsed}s/{total}s] AI is generating, checking again in {poll_interval} seconds...", file=sys.stderr)
        time.sleep(poll_interval)

    # Timeout
    _save_session(session_id, project_uuid=project_uuid, status="timeout")
    print("⚠️ Generation is still in progress after 3 minutes.")
    print(f"   You can check later with: libtv_video.py query-session {session_id}")
    if project_uuid:
        print(f"   Or view on the project canvas: {PROJECT_CANVAS_BASE}{project_uuid}")


def cmd_recover(args):
    sessions = _load_sessions()
    if not sessions:
        print("No sessions found.")
        return

    # Show completed sessions from local (no API call needed)
    completed = [s for s in sessions if s["status"] in ("completed", "failed", "timeout")]
    pending = [s for s in sessions if s["status"] not in ("completed", "failed", "timeout")]

    if completed:
        print(f"📋 {len(completed)} completed session(s) (from local):")
        for s in completed[-10:]:
            sid = s["session_id"]
            project_uuid = s.get("project_uuid", "")
            local_urls = s.get("result_urls", [])
            status = s["status"]
            text = s.get("text", "")

            if status == "completed" and local_urls:
                print(f"  ✅ {sid[:16]}... Completed ({text})")
                for url in local_urls:
                    print(f"     🎬 {url}")
                if project_uuid:
                    print(f"     🎨 Canvas: {PROJECT_CANVAS_BASE}{project_uuid}")
            elif status == "failed":
                print(f"  ❌ {sid[:16]}... Failed ({text})")
            elif status == "timeout":
                print(f"  ⏰ {sid[:16]}... Timeout ({text})")
            else:
                # Completed but no local URLs — re-fetch once
                try:
                    result = call_gateway("GET", f"/libtv/v1/session/{sid}")
                    messages = result.get("messages") or []
                    urls = extract_result_urls(messages)
                    if urls:
                        _save_session(sid, project_uuid=project_uuid, status="completed",
                                      result_urls=urls, completed_at=datetime.now().isoformat())
                        print(f"  ✅ {sid[:16]}... Completed ({text})")
                        for url in urls:
                            print(f"     🎬 {url}")
                    else:
                        print(f"  ✅ {sid[:16]}... Completed, no result URLs ({text})")
                except Exception as e:
                    print(f"  ✅ {sid[:16]}... Completed, fetch error: {e}")

    if not pending:
        if not completed:
            print("No sessions found.")
        return

    # Check pending sessions via API
    print(f"\n🔍 {len(pending)} pending session(s) (checking API...):")
    for s in pending:
        sid = s["session_id"]
        project_uuid = s.get("project_uuid", "")
        text = s.get("text", "")

        try:
            result = call_gateway("GET", f"/libtv/v1/session/{sid}")
            messages = result.get("messages") or []
            urls = extract_result_urls(messages)

            if urls:
                _save_session(sid, project_uuid=project_uuid, status="completed",
                              result_urls=urls, completed_at=datetime.now().isoformat())
                print(f"  ✅ {sid[:16]}... Completed!")
                for url in urls:
                    print(f"     🎬 {url}")
                if project_uuid:
                    print(f"     🎨 Canvas: {PROJECT_CANVAS_BASE}{project_uuid}")
            else:
                print(f"  ⏳ {sid[:16]}... Still generating ({text})")
                if project_uuid:
                    print(f"     🎨 Canvas: {PROJECT_CANVAS_BASE}{project_uuid}")
        except Exception as e:
            print(f"  ❌ {sid[:16]}... Error checking status: {e}")

def cmd_tasks(args):
    result = call_gateway("GET", "/api/v1/tasks")
    tasks = result.get("tasks", [])

    if not tasks:
        print("No tasks found for this key.")
        return

    print(f"Found {len(tasks)} task(s):\n")
    for t in tasks:
        tid = t.get("id", "?")
        status = t.get("status", "?")
        backend = t.get("backend", "libtv")
        created = t.get("created_at", "?")
        completed = t.get("completed_at")
        video_url = t.get("video_url")
        error = t.get("error_message")

        # Persist completed task results to local for offline recovery
        if status == "completed" and video_url:
            _save_session(tid, status="completed",
                          result_urls=[video_url], completed_at=completed or "")

        status_icon = {
            "completed": "✅", "failed": "❌", "composing": "⏳",
            "rendering": "⏳", "pending": "🔄",
        }.get(status, "❓")

        print(f"  {status_icon} {tid[:16]}...  [{backend}] {status}  ({created})")
        if completed:
            print(f"     ⏱️ Completed: {completed}")
        if video_url:
            print(f"     🎬 {video_url}")
        if error:
            print(f"     ❌ {error}")



def cmd_change_project(args):
    result = call_gateway("POST", "/libtv/v1/session/change-project", json_data={})
    project_uuid = result.get("projectUuid", "")
    if not project_uuid:
        print("❌ Failed: no projectUuid returned")
        sys.exit(1)

    out = {
        "projectUuid": project_uuid,
        "projectUrl": f"{PROJECT_CANVAS_BASE}{project_uuid}",
    }
    print(json.dumps(out, ensure_ascii=False, indent=2))

# ── CLI entry point ──

def main():
    parser = argparse.ArgumentParser(description="LibTV Video Skill")
    sub = parser.add_subparsers(dest="command")

    # setup
    p = sub.add_parser("setup", help="Configure API Key")
    p.add_argument("--api-key", help="API Key starting with mgk_")

    # check
    sub.add_parser("check", help="Check configuration and Key status")

    # update-key
    p = sub.add_parser("update-key", help="Update API Key")
    p.add_argument("--api-key", required=True, help="New mgk_ Key")

    # remove-key
    sub.add_parser("remove-key", help="Remove local API Key")

    # upload
    p = sub.add_parser("upload", help="Upload image or video file")
    p.add_argument("--file", required=True, help="File path")

    # create-session
    p = sub.add_parser("create-session", help="Create session and/or send message")
    p.add_argument("message", nargs="?", default="", help="Message to send")
    p.add_argument("--session-id", default="", help="Existing session ID")

    # query-session
    p = sub.add_parser("query-session", help="Query session messages")
    p.add_argument("session_id", help="Session ID")
    p.add_argument("--after-seq", type=int, default=0, help="Only messages after this seq")
    p.add_argument("--project-id", default="", help="Project UUID for projectUrl")

    # download-results
    p = sub.add_parser("download-results", help="Download results from session")
    p.add_argument("session_id", nargs="?", default="", help="Session ID")
    p.add_argument("--urls", nargs="+", default=[], help="Direct URLs to download")
    p.add_argument("--output-dir", default="", help="Output directory")
    p.add_argument("--prefix", default="", help="Filename prefix")

    # wait-and-deliver
    p = sub.add_parser("wait-and-deliver", help="Poll and deliver results (sub-agent)")
    p.add_argument("--session-id", required=True, help="Session ID")
    p.add_argument("--project-id", default="", help="Project UUID")

    # tasks
    sub.add_parser("tasks", help="List all tasks for current key")


    # recover
    sub.add_parser("recover", help="Recover and check pending sessions")

    # change-project
    sub.add_parser("change-project", help="Switch project for accessKey")

    args = parser.parse_args()

    commands = {
        "setup": cmd_setup,
        "check": cmd_check,
        "update-key": cmd_update_key,
        "remove-key": cmd_remove_key,
        "upload": cmd_upload,
        "create-session": cmd_create_session,
        "query-session": cmd_query_session,
        "download-results": cmd_download_results,
        "wait-and-deliver": cmd_wait_and_deliver,
        "tasks": cmd_tasks,
        "recover": cmd_recover,
        "change-project": cmd_change_project,
    }

    if args.command in commands:
        commands[args.command](args)
    else:
        parser.print_help()

if __name__ == "__main__":
    main()
