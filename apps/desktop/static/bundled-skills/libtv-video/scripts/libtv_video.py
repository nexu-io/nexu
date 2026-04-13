#!/usr/bin/env python3
"""LibTV - Image & Video (Seedance 2.0) - AI image and video generation via Nexu Seedance or direct LibTV

Delivery architecture:
  - `create-session` submits the job, captures the channel + chat_id from
    OpenClaw env vars, persists them, forks a detached background
    `wait-and-deliver` process, and returns immediately with a JSON submit
    confirmation for the parent session's model to acknowledge.
  - The forked `wait-and-deliver` process polls the upstream API until
    terminal, then delivers the result directly to the originating channel
    (currently Feishu only) by shelling out to the per-channel helper
    `feishu_send_video.py`, which uploads the video to the channel's file
    API and posts a native media message.

No OpenClaw subagent, no sessions_spawn, no model-speech contract. The
delivery is a direct HTTP call with stable per-user identifiers (Feishu
`open_id`/`chat_id`) so it does not depend on the parent session staying
alive or on per-turn channel bindings.

Usage:
  libtv_video.py setup --api-key <mgk_xxx|sk-libtv_xxx> [--video-ratio 16:9]
  libtv_video.py check
  libtv_video.py update-key --api-key <mgk_xxx|sk-libtv_xxx>
  libtv_video.py update-ratio --video-ratio 16:9
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
import http.client
import json
import os
import re
import socket
import subprocess
import sys
import time
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime

# Transient network errors that should cause the poll loop to retry on the
# next tick rather than crashing the whole wait-and-deliver session.
TRANSIENT_POLL_ERRORS = (
    http.client.RemoteDisconnected,
    http.client.IncompleteRead,
    ConnectionError,
    socket.timeout,
    urllib.error.URLError,
    TimeoutError,
)

# ── Config management ──

GATEWAY_URL = "https://seedance.nexu.io/"
DIRECT_IM_BASE_URL = "https://im.liblib.tv"
PROJECT_CANVAS_BASE = "https://www.liblib.tv/canvas?projectId="
DEFAULT_POLL_INTERVAL_SECONDS = 8
DEFAULT_MAX_POLLS = 23
DEFAULT_VIDEO_RATIO = "16:9"
VIDEO_RATIO_PATTERN = re.compile(r"^\d{1,2}:\d{1,2}$")
AUTH_MODE_NEXU_GATEWAY = "nexu_gateway"
AUTH_MODE_LIBTV_DIRECT = "libtv_direct"

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

def _detect_auth_mode(api_key):
    if api_key.startswith("mgk_"):
        return AUTH_MODE_NEXU_GATEWAY
    if api_key.startswith("sk-libtv-"):
        return AUTH_MODE_LIBTV_DIRECT
    return ""

def _require_auth_mode():
    api_key = _get_api_key()
    mode = _detect_auth_mode(api_key)
    if mode:
        return mode
    print("❌ Invalid API Key format. Expected mgk_... or sk-libtv-....")
    sys.exit(1)

def _validate_video_ratio(ratio):
    return bool(ratio and VIDEO_RATIO_PATTERN.fullmatch(ratio))

def _get_video_ratio():
    override = os.environ.get("LIBTV_VIDEO_RATIO", "").strip()
    if _validate_video_ratio(override):
        return override
    configured = str(_load_config().get("videoRatio", "")).strip()
    if _validate_video_ratio(configured):
        return configured
    return DEFAULT_VIDEO_RATIO

def _get_gateway_url():
    override = os.environ.get("LIBTV_GATEWAY_URL", "").strip()
    return override or GATEWAY_URL

def _get_direct_base_url():
    override = os.environ.get("LIBTV_DIRECT_BASE_URL", "").strip()
    return override or DIRECT_IM_BASE_URL

# ── Session persistence ──

def _sessions_file_path():
    return os.path.join(_nexu_home(), "libtv-sessions.json")

def _load_sessions():
    path = _sessions_file_path()
    if not os.path.exists(path):
        return []
    with open(path, "r") as f:
        raw_sessions = json.load(f)
    return [_normalize_session_entry(session) for session in raw_sessions]

def _normalize_session_entry(entry):
    normalized = dict(entry)
    normalized["auth_mode"] = entry.get("auth_mode", "")
    normalized["delivery"] = dict(entry.get("delivery") or {})
    return normalized

def _now_iso():
    return datetime.now().isoformat()

def _save_session(session_id, project_uuid="", status="", text="",
                   result_urls=None, completed_at="", failure_message="",
                   auth_mode="", delivery=None, delivered_at=""):
    sessions = _load_sessions()
    now = _now_iso()
    for s in sessions:
        if s["session_id"] == session_id:
            if status:
                s["status"] = status
            if project_uuid:
                s["project_uuid"] = project_uuid
            if text:
                s["submitted_text"] = text[:80]
            if result_urls:
                s["result_urls"] = result_urls
            if completed_at:
                s["completed_at"] = completed_at
            if failure_message:
                s["failure_message"] = failure_message
            if auth_mode:
                s["auth_mode"] = auth_mode
            if delivery is not None:
                s["delivery"] = dict(delivery)
            if delivered_at:
                s["delivered_at"] = delivered_at
            s["updated_at"] = now
            break
    else:
        entry = _normalize_session_entry({
            "session_id": session_id,
            "project_uuid": project_uuid,
            "status": status or "submitted",
            "submitted_text": text[:80],
            "auth_mode": auth_mode,
            "created_at": now,
            "updated_at": now,
        })
        if delivery is not None:
            entry["delivery"] = dict(delivery)
        if result_urls:
            entry["result_urls"] = result_urls
        if completed_at:
            entry["completed_at"] = completed_at
        if failure_message:
            entry["failure_message"] = failure_message
        if delivered_at:
            entry["delivered_at"] = delivered_at
        sessions.append(entry)
    sessions = sessions[-50:]
    path = _sessions_file_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(sessions, f, indent=2, ensure_ascii=False)
    os.replace(tmp, path)

def _get_pending_sessions():
    return [s for s in _load_sessions() if s.get("status") not in ("completed", "failed", "timeout")]

def _find_session(session_id):
    for session in _load_sessions():
        if session.get("session_id") == session_id:
            return session
    return None

def _project_canvas_url(project_uuid):
    return f"{PROJECT_CANVAS_BASE}{project_uuid}" if project_uuid else ""

def _read_int_env(name, default_value):
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default_value
    try:
        parsed = int(raw)
    except ValueError:
        return default_value
    return parsed if parsed >= 0 else default_value

# ── Delivery context ──

def _collect_delivery_context(cli_channel="", cli_chat_id=""):
    """Capture the minimum routing info needed to deliver directly to the
    originating channel. Only stable per-user identifiers — no account_id,
    no session_key, no thread_id — so persisted values never go stale.

    Priority: explicit CLI args (--channel, --chat-id) > OPENCLAW_* env
    vars (which are not reliably set in practice and are kept only for
    compatibility). The model is expected to extract the chat_id /
    channel from the inbound Feishu metadata block and pass them
    explicitly, the same way deploy-skill's `submit` command takes
    --chat-id / --channel / etc.
    """
    channel = (cli_channel or os.environ.get("OPENCLAW_CHANNEL_TYPE", "")).strip().lower()
    chat_id = (cli_chat_id or os.environ.get("OPENCLAW_CHAT_ID", "")).strip()
    if not channel or not chat_id:
        return {}
    return {"channel": channel, "chat_id": chat_id}


def _waiter_log_path(session_id):
    return os.path.join(_nexu_home(), f"libtv-waiter-{session_id}.log")


def _spawn_background_waiter(session_id, project_uuid):
    """Fork a detached `wait-and-deliver` process that survives this command's
    exit. The child is session-leader (start_new_session=True) and has its
    own log file so OpenClaw does not wait on it and its output does not
    collide with our parent stdout/stderr.

    The parent closes its own copy of the log file descriptor immediately
    after `Popen` returns — `Popen` dup()s the fd into the child so the
    child keeps its own independent reference. This avoids leaking a fd
    in the parent if this helper is ever called in a longer-lived context.
    The `try/finally` ensures we still close on Popen failure.
    """
    script_path = os.path.abspath(__file__)
    log_path = _waiter_log_path(session_id)
    os.makedirs(os.path.dirname(log_path), exist_ok=True)
    log_file = open(log_path, "a")
    try:
        log_file.write(
            f"\n===== spawn waiter {_now_iso()} session={session_id} project={project_uuid} =====\n"
        )
        log_file.flush()
        args = [
            sys.executable,
            script_path,
            "wait-and-deliver",
            "--session-id",
            session_id,
            "--project-id",
            project_uuid,
        ]
        # Pass current env so the child inherits NEXU_HOME and any
        # OPENCLAW_* values. The child re-reads them for its own
        # delivery bookkeeping if necessary; the persisted delivery dict
        # is the source of truth.
        subprocess.Popen(
            args,
            stdin=subprocess.DEVNULL,
            stdout=log_file,
            stderr=log_file,
            start_new_session=True,
            close_fds=True,
            env=os.environ.copy(),
        )
    finally:
        log_file.close()


def _feishu_helper_path():
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), "feishu_send_video.py")


def _deliver_feishu_video(chat_id, video_url, thumbnail_url=""):
    helper = _feishu_helper_path()
    if not os.path.exists(helper):
        print(f"⚠️ Feishu helper missing at {helper}", file=sys.stderr)
        return False
    args = [sys.executable, helper, "--video-url", video_url, "--chat-id", chat_id]
    if thumbnail_url:
        args.extend(["--thumbnail-url", thumbnail_url])
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=600)
    except subprocess.TimeoutExpired:
        print("⚠️ Feishu helper timed out after 600s", file=sys.stderr)
        return False
    if result.stdout:
        print(result.stdout, file=sys.stderr)
    if result.returncode == 0:
        return True
    print(
        f"⚠️ Feishu helper failed (rc={result.returncode}): {result.stderr[:500]}",
        file=sys.stderr,
    )
    return False


def _deliver_results(delivery, result_urls):
    """Dispatch each result URL to the originating channel's helper.
    Returns True iff every URL was delivered successfully.
    """
    if not delivery:
        print("⚠️ No delivery context recorded — skipping direct delivery.", file=sys.stderr)
        return False
    channel = delivery.get("channel", "")
    chat_id = delivery.get("chat_id", "")
    if not channel or not chat_id:
        print("⚠️ Delivery context is missing channel or chat_id.", file=sys.stderr)
        return False
    if channel != "feishu":
        print(
            f"⚠️ Direct delivery for channel '{channel}' is not implemented yet; only 'feishu' is supported.",
            file=sys.stderr,
        )
        return False
    if not result_urls:
        return False
    all_ok = True
    for url in result_urls:
        if not _deliver_feishu_video(chat_id, url):
            all_ok = False
    return all_ok

# ── URL extraction ──

LIBTV_RES_PATTERN = re.compile(
    r"https://libtv-res\.liblib\.art/(?:sd-gen-save-img|claw)/[^\s\"'<>)]+"
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

    url = f"{_get_gateway_url()}{path}"
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

def call_direct_api(method, path, **kwargs):
    api_key = _get_api_key()
    if not api_key:
        print("❌ API Key not configured. Run: libtv_video.py setup --api-key sk-libtv-yourkey")
        sys.exit(1)

    url = f"{_get_direct_base_url()}{path}"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "User-Agent": "LibTVSkill/1.0",
    }

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
            data = resp.read()
            return json.loads(data) if data else {}
    except urllib.error.HTTPError as e:
        err_body = e.read().decode()
        print(f"❌ Direct LibTV request failed (HTTP {e.code}): {err_body[:200]}")
        sys.exit(1)
    except urllib.error.URLError as e:
        print(f"❌ Cannot connect to direct LibTV API: {e.reason}")
        sys.exit(1)

def _unwrap_direct_data(response, required_fields=None):
    data = response.get("data")
    if not isinstance(data, dict):
        print("❌ Direct LibTV response missing data object.")
        sys.exit(1)

    required_fields = list(required_fields or [])
    missing = [field for field in required_fields if not str(data.get(field, "")).strip()]
    if missing:
        print(
            "❌ Direct LibTV response missing required field(s): "
            + ", ".join(missing)
        )
        sys.exit(1)
    return data

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
        if not _detect_auth_mode(args.api_key):
            print("❌ Invalid API Key format. It should start with mgk_ or sk-libtv-.")
            sys.exit(1)
        config["apiKey"] = args.api_key
        print(f"✅ API Key saved (****{args.api_key[-4:]})")
    if args.video_ratio:
        if not _validate_video_ratio(args.video_ratio):
            print("❌ Invalid video ratio format. Use WIDTH:HEIGHT, for example 16:9.")
            sys.exit(1)
        config["videoRatio"] = args.video_ratio
        print(f"✅ Video ratio saved ({args.video_ratio})")
    _save_config(config)
    print(f"📁 Config: {_config_path()}")

def cmd_check(args):
    config = _load_config()
    if not config.get("apiKey"):
        print("❌ API Key not configured.")
        print("   Run: libtv_video.py setup --api-key mgk_yourkey")
        print("   Or:  libtv_video.py setup --api-key sk-libtv-yourkey")
        sys.exit(1)

    key = config["apiKey"]
    mode = _detect_auth_mode(key)
    if not mode:
        print("❌ Invalid API Key format. It should start with mgk_ or sk-libtv-.")
        sys.exit(1)
    print(f"🔑 API Key: ****{key[-4:]}")
    print(f"📐 Video ratio: {_get_video_ratio()}")
    print(f"📁 Config: {_config_path()}")
    if mode == AUTH_MODE_NEXU_GATEWAY:
        print(f"🌐 Gateway: {_get_gateway_url()}")
        result = call_gateway("GET", "/api/v1/key/status")
        if not isinstance(result.get("remaining_uses"), int) or not isinstance(result.get("max_uses"), int):
            print("❌ Guard check failed: key status response is missing remaining_uses/max_uses.")
            sys.exit(1)
        print("✅ Key valid")
        print(f"📊 Remaining uses: {result['remaining_uses']}/{result['max_uses']}")
        if result.get("expires_at"):
            print(f"⏰ Expires at: {result['expires_at']}")
    else:
        print(f"🌐 Direct LibTV: {_get_direct_base_url()}")
        print("✅ Direct LibTV key configured")

def cmd_update_key(args):
    if not _detect_auth_mode(args.api_key):
        print("❌ Invalid API Key format. It should start with mgk_ or sk-libtv-.")
        sys.exit(1)
    config = _load_config()
    old_key = config.get("apiKey")
    config["apiKey"] = args.api_key
    _save_config(config)
    if old_key:
        print(f"✅ Key updated: ****{old_key[-4:]} → ****{args.api_key[-4:]}")
    else:
        print(f"✅ Key saved: ****{args.api_key[-4:]}")

def cmd_update_ratio(args):
    if not _validate_video_ratio(args.video_ratio):
        print("❌ Invalid video ratio format. Use WIDTH:HEIGHT, for example 16:9.")
        sys.exit(1)
    config = _load_config()
    old_ratio = str(config.get("videoRatio", "")).strip()
    config["videoRatio"] = args.video_ratio
    _save_config(config)
    if old_ratio:
        print(f"✅ Video ratio updated: {old_ratio} → {args.video_ratio}")
    else:
        print(f"✅ Video ratio saved: {args.video_ratio}")

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

    mode = _require_auth_mode()
    if mode == AUTH_MODE_NEXU_GATEWAY:
        result = call_gateway("POST", "/libtv/v1/upload", files={"file": filepath}, timeout=120)
    else:
        response = call_direct_api("POST", "/openapi/file/upload", files={"file": filepath}, timeout=120)
        result = _unwrap_direct_data(response, required_fields=["url"])
    oss_url = result.get("url", "")
    if not oss_url:
        print("❌ Upload failed: no URL returned")
        sys.exit(1)

    print(f"✅ Upload successful")
    print(f"   url: {oss_url}")
    print(json.dumps({"url": oss_url}, ensure_ascii=False))

VIDEO_RATIO_HINT_TEMPLATE = ", video ratio {ratio}"

def _append_video_ratio_hint(message):
    if not message:
        return message
    if re.search(r"\b\d{1,2}:\d{1,2}\b", message):
        return message
    return message + VIDEO_RATIO_HINT_TEMPLATE.format(ratio=_get_video_ratio())

def _build_session_message(message, auth_mode):
    # Model selection is left to whatever the user specified (or to the
    # LibTV backend's default). The skill used to pin Seedance 2.0 by
    # appending a hint to every prompt, which conflicted with the newer
    # "supports multiple models" framing in SKILL.md. The video ratio
    # hint is still appended because that's a format requirement the
    # user almost always wants defaulted.
    return _append_video_ratio_hint(message)

def _create_session_result(body, auth_mode):
    if auth_mode == AUTH_MODE_LIBTV_DIRECT:
        response = call_direct_api("POST", "/openapi/session", json_data=body)
        return _unwrap_direct_data(response, required_fields=["sessionId", "projectUuid"])
    return call_gateway("POST", "/libtv/v1/session", json_data=body)

def _query_session_result(session_id, auth_mode, after_seq=0):
    if auth_mode == AUTH_MODE_LIBTV_DIRECT:
        response = call_direct_api("GET", f"/openapi/session/{session_id}")
        return _unwrap_direct_data(response, required_fields=["messages"])
    path = f"/libtv/v1/session/{session_id}"
    if after_seq > 0:
        path += f"?afterSeq={after_seq}"
    return call_gateway("GET", path)

def cmd_create_session(args):
    auth_mode = _require_auth_mode()
    body = {}
    if args.session_id:
        body["sessionId"] = args.session_id
    if args.message:
        body["message"] = _build_session_message(args.message, auth_mode)
    elif not args.session_id:
        print("❌ Guard check failed: create-session requires a message or an existing session-id.")
        sys.exit(1)

    result = _create_session_result(body, auth_mode)
    session_id = result.get("sessionId", "")
    project_uuid = result.get("projectUuid", "")

    if not session_id:
        print("❌ Failed: no sessionId returned")
        sys.exit(1)
    if not project_uuid:
        print("❌ Failed: no projectUuid returned")
        sys.exit(1)

    # Capture the originating channel + stable chat_id at submit time so
    # the background waiter can deliver directly without depending on
    # OpenClaw subagent inheritance. The model is expected to extract
    # these from the inbound Feishu metadata block (sender_id / chat_id)
    # and pass them explicitly via --channel and --chat-id.
    delivery = _collect_delivery_context(
        cli_channel=getattr(args, "channel", "") or "",
        cli_chat_id=getattr(args, "chat_id", "") or "",
    )

    _save_session(
        session_id,
        project_uuid=project_uuid,
        status="submitted",
        text=args.message or "",
        auth_mode=auth_mode,
        delivery=delivery,
    )
    persisted = _find_session(session_id)
    if not persisted:
        print("❌ Guard check failed: submitted session was not persisted locally.")
        sys.exit(1)
    if persisted.get("session_id") != session_id:
        print("❌ Guard check failed: persisted session_id mismatch.")
        sys.exit(1)
    if persisted.get("project_uuid") != project_uuid:
        print("❌ Guard check failed: persisted project_uuid mismatch.")
        sys.exit(1)
    if persisted.get("status") != "submitted":
        print(f"❌ Guard check failed: unexpected persisted submit status {persisted.get('status')}.")
        sys.exit(1)

    # Fork a detached wait-and-deliver process. It polls libtv until
    # terminal, then delivers the result directly to the originating
    # channel. We do this instead of OpenClaw sessions_spawn because
    # sessions_spawn depends on the subagent model speaking verbatim and
    # on OpenClaw's channel-binding inheritance — both of which are less
    # stable than a direct HTTP call from a detached worker.
    if os.environ.get("LIBTV_SKIP_BACKGROUND_WAITER", "").strip() not in ("1", "true"):
        _spawn_background_waiter(session_id, project_uuid)

    # Single-line JSON submit confirmation on stdout for the parent
    # session's model to acknowledge. The user-facing wording is produced
    # by the model — we just hand it the structured facts.
    out = {
        "status": "submitted",
        "sessionId": session_id,
        "projectUuid": project_uuid,
        "projectUrl": f"{PROJECT_CANVAS_BASE}{project_uuid}",
        "channel": delivery.get("channel", ""),
        "deliverable": bool(delivery),
        "note": (
            "Video is generating in the background. "
            "Results will be delivered to this chat automatically when ready."
            if delivery
            else "Video is generating, but no delivery channel was captured — the user will have to ask for the result."
        ),
    }
    print(json.dumps(out, ensure_ascii=False))
    print(
        "⏳ Generation submitted. The background waiter will deliver results directly.",
        file=sys.stderr,
    )

def cmd_query_session(args):
    session_id = args.session_id
    persisted = _find_session(session_id)
    if not persisted:
        print(f"❌ Unknown LibTV session: {session_id}")
        sys.exit(1)
    auth_mode = persisted.get("auth_mode") or _require_auth_mode()
    result = _query_session_result(session_id, auth_mode, after_seq=args.after_seq)
    messages = result.get("messages") or []

    # Extract result URLs
    urls = extract_result_urls(messages)

    # Persist results to local so recover can read without API
    if urls:
        _save_session(session_id, project_uuid=args.project_id or persisted.get("project_uuid", ""), status="completed",
                      result_urls=urls, completed_at=_now_iso(), auth_mode=auth_mode)

    out = {"messages": messages}
    if args.project_id:
        out["projectUrl"] = f"{PROJECT_CANVAS_BASE}{args.project_id}"
    if urls:
        out["result_urls"] = urls

    print(json.dumps(out, ensure_ascii=False, indent=2))

def cmd_download_results(args):
    urls = list(args.urls or [])

    if args.session_id:
        persisted = _find_session(args.session_id)
        auth_mode = (persisted or {}).get("auth_mode") or _require_auth_mode()
        if auth_mode == AUTH_MODE_LIBTV_DIRECT:
            result = _query_session_result(args.session_id, auth_mode)
            extracted = extract_result_urls(result.get("messages") or [])
        else:
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
    """Background waiter: poll the upstream API, then deliver the terminal
    result directly to the originating channel. Called either manually from
    the CLI (for debugging) or as a detached subprocess forked from
    cmd_create_session. All output goes to stderr so that the detached log
    file captures it; nothing is printed to stdout for a parent to parse.
    """
    session_id = args.session_id
    persisted = _find_session(session_id)
    if not persisted:
        print(f"❌ Unknown LibTV session: {session_id}", file=sys.stderr)
        sys.exit(1)
    auth_mode = persisted.get("auth_mode") or _require_auth_mode()
    project_uuid = args.project_id or persisted.get("project_uuid", "")
    delivery = dict(persisted.get("delivery") or {})
    if persisted.get("delivered_at"):
        print(
            f"ℹ️ Session {session_id} already delivered at {persisted['delivered_at']}, skipping.",
            file=sys.stderr,
        )
        return

    poll_interval = _read_int_env("LIBTV_POLL_INTERVAL_SECONDS", DEFAULT_POLL_INTERVAL_SECONDS)
    max_polls = _read_int_env("LIBTV_MAX_POLLS", DEFAULT_MAX_POLLS)

    for i in range(max_polls):
        try:
            result = _query_session_result(session_id, auth_mode)
        except TRANSIENT_POLL_ERRORS as exc:
            # Libtv keeps long idle connections open and sometimes closes
            # them mid-poll. Treat any transient network failure as "no
            # result yet", log it, and keep polling.
            print(
                f"⚠️ Transient error polling session {session_id}: {exc}. Retrying on next tick.",
                file=sys.stderr,
            )
            if poll_interval > 0:
                time.sleep(poll_interval)
            continue
        messages = result.get("messages") or []
        urls = extract_result_urls(messages)

        if urls:
            _save_session(
                session_id,
                project_uuid=project_uuid,
                status="completed",
                result_urls=urls,
                completed_at=_now_iso(),
                auth_mode=auth_mode,
            )
            print(
                f"✅ Session {session_id} reached terminal success with {len(urls)} artifact(s).",
                file=sys.stderr,
            )
            for url in urls:
                print(f"   {url}", file=sys.stderr)

            # Deliver directly to the originating channel. This is the
            # part that replaced sessions_spawn + model-speech — a
            # deterministic HTTP call with a stable per-user identifier.
            delivered_ok = _deliver_results(delivery, urls)
            if delivered_ok:
                _save_session(
                    session_id,
                    delivered_at=_now_iso(),
                )
                print("✅ Delivered to originating channel.", file=sys.stderr)
            else:
                print(
                    "⚠️ Direct channel delivery did not complete. Results are still persisted locally.",
                    file=sys.stderr,
                )

            # Auto-download to the user's local results dir as a
            # convenience / fallback.
            output_dir = os.path.expanduser("~/Downloads/libtv_results")
            os.makedirs(output_dir, exist_ok=True)
            for j, url in enumerate(urls, 1):
                ext = os.path.splitext(url.split("?")[0])[-1] or ".png"
                filepath = os.path.join(output_dir, f"{session_id[:8]}_{j:02d}{ext}")
                fp, err = download_file(url, filepath)
                if not err:
                    print(f"   📥 {fp}", file=sys.stderr)
            return

        elapsed = (i + 1) * poll_interval
        total = max_polls * poll_interval
        print(
            f"⏳ [{elapsed}s/{total}s] AI is generating, checking again in {poll_interval} seconds...",
            file=sys.stderr,
        )
        if poll_interval > 0:
            time.sleep(poll_interval)

    # Timeout path — record it. No direct delivery for timeouts in this
    # iteration; the user can ask later via query-session or the skill's
    # recover command. (A text-mode "still generating" notification is a
    # reasonable follow-up once we confirm the happy path works.)
    _save_session(
        session_id, project_uuid=project_uuid, status="timeout", auth_mode=auth_mode
    )
    print(
        f"⏰ Session {session_id} hit the polling timeout without reaching a terminal state.",
        file=sys.stderr,
    )


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
            text = s.get("submitted_text", "")

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
                    auth_mode = s.get("auth_mode") or _require_auth_mode()
                    result = _query_session_result(sid, auth_mode)
                    messages = result.get("messages") or []
                    urls = extract_result_urls(messages)
                    if urls:
                        _save_session(sid, project_uuid=project_uuid, status="completed",
                                      result_urls=urls, completed_at=_now_iso(), auth_mode=auth_mode)
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
        text = s.get("submitted_text", "")

        try:
            auth_mode = s.get("auth_mode") or _require_auth_mode()
            result = _query_session_result(sid, auth_mode)
            messages = result.get("messages") or []
            urls = extract_result_urls(messages)

            if urls:
                _save_session(sid, project_uuid=project_uuid, status="completed",
                              result_urls=urls, completed_at=_now_iso(), auth_mode=auth_mode)
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
    if _require_auth_mode() == AUTH_MODE_LIBTV_DIRECT:
        print("❌ The tasks command is only available for Nexu-managed mgk_ keys.")
        sys.exit(1)
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
    auth_mode = _require_auth_mode()
    if auth_mode == AUTH_MODE_LIBTV_DIRECT:
        response = call_direct_api("POST", "/openapi/session/change-project", json_data={})
        result = _unwrap_direct_data(response, required_fields=["projectUuid"])
    else:
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
    parser = argparse.ArgumentParser(description="LibTV - Image&Video (Seedance 2.0) Skill")
    sub = parser.add_subparsers(dest="command")

    # setup
    p = sub.add_parser("setup", help="Configure API Key")
    p.add_argument("--api-key", help="API Key starting with mgk_ or sk-libtv-")
    p.add_argument("--video-ratio", help="Default video ratio WIDTH:HEIGHT, for example 16:9")

    # check
    sub.add_parser("check", help="Check configuration and Key status")

    # update-key
    p = sub.add_parser("update-key", help="Update API Key")
    p.add_argument("--api-key", required=True, help="New mgk_ or sk-libtv- key")

    # update-ratio
    p = sub.add_parser("update-ratio", help="Update default video ratio")
    p.add_argument("--video-ratio", required=True, help="Video ratio WIDTH:HEIGHT, for example 16:9")

    # remove-key
    sub.add_parser("remove-key", help="Remove local API Key")

    # upload
    p = sub.add_parser("upload", help="Upload image or video file")
    p.add_argument("--file", required=True, help="File path")

    # create-session
    p = sub.add_parser("create-session", help="Create session and/or send message")
    p.add_argument("message", nargs="?", default="", help="Message to send")
    p.add_argument("--session-id", default="", help="Existing session ID")
    p.add_argument(
        "--channel",
        default="",
        help="Originating channel type (e.g. feishu). Pass this so the background waiter can deliver results back to the user automatically.",
    )
    p.add_argument(
        "--chat-id",
        default="",
        help="Stable user identifier on the originating channel (Feishu sender_id / open_id, e.g. ou_xxx). Pass this so the background waiter can deliver results back to the user automatically.",
    )

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
        "update-ratio": cmd_update_ratio,
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
