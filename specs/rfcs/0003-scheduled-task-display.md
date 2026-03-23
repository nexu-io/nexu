# RFC 0003 — Display scheduled tasks in the desktop client

| Field       | Value                          |
| ----------- | ------------------------------ |
| Status      | Draft                          |
| Author(s)   | @qiongyu1999                   |
| Created     | 2026-03-23                     |
| Discussion  | [#363](https://github.com/nexu-io/nexu/discussions/363) |

## Motivation

nexu supports **scheduled tasks** — users can ask their Agent to perform actions on a recurring basis (e.g. "every morning at 9am, summarize my unread Feishu messages"). These tasks are created through conversation and executed by the runtime.

However, **the client currently has no UI for scheduled tasks**. Once a task is created via chat, the user has no way to:

- See a list of active scheduled tasks
- Check when a task last ran or will next run
- View execution history or results
- Pause, resume, edit, or delete a task
- Understand why a task failed

This makes scheduled tasks feel like a black box. Users forget what they've set up, can't debug failures, and have no confidence the system is working.

**Goal:** Surface scheduled tasks as a first-class concept in the nexu desktop client, giving users visibility and control.

## Non-goals

- Changing the underlying scheduling engine or runtime behavior.
- Building a visual task builder / workflow editor (may come later).
- Supporting cron-expression editing in the UI (natural language via chat is the primary creation path).

## Proposal

### Task list view

Add a dedicated **Scheduled Tasks** section in the client (sidebar or top-level tab) that shows:

| Column | Description |
| --- | --- |
| **Name / description** | What the task does (derived from the original chat message or a user-editable label) |
| **Schedule** | Human-readable schedule (e.g. "Every weekday at 9:00 AM") |
| **Channel** | Which IM channel the task runs in (Feishu, WeChat, etc.) |
| **Status** | Active, Paused, or Failed |
| **Last run** | Timestamp + outcome (success / error) |
| **Next run** | When the task will fire next |

### Task detail / history

Clicking a task opens a detail view with:

- Full execution history (last N runs, expandable)
- Output or summary of each run
- Error messages if a run failed
- The original conversation where the task was created (link back to chat)

### Task actions

- **Pause / Resume** — Temporarily stop a task without deleting it.
- **Delete** — Remove the task permanently (with confirmation).
- **Edit schedule** — Change timing via a simple UI or by opening a chat with the Agent to rephrase.
- **Run now** — Trigger an immediate execution for testing.

### Data source

The scheduling runtime already persists task definitions and execution records. The client needs an API to:

1. `GET /tasks` — List all scheduled tasks for the current user/pool.
2. `GET /tasks/:id/history` — Execution history for a specific task.
3. `PATCH /tasks/:id` — Update status (pause/resume) or schedule.
4. `DELETE /tasks/:id` — Remove a task.
5. `POST /tasks/:id/run` — Trigger immediate execution.

These endpoints should be added to the controller API behind `authMiddleware`.

## Alternatives considered

- **Show tasks inline in chat only:** Display a "your scheduled tasks" card when the user asks. Rejected as the sole approach because it requires the user to remember to ask, and doesn't provide persistent visibility.
- **System tray notifications only:** Notify on task execution but don't show a list. Rejected because it doesn't solve the "what tasks do I have" problem.

## Migration & compatibility

- No breaking change. The task list is a new UI surface reading existing data.
- If the scheduling runtime's data model needs minor additions (e.g. a human-readable label field), those should be backward-compatible (nullable columns or defaults).

## Risks & open questions

1. **Data model readiness** — Does the current task storage schema have everything needed (description, schedule expression, last/next run, status)? Or do we need migrations?
2. **Real-time updates** — Should the task list auto-refresh (WebSocket push from controller), or is polling sufficient?
3. **Multi-channel tasks** — If a task spans multiple channels or has no channel context, how is it displayed?
4. **Mobile** — Since nexu tasks also run via IM, should task management be possible from the IM side too (e.g. "list my tasks" command)?

## Next steps

- [ ] Audit the current scheduling data model for gaps.
- [ ] Design the task list and detail UI (wireframes or mockup).
- [ ] Define the controller API endpoints.
- [ ] Prototype the task list view with mock data.
- [ ] Update this RFC with findings.
