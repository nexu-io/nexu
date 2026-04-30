#!/usr/bin/env python3
import hashlib
import http.client
import json
import os
import shlex
import subprocess
import sys
import urllib.error
import urllib.request
from typing import Any, Dict, Iterable, List, Optional, Tuple

API_VERSION = "2022-11-28"
DEFAULT_LABELS = {
    "P0": ["bug", "priority:P0"],
    "P1": ["bug", "priority:P1"],
    "P2": ["feedback", "priority:P2"],
    "P3": ["feedback", "priority:P3"],
}
FIELD_ALIASES = {
    "id": ["编号", "ID", "#", "id"],
    "date": ["反馈日期", "日期", "created_at", "date"],
    "channel": ["渠道", "channel"],
    "group": ["群名", "来源群", "group"],
    "reporter": ["用户名", "用户名称", "反馈用户", "reporter", "user"],
    "priority": ["优先级", "priority"],
    "module": ["产品模块", "模块", "图表来源", "module"],
    "summary": ["问题概述", "问题概述/标题", "summary", "title"],
    "handling": ["处理方式", "当前处理", "handling"],
    "raw_feedback": ["反馈原文", "原文", "来源文档", "raw_feedback", "description"],
    "source_doc": ["来源文档", "source_doc", "source"],
}
SYNC_FIELD_DEFAULTS = {
    "flag": "待导入GitHub",
    "issue_number": "GitHub Issue Number",
    "issue_url": "GitHub Issue URL",
    "sync_status": "同步状态",
    "fingerprint": "去重指纹",
}


def env(name: str, default: str = "") -> str:
    value = os.getenv(name)
    return value if value is not None else default


def clean_token(value: str) -> str:
    token = (value or "").strip()
    if not token or token.lower() in {"ghp_xxx", "your_token", "your-token"}:
        return ""
    return token


def parse_label_list(value: str) -> List[str]:
    labels: List[str] = []
    for part in (value or "").split(","):
        label = part.strip()
        if label:
            labels.append(label)
    return labels


def unique_labels(*groups: Iterable[str]) -> List[str]:
    seen = set()
    labels: List[str] = []
    for group in groups:
        for label in group:
            if not label or label in seen:
                continue
            seen.add(label)
            labels.append(label)
    return labels


