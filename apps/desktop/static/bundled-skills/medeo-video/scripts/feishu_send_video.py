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


def upload_to_feishu(token, filepath):
    """Upload video to Feishu file API"""
    print(f"⬆️ Uploading to Feishu...")
    filename = os.path.basename(filepath)
    filesize = os.path.getsize(filepath)

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

    with urllib.request.urlopen(req, timeout=120) as resp:
        data = json.loads(resp.read())

    if data.get("code") != 0:
        print(f"❌ Upload failed: {data.get('msg', '')}")
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
    # Determine receiver type: oc_ prefix is group chat, ou_ prefix is individual
    receive_id_type = "chat_id"
    clean_id = chat_id
    if chat_id.startswith("chat:"):
        clean_id = chat_id[5:]
    elif chat_id.startswith("user:"):
        clean_id = chat_id[5:]
        receive_id_type = "open_id"
    elif chat_id.startswith("ou_"):
        receive_id_type = "open_id"

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
        # Upload video
        file_key = upload_to_feishu(token, video_path)

        # Upload thumbnail
        image_key = upload_thumbnail(token, args.thumbnail_url)

        # Send message
        send_video_message(token, args.chat_id, file_key, image_key)
    finally:
        os.unlink(video_path)


if __name__ == "__main__":
    main()
