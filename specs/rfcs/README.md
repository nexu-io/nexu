# RFCs

This directory holds **Request for Comments** documents — short design proposals for changes that affect architecture, data models, public APIs, or user-facing workflows in a non-trivial way.

## When to write an RFC

- The change touches **multiple packages or services** and needs coordinated design.
- It **breaks backward compatibility** or changes the data model.
- It introduces a **new channel, integration, or auth flow**.
- There are **meaningful trade-offs** that the team (and community) should weigh before implementation.

Bug fixes, small features, and docs improvements do **not** need an RFC — an Issue or PR description is enough.

## Lifecycle

```text
Draft  →  Open for feedback  →  Accepted / Rejected / Superseded
```

1. **Draft:** Author opens a PR adding `NNNN-short-title.md` (zero-padded, next available number). Mark the status field as `Draft`.
2. **Open for feedback:** Maintainers review; a companion GitHub Discussion (category **RFC / Roadmap**) can be linked for broader input.
3. **Decision:** Maintainers update the status to `Accepted`, `Rejected`, or `Superseded by NNNN`. The PR is merged regardless of outcome so the reasoning is preserved.
4. **Implementation:** Accepted RFCs are tracked via Issues or Milestones that reference the RFC number.

## Template

```markdown
# RFC NNNN — Title

| Field       | Value                          |
| ----------- | ------------------------------ |
| Status      | Draft / Accepted / Rejected / Superseded by NNNN |
| Author(s)   | @handle                        |
| Created     | YYYY-MM-DD                     |
| Discussion  | (link to GitHub Discussion, if any) |

## Motivation

Why is this change needed? What problem does it solve?

## Non-goals

What is explicitly out of scope for this proposal?

## Proposal

Describe the design. Diagrams, pseudocode, or API sketches are welcome.

## Alternatives considered

What other approaches were evaluated and why were they set aside?

## Migration & compatibility

Does this break existing users or data? What is the upgrade path?

## Risks & open questions

What could go wrong? What remains undecided?
```

## Naming

Files are named `NNNN-short-title.md`, e.g. `0001-feishu-onboarding.md`. Use the next available number.
