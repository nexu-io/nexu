#!/usr/bin/env python3
"""Feishu video delivery script

Download video -> upload to Feishu file API -> send as video message to user.
Called by wait-and-deliver, or directly by a sub-agent.

Usage:
  feishu_send_video.py --video-url https://... --chat-id oc_xxx
  feishu_send_video.py --video-url https://... --chat-id ou_xxx
  feishu_send_video.py --video-url https://... --chat-id oc_xxx --thumbnail-url https://...
"""

import argparse
import json
import os
import sys
import tempfile
import time
import urllib.request
import urllib.error


def _find_openclaw_config():
    """Locate openclaw.json with priority: OPENCLAW_CONFIG > OPENCLAW_STATE_DIR > NEXU_HOME fallback"""
    # 1. OPENCLAW_CONFIG points directly to the file
    config_path = os.environ.get("OPENCLAW_CONFIG", "").strip()
    if config_path and os.path.exists(config_path):
        return config_path

    # 2. OPENCLAW_STATE_DIR/openclaw.json
    state_dir = os.environ.get("OPENCLAW_STATE_DIR", "").strip()
    if state_dir:
        p = os.path.join(state_dir, "openclaw.json")
        if os.path.exists(p):
            return p

    # 3. Fallback: ~/.nexu/runtime/openclaw/state/openclaw.json
    nexu_home = os.environ.get("NEXU_HOME", os.path.expanduser("~/.nexu"))
    p = os.path.join(nexu_home, "runtime", "openclaw", "state", "openclaw.json")
    if os.path.exists(p):
        return p

    return None


def get_tenant_token():
    """Get Feishu app credentials and exchange for tenant_access_token.

    Credential lookup priority:
    1. FEISHU_APP_ID / FEISHU_APP_SECRET env vars (passed through by sessions_spawn)
    2. OPENCLAW_CONFIG file (direct path)
    3. OPENCLAW_STATE_DIR/openclaw.json
    4. ~/.nexu/runtime/openclaw/state/openclaw.json (fallback)
    """
    # 1. Environment variables (highest priority)
    app_id = os.environ.get("FEISHU_APP_ID", "")
    app_secret = os.environ.get("FEISHU_APP_SECRET", "")

    # 2-4. Read from openclaw.json
    if not app_id or not app_secret:
        config_path = _find_openclaw_config()
        if config_path:
            with open(config_path) as f:
                config = json.load(f)
            accounts = config.get("channels", {}).get("feishu", {}).get("accounts", [])
            if accounts:
                acc = accounts[0] if isinstance(accounts, list) else list(accounts.values())[0]
                app_id = app_id or acc.get("appId", "")
                app_secret = app_secret or acc.get("appSecret", "")

    if not app_id or not app_secret:
        print("❌ Feishu app credentials not found (FEISHU_APP_ID/FEISHU_APP_SECRET or openclaw.json)")
        sys.exit(1)

    # Exchange for tenant_access_token
    req = urllib.request.Request(
        "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
        data=json.dumps({"app_id": app_id, "app_secret": app_secret}).encode(),
        method="POST",
    )
    req.add_header("Content-Type", "application/json")

    with urllib.request.urlopen(req, timeout=10) as resp:
        data = json.loads(resp.read())
    if data.get("code") != 0:
        print(f"❌ Failed to obtain Feishu token: {data.get('msg', '')}")
        sys.exit(1)

    return data["tenant_access_token"]


def download_video(url):
    """Download video to a temporary file"""
    print(f"⬇️ Downloading video...")
    tmp = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False)
    req = urllib.request.Request(url)
    req.add_header("User-Agent", "MedeoSkill/2.0")

    with urllib.request.urlopen(req, timeout=300) as resp:
        while True:
            chunk = resp.read(65536)
            if not chunk:
                break
            tmp.write(chunk)
    tmp.close()
    size = os.path.getsize(tmp.name)
    print(f"   {size // 1024}KB downloaded")
    return tmp.name


def _normalize_chat_receiver(chat_id):
    """Return (clean_id, receive_id_type) with the same prefix detection the
    native media sender uses, so the permission-fallback text message and
    the real media message both land in the same chat.
    """
    receive_id_type = "chat_id"
    clean_id = chat_id
    if chat_id.startswith("chat:"):
        clean_id = chat_id[5:]
    elif chat_id.startswith("user:"):
        clean_id = chat_id[5:]
        receive_id_type = "open_id"
    elif chat_id.startswith("ou_"):
        receive_id_type = "open_id"
    return clean_id, receive_id_type


