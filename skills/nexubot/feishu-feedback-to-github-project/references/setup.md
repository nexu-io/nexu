# Setup

## Required tools

- `lark-cli`
- `gh`
- `python3`

## Auth expectations

### Feishu

- `lark-cli config init --new`
- `lark-cli auth status`
- The workflow normally reads the Bitable with `--as bot`

### GitHub

Either of these is acceptable:

- `GITHUB_TOKEN` exported in the shell
- authenticated `gh` session so the wrapper can reuse `gh auth token`

## Fixed resources

- Bitable base: `IjTWbPUYlaaD6asCUf5crYPFnoc`
- table: `tbl2Yd8krZwfzFsS`
- pending view: `vewgOAhLMw`
- repo: `nexu-io/nexu`
- project: `https://github.com/orgs/nexu-io/projects/3/views/1`

## Triage policy

### Create GitHub issues for

- confirmed product bugs
- stability failures
- platform / channel failures
- install / startup regressions
- configuration flows that should work but do not
- product feedback that is concrete enough for engineering follow-up

### Hold back from GitHub issues

- pure FAQ questions
- pricing or business-model questions
- documentation-only clarifications unless the gap is severe enough to warrant engineering coordination
- duplicate reports already covered by an existing issue
- vague records with missing summary and missing repro context

## GitHub Project routing

Do not use PRs for feedback intake.

Instead, enable GitHub Project built-in automation:

- Project workflow: `Auto-add to project`
- Repository: `nexu-io/nexu`
- Filter:

```text
is:issue label:"source:feishu"
```

Optional stricter filter:

```text
is:issue label:"source:feishu" label:triage
```

## Important GitHub behavior

GitHub auto-add does **not** retroactively pull in old matching issues. It triggers when issues are created or updated.

## Typical execution

```bash
bash {baseDir}/scripts/run_pending_feedback_to_project.sh
```
