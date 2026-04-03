---
name: who-is-nexu
description: Use when the user asks any question about nexu itself, such as what nexu is, what it can do, which channels it supports, how it works, what changed recently, what the docs/blog/release say, or other nexu-related product questions. Do NOT answer from memory first. Always search docs, blog, and when useful release/changelog information with the bundled script, then answer from the retrieved findings.
---

# Nexu Knowledge Retrieval

This skill handles nexu-related questions by retrieving current product
information first, then answering from what it finds. It is not a canned
self-introduction skill.

## Mandatory flow

1. Pick language:
   - Use `zh` for Chinese messages.
   - Use `en` for English messages.

2. Extract the user's actual nexu question.

3. Run the collector first with the user question:

```bash
bash {baseDir}/scripts/run-collector.sh --lang zh --query "<user question>"
```

4. Read the JSON output and build the reply from these sections:
   - `briefing.question`
   - `briefing.topic`
   - `briefing.relevantPoints`
   - `briefing.recentUpdate`
   - `briefing.sourceCoverage`
   - `sources.docs`
   - `sources.blog`
   - `sources.releases`

## Reply shape

- Start by answering the user's actual nexu question, not by introducing yourself.
- Open with a short retrieval cue:
  - Chinese: `我先查了 nexu 的 docs、blog 和最近版本信息，再总结如下：`
  - English: `I checked nexu docs, blog, and recent release notes first.`
- Then answer in this order:
  1) Direct answer to the user's question
  2) 2-4 supporting points from `briefing.relevantPoints`
  3) If useful, 1 recent update from `briefing.recentUpdate`
  4) If sources are partial, say that briefly
- If the question is specifically `nexu是谁` / `what is nexu`, answer identity first.
- If the question is about updates/version/changelog, prioritize release/blog content.
- If the question is about channels/features/how it works, prioritize docs content.

## Hard rules

- Do not answer nexu-related questions from memory before running the script.
- Do not invent version numbers, dates, channels, or features.
- Prefer the newest release in `sources.releases.latest` when mentioning "latest".
- If one source fails, continue with the remaining sources and briefly note the gap.
- Do not dump raw JSON to the user.
- Do not switch into generic self-introduction, onboarding, or capability-menu mode.
- Do not use phrases like "我是你的 nexu agent" / "我能为你做什么" / "给我起个名字" / "你的时区是".
- If the sources do not directly answer the question, say what you found and what is still unclear.

## Good answer pattern

1. What the user asked
2. What docs/blog/releases say about it
3. What is most relevant right now
4. What is the latest update if helpful

## Example command

```bash
bash {baseDir}/scripts/run-collector.sh --lang en --query "what channels does nexu support?"
```