def send_text_message(token, chat_id, text):
    """Send a plain-text message via the im:message scope. Used both for
    the permission-grant fallback and any future text-only delivery path.
    """
    clean_id, receive_id_type = _normalize_chat_receiver(chat_id)
    payload = {
        "receive_id": clean_id,
        "msg_type": "text",
        "content": json.dumps({"text": text}, ensure_ascii=False),
    }
    req = urllib.request.Request(
        f"https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type={receive_id_type}",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        method="POST",
    )
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Content-Type", "application/json; charset=utf-8")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        print(
            f"❌ Text fallback failed (HTTP {e.code}): {e.read().decode()[:300]}",
            file=sys.stderr,
        )
        return False
    if data.get("code") != 0:
        print(f"❌ Text fallback failed: code={data.get('code')} msg={data.get('msg','')}", file=sys.stderr)
        return False
    return True


def _extract_permission_grant_url(err_body):
    """Parse a Feishu error response and return a grant URL if the error
    is caused by a missing scope. Feishu returns the grant link embedded
    in `msg` like:
       '...点击链接申请并开通任一权限即可：https://open.feishu.cn/app/<id>/auth?q=...'
    We look for the first https URL on open.feishu.cn.
    """
    try:
        parsed = json.loads(err_body)
    except (ValueError, TypeError):
        return ""
    if parsed.get("code") != 99991672:
        return ""
    msg = parsed.get("msg", "")
    import re as _re
    m = _re.search(r"https://open\.feishu\.cn/app/[^\s\"'，。]+", msg)
    return m.group(0) if m else ""


def _handle_upload_permission_error(token, chat_id, video_url, grant_url):
    """When upload fails because the bot lacks the im:resource:upload scope,
    fall back to a text message on the already-granted im:message scope so
    the user knows their video is ready AND how to enable the native-video
    delivery path for future runs.
    """
    print(
        f"⚠️ Feishu upload blocked by missing im:resource:upload scope. "
        f"Falling back to text delivery so the user is still notified.",
        file=sys.stderr,
    )
    lines = [
        "📹 Your video is ready:",
        video_url,
        "",
        "ℹ️ To receive videos as a native attachment in future, grant the "
        "bot the `im:resource:upload` scope in the Feishu open platform:",
    ]
    if grant_url:
        lines.append(grant_url)
    else:
        lines.append(
            "https://open.feishu.cn/app/<your-app-id>/auth?q=im:resource:upload"
        )
    text = "\n".join(lines)
    if not send_text_message(token, chat_id, text):
        print("❌ Could not even send the text fallback.", file=sys.stderr)
        sys.exit(1)
    print("✅ Sent text fallback with grant URL to user.")