class GitHubClient:
    def __init__(self, repo: str, token: str):
        self.repo = repo
        self.token = token

    def _request(self, method: str, path: str, data: Optional[Dict[str, Any]] = None) -> Any:
        url = f"https://api.github.com{path}"
        body = None
        if data is not None:
            body = json.dumps(data).encode("utf-8")
        req = urllib.request.Request(url, data=body, method=method)
        req.add_header("Accept", "application/vnd.github+json")
        req.add_header("Authorization", f"Bearer {self.token}")
        req.add_header("X-GitHub-Api-Version", API_VERSION)
        req.add_header("User-Agent", "feishu-bitable-sync")
        if body is not None:
            req.add_header("Content-Type", "application/json")
        with urllib.request.urlopen(req) as resp:
            try:
                raw = resp.read()
            except http.client.IncompleteRead as exc:
                raw = exc.partial
            return json.loads(raw.decode("utf-8"))

    def list_issues(self) -> List[Dict[str, Any]]:
        return self._request("GET", f"/repos/{self.repo}/issues?state=all&per_page=100")

    def create_issue(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        return self._request("POST", f"/repos/{self.repo}/issues", payload)


class FeishuCLIClient:
    def __init__(self, cli_bin: str, base_token: str, table_id: str, view_id: str, identity: str, fixture_path: str):
        self.cli_bin = cli_bin
        self.base_token = base_token
        self.table_id = table_id
        self.view_id = view_id
        self.identity = identity
        self.fixture_path = fixture_path
        self._fixture_loaded = False

    def _run(self, args: List[str]) -> Any:
        cmd = [self.cli_bin] + args
        try:
            proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
        except FileNotFoundError:
            raise RuntimeError(f"找不到飞书 CLI：{self.cli_bin}")

        if proc.returncode != 0:
            stderr = (proc.stderr or proc.stdout or "").strip()
            if "keychain not initialized" in stderr:
                raise RuntimeError(
                    "lark-cli 还没有完成初始化。先运行 `lark-cli config init --new`，再运行 `lark-cli auth login --recommend`。"
                )
            raise RuntimeError(
                "飞书 CLI 调用失败: {}\n命令: {}".format(stderr, " ".join(shlex.quote(part) for part in cmd))
            )

        output = (proc.stdout or "").strip()
        if not output:
            return {}
        try:
            return json.loads(output)
        except json.JSONDecodeError as exc:
            raise RuntimeError(f"无法解析 lark-cli 输出为 JSON: {exc}\n原始输出:\n{output}")

    def list_records(self) -> List[Dict[str, Any]]:
        if self.fixture_path:
            with open(self.fixture_path, "r", encoding="utf-8") as f:
                payload = json.load(f)
            return extract_items(payload)

        items: List[Dict[str, Any]] = []
        offset = 0
        limit = 100
        while True:
            payload = self._run(
                [
                    "base",
                    "+record-list",
                    "--as",
                    self.identity,
                    "--base-token",
                    self.base_token,
                    "--table-id",
                    self.table_id,
                    "--limit",
                    str(limit),
                    "--offset",
                    str(offset),
                ]
                + (["--view-id", self.view_id] if self.view_id else [])
            )
            batch = extract_items(payload)
            items.extend(batch)
            if len(batch) < limit:
                break
            offset += limit
        return items

    def update_record(self, record_id: str, fields: Dict[str, Any], dry_run: bool) -> None:
        if dry_run or self.fixture_path:
            print(f"DRY RUN UPDATE {record_id} {json.dumps(fields, ensure_ascii=False)}")
            return

        payloads = [{"fields": fields}, fields]
        errors: List[str] = []
        for candidate in payloads:
            try:
                self._run(
                    [
                        "base",
                        "+record-upsert",
                        "--as",
                        self.identity,
                        "--base-token",
                        self.base_token,
                        "--table-id",
                        self.table_id,
                        "--record-id",
                        record_id,
                        "--json",
                        json.dumps(candidate, ensure_ascii=False),
                    ]
                )
                return
            except RuntimeError as exc:
                errors.append(str(exc))
        raise RuntimeError("\n---\n".join(errors))


def extract_items(payload: Any) -> List[Dict[str, Any]]:
    if isinstance(payload, list):
        return payload
    if not isinstance(payload, dict):
        return []
    if "items" in payload and isinstance(payload["items"], list):
        return payload["items"]
    data = payload.get("data")
    if isinstance(data, dict):
        if (
            isinstance(data.get("data"), list)
            and isinstance(data.get("fields"), list)
            and isinstance(data.get("record_id_list"), list)
        ):
            rows: List[Dict[str, Any]] = []
            field_names = data.get("fields", [])
            field_ids = data.get("field_id_list", [])
            for index, values in enumerate(data.get("data", [])):
                fields: Dict[str, Any] = {}
                if isinstance(values, list):
                    for position, raw_value in enumerate(values):
                        if position < len(field_names):
                            fields[field_names[position]] = raw_value
                        if position < len(field_ids):
                            fields[field_ids[position]] = raw_value
                record_id = ""
                if index < len(data.get("record_id_list", [])):
                    record_id = stringify(data["record_id_list"][index])
                rows.append({"record_id": record_id, "fields": fields})
            return rows
        for key in ["items", "records", "list"]:
            if isinstance(data.get(key), list):
                return data[key]
    return []


def first_non_empty(row: Dict[str, Any], aliases: Iterable[str]) -> str:
    for alias in aliases:
        value = row.get(alias)
        text = stringify(value)
        if text:
            return text
    return ""


def stringify(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        if isinstance(value, float) and value.is_integer():
            return str(int(value))
        return str(value)
    if isinstance(value, list):
        parts = [stringify(part) for part in value]
        return ", ".join(part for part in parts if part)
    if isinstance(value, dict):
        for key in ["text", "name", "title", "value", "url", "link"]:
            if key in value:
                return stringify(value[key])
        return json.dumps(value, ensure_ascii=False)
    return str(value).strip()


def is_truthy(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    text = stringify(value).lower()
    return text in {"1", "true", "yes", "y", "on", "是", "已勾选", "待同步", "sync"}


def fingerprint(priority: str, summary: str, raw_feedback: str) -> str:
    source = " | ".join(part.strip() for part in [priority, summary, raw_feedback] if part.strip())
    return hashlib.sha256(source.encode("utf-8")).hexdigest()[:16]


def build_issue(
    fields: Dict[str, Any], sync_fields: Dict[str, str], default_date: str, base_labels: List[str]
) -> Dict[str, Any]:
    priority = first_non_empty(fields, FIELD_ALIASES["priority"]) or "P2"
    channel = first_non_empty(fields, FIELD_ALIASES["channel"]) or "未标注渠道"
    group = first_non_empty(fields, FIELD_ALIASES["group"])
    reporter = first_non_empty(fields, FIELD_ALIASES["reporter"]) or "匿名用户"
    module = first_non_empty(fields, FIELD_ALIASES["module"])
    summary = first_non_empty(fields, FIELD_ALIASES["summary"]) or "未命名反馈"
    handling = first_non_empty(fields, FIELD_ALIASES["handling"]) or "待处理"
    raw_feedback = first_non_empty(fields, FIELD_ALIASES["raw_feedback"]) or summary
    source_doc = first_non_empty(fields, FIELD_ALIASES["source_doc"])
    item_id = first_non_empty(fields, FIELD_ALIASES["id"])
    feedback_date = first_non_empty(fields, FIELD_ALIASES["date"]) or default_date or "未提供"
    fp = fingerprint(priority, summary, raw_feedback)

    title_parts = [f"[{priority}]", f"[{channel}]"]
    if module:
        title_parts.append(f"[{module}]")
    title = "".join(title_parts) + f" {summary}"

    body_lines = [
        f"- 反馈日期: {feedback_date}",
        f"- 台账编号: {item_id or '未提供'}",
        f"- 渠道: {channel}",
        f"- 群名: {group or '未提供'}",
        f"- 用户名: {reporter}",
        f"- 优先级: {priority}",
        f"- 产品模块: {module or '未提供'}",
        f"- 处理方式: {handling}",
        f"- 来源文档: {source_doc or '未提供'}",
        "",
        "## 问题概述",
        summary,
        "",
        "## 原始反馈",
        raw_feedback,
        "",
        f"<!-- feedback-fingerprint: {fp} -->",
    ]
    return {
        "title": title,
        "body": "\n".join(body_lines),
        "priority": priority,
        "fingerprint": fp,
        "labels": unique_labels(base_labels, DEFAULT_LABELS.get(priority, ["feedback"])),
        "updates": {
            sync_fields["fingerprint"]: fp,
        },
    }


def extract_existing_fingerprints(existing_issues: List[Dict[str, Any]]) -> Tuple[set, set]:
    titles = {issue.get("title", "") for issue in existing_issues}
    fingerprints = set()
    for issue in existing_issues:
        body = issue.get("body") or ""
        marker = "feedback-fingerprint: "
        if marker in body:
            fingerprints.add(body.split(marker, 1)[1].split("-->", 1)[0].strip())
    return titles, fingerprints


def sync_fields_from_env() -> Dict[str, str]:
    return {
        key: env(f"BITABLE_{key.upper()}_FIELD", default)
        for key, default in SYNC_FIELD_DEFAULTS.items()
    }


def should_sync(fields: Dict[str, Any], sync_fields: Dict[str, str], require_flag: bool) -> bool:
    issue_url = stringify(fields.get(sync_fields["issue_url"]))
    if issue_url:
        return False
    if not require_flag:
        return True
    return is_truthy(fields.get(sync_fields["flag"]))


def main() -> int:
    base_token = env("BITABLE_BASE_TOKEN", "IjTWbPUYlaaD6asCUf5crYPFnoc")
    table_id = env("BITABLE_TABLE_ID", "tbl2Yd8krZwfzFsS")
    view_id = env("BITABLE_VIEW_ID", "vew2CzUow3")
    cli_bin = env("LARK_CLI_BIN", "lark-cli")
    identity = env("LARK_IDENTITY", "user")
    fixture_path = env("FEISHU_RECORDS_JSON")
    repo = env("GITHUB_REPO", "nexu-io/nexu")
    token = clean_token(env("GITHUB_TOKEN"))
    default_date = env("FEEDBACK_DATE")
    dry_run = env("DRY_RUN", "true").lower() != "false"
    require_flag = env("BITABLE_REQUIRE_SYNC_FLAG", "true").lower() != "false"
    base_labels = parse_label_list(env("GITHUB_BASE_LABELS", "source:feishu,triage"))
    sync_fields = sync_fields_from_env()

    feishu = FeishuCLIClient(cli_bin, base_token, table_id, view_id, identity, fixture_path)
    github: Optional[GitHubClient] = None
    existing_titles = set()
    existing_fingerprints = set()

    if token:
        github = GitHubClient(repo, token)
        try:
            existing_titles, existing_fingerprints = extract_existing_fingerprints(github.list_issues())
        except (urllib.error.HTTPError, urllib.error.URLError) as exc:
            print(f"读取 GitHub issues 失败: {exc}", file=sys.stderr)
            return 1
    elif not dry_run:
        print("缺少 GITHUB_TOKEN，无法执行真实同步。", file=sys.stderr)
        return 1

    try:
        records = feishu.list_records()
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    print(f"FOUND_RECORDS {len(records)}")
    created = 0
    skipped = 0
    updated = 0

    for record in records:
        record_id = stringify(record.get("record_id") or record.get("recordId") or record.get("id"))
        fields = record.get("fields") if isinstance(record.get("fields"), dict) else record
        if not record_id:
            skipped += 1
            print("SKIP missing record_id")
            continue

        if not should_sync(fields, sync_fields, require_flag):
            skipped += 1
            print(f"SKIP {record_id} not selected for sync")
            continue

        issue = build_issue(fields, sync_fields, default_date, base_labels)
        updates = dict(issue["updates"])

        if issue["title"] in existing_titles or issue["fingerprint"] in existing_fingerprints:
            skipped += 1
            updates[sync_fields["sync_status"]] = "已跳过：GitHub 已存在相同反馈"
            print(f"SKIP {record_id} duplicate {issue['title']}")
            try:
                feishu.update_record(record_id, updates, dry_run)
                updated += 1
            except RuntimeError as exc:
                print(f"回写失败 {record_id}: {exc}", file=sys.stderr)
            continue

        if dry_run:
            created += 1
            updates[sync_fields["sync_status"]] = f"DRY RUN: 将创建 {issue['title']}"
            print(f"DRY RUN CREATE {record_id} {issue['title']}")
            try:
                feishu.update_record(record_id, updates, dry_run)
                updated += 1
            except RuntimeError as exc:
                print(f"回写失败 {record_id}: {exc}", file=sys.stderr)
            continue

        assert github is not None
        try:
            created_issue = github.create_issue(
                {
                    "title": issue["title"],
                    "body": issue["body"],
                    "labels": issue["labels"],
                }
            )
        except (urllib.error.HTTPError, urllib.error.URLError) as exc:
            updates[sync_fields["sync_status"]] = f"同步失败: {exc}"
            print(f"CREATE FAILED {record_id} {issue['title']}: {exc}", file=sys.stderr)
            try:
                feishu.update_record(record_id, updates, dry_run)
                updated += 1
            except RuntimeError as update_exc:
                print(f"回写失败 {record_id}: {update_exc}", file=sys.stderr)
            continue

        created += 1
        issue_number = created_issue.get("number")
        issue_url = created_issue.get("html_url") or created_issue.get("url")
        updates[sync_fields["issue_number"]] = issue_number
        updates[sync_fields["issue_url"]] = issue_url
        updates[sync_fields["sync_status"]] = "已同步到 GitHub"
        print(f"CREATED #{issue_number} {issue['title']}")
        try:
            feishu.update_record(record_id, updates, dry_run)
            updated += 1
        except RuntimeError as exc:
            print(f"回写失败 {record_id}: {exc}", file=sys.stderr)

    print(f"SUMMARY created={created} skipped={skipped} updated={updated} dry_run={dry_run}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