def upload_to_feishu(token, filepath, chat_id="", video_url=""):
    """Upload video to Feishu file API. On the specific error of a missing
    `im:resource:upload` scope, call `_handle_upload_permission_error` to
    send a text message containing the video URL and the grant link, then
    exit cleanly — the user is still informed, and the model does not need
    to handle the permission flow itself.
    """
    print("⬆️ Uploading to Feishu...")
    filename = os.path.basename(filepath)

    boundary = f"----MedeoFeishu{int(time.time())}"
    body = bytearray()

    # file_type
    body.extend(f"--{boundary}\r\n".encode())
    body.extend(b'Content-Disposition: form-data; name="file_type"\r\n\r\n')
    body.extend(b"mp4\r\n")

    # file_name
    body.extend(f"--{boundary}\r\n".encode())
    body.extend(b'Content-Disposition: form-data; name="file_name"\r\n\r\n')
    body.extend(f"{filename}\r\n".encode())

    # file
    body.extend(f"--{boundary}\r\n".encode())
    body.extend(f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'.encode())
    body.extend(b"Content-Type: video/mp4\r\n\r\n")
    with open(filepath, "rb") as f:
        body.extend(f.read())
    body.extend(f"\r\n--{boundary}--\r\n".encode())

    req = urllib.request.Request(
        "https://open.feishu.cn/open-apis/im/v1/files",
        data=bytes(body),
        method="POST",
    )
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")

    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        err_body = e.read().decode()
        grant_url = _extract_permission_grant_url(err_body)
        if grant_url:
            if not chat_id:
                # Permission error detected but we have no chat to send
                # the fallback text to. Surface a clear diagnostic so the
                # caller does not think this was an unrelated failure.
                print(
                    "❌ Feishu upload blocked by missing scope, but no chat_id "
                    "was provided to deliver the fallback text message. "
                    f"Grant URL: {grant_url}",
                    file=sys.stderr,
                )
                sys.exit(1)
            _handle_upload_permission_error(token, chat_id, video_url, grant_url)
            # Exit 0 — the user has been notified, which is the whole
            # point of delivery. A future run after the scope is granted
            # will transparently upgrade to native media delivery.
            sys.exit(0)
        # Not a permission error: bubble up the raw Feishu response for
        # debugging.
        print(f"❌ Upload failed (HTTP {e.code}): {err_body[:500]}", file=sys.stderr)
        sys.exit(1)

    if data.get("code") != 0:
        print(f"❌ Upload failed: {data.get('msg', '')}", file=sys.stderr)
        sys.exit(1)

    file_key = data["data"]["file_key"]
    print(f"   file_key: {file_key}")
    return file_key


def upload_thumbnail(token, url):
    """Download and upload thumbnail to Feishu"""
    if not url:
        return None
    try:
        # Download
        tmp = tempfile.NamedTemporaryFile(suffix=".jpg", delete=False)
        req = urllib.request.Request(url)
        req.add_header("User-Agent", "MedeoSkill/2.0")
        with urllib.request.urlopen(req, timeout=30) as resp:
            tmp.write(resp.read())
        tmp.close()

        # Upload as image
        boundary = f"----MedeoThumb{int(time.time())}"
        body = bytearray()
        body.extend(f"--{boundary}\r\n".encode())
        body.extend(b'Content-Disposition: form-data; name="image_type"\r\n\r\n')
        body.extend(b"message\r\n")
        body.extend(f"--{boundary}\r\n".encode())
        body.extend(b'Content-Disposition: form-data; name="image"; filename="cover.jpg"\r\n')
        body.extend(b"Content-Type: image/jpeg\r\n\r\n")
        with open(tmp.name, "rb") as f:
            body.extend(f.read())
        body.extend(f"\r\n--{boundary}--\r\n".encode())

        req = urllib.request.Request(
            "https://open.feishu.cn/open-apis/im/v1/images",
            data=bytes(body),
            method="POST",
        )
        req.add_header("Authorization", f"Bearer {token}")
        req.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")

        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read())

        os.unlink(tmp.name)

        if data.get("code") == 0:
            return data["data"]["image_key"]
    except Exception as e:
        print(f"⚠️ Thumbnail upload skipped: {e}", file=sys.stderr)
    return None


def send_video_message(token, chat_id, file_key, image_key=None):
    """Send video message to Feishu"""
    clean_id, receive_id_type = _normalize_chat_receiver(chat_id)

    content = {"file_key": file_key}
    if image_key:
        content["image_key"] = image_key

    payload = {
        "receive_id": clean_id,
        "msg_type": "media",
        "content": json.dumps(content),
    }

    req = urllib.request.Request(
        f"https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type={receive_id_type}",
        data=json.dumps(payload).encode(),
        method="POST",
    )
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Content-Type", "application/json")

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read())
        if data.get("code") == 0:
            print(f"✅ Video sent to Feishu ({receive_id_type}: {clean_id[:12]}...)")
        else:
            print(f"❌ Send failed: {data.get('msg', '')}")
            # Fallback: send as text link
            return False
    except Exception as e:
        print(f"❌ Send error: {e}")
        return False
    return True


def main():
    parser = argparse.ArgumentParser(description="Feishu video delivery")
    parser.add_argument("--video-url", required=True, help="Video download URL")
    parser.add_argument("--chat-id", required=True, help="Feishu chat_id or open_id")
    parser.add_argument("--thumbnail-url", help="Thumbnail URL")
    args = parser.parse_args()

    token = get_tenant_token()

    # Download video
    video_path = download_video(args.video_url)
    try:
        # Upload video. If the upload is blocked by missing Feishu scopes,
        # upload_to_feishu will send a text-fallback message (with the
        # video URL and the grant URL) to the originating chat and exit 0.
        file_key = upload_to_feishu(
            token, video_path, chat_id=args.chat_id, video_url=args.video_url
        )

        # Upload thumbnail
        image_key = upload_thumbnail(token, args.thumbnail_url)

        # Send message — exit non-zero on failure so the caller
        # (_deliver_feishu_video) does not record a false delivered_at.
        if not send_video_message(token, args.chat_id, file_key, image_key):
            sys.exit(1)
    finally:
        os.unlink(video_path)


if __name__ == "__main__":
    main()
