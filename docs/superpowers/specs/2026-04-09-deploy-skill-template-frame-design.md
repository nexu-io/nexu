# Deploy Skill Template Frame Design

Date: 2026-04-09
Project: `nexu` bundled skill `apps/desktop/static/bundled-skills/deploy-skill`
Template: `distill-campaign`

## Summary

Define a strict canonical content frame for the `distill-campaign` template so every generated page uses the same information architecture, the same field semantics, and the same layout bindings. The skill must reject any payload that violates this contract. No silent normalization, truncation, or fallback rewriting is allowed.

## Problem

The current template parser accepts the right high-level field names, but it is still too permissive. That allows pages to drift in tone, section structure, and layout meaning even when the HTML and CSS stay the same. The result is inconsistent output and ambiguous content expectations.

The user wants every generated page to use one fixed frame:

- title
- subtitle
- tags
- metrics
- poster species fields
- description
- deep analysis cards
- dialogs
- CTA text
- install text

This frame should be enforced by the skill itself, not by prompt discipline.

This contract also needs an explicit portrait-selection field so the agent chooses a head portrait intentionally instead of relying on runtime randomness.

## Goals

- Make the provided structure the only accepted content frame for the template.
- Enforce strict validation at the template boundary before rendering.
- Keep page rendering deterministic by binding each field to a fixed part of the page.
- Preserve the current visual layout while making the content contract stricter.

## Non-Goals

- No automatic content cleanup or rewriting.
- No truncation of overlong fields.
- No support for alternate template schemas in this change.
- No attempt to infer missing fields from other content.

## Canonical Field Contract

### 1. `title`

- Type: string
- Length: 2-10 characters
- Used in:
  - page `<title>`
  - left profile name
  - poster title

### 2. `subtitle`

- Type: string
- Length: 15-30 characters
- Required format:
  - `牛马指数 XX/100 — 物种名/一句话标签`
- Used in:
  - left profile subtitle

The validator should enforce both:
- length
- presence of `牛马指数`
- presence of `/100`
- presence of `—`

The validator does not need to parse semantic subfields out of the subtitle. It only needs to ensure the required overall shape is present.

### 3. `tags`

- Type: array of strings
- Count: 1-8
- Per-item length: 2-8 characters
- Color mapping order:
  - `purple`
  - `cyan`
  - `orange`
  - `teal`
  - `mint`
  - then repeat
- Used in:
  - profile tags
  - poster tags, split into two rows:
    - first 4
    - second 4
  - first 4 quick buttons in dialogue section

### 3.5 `portraitId`

- Type: string
- Required allowed values:
  - `portrait-1`
  - `portrait-2`
  - `portrait-3`
  - `portrait-4`
  - `portrait-5`
  - `portrait-6`
  - `portrait-7`
- Used in:
  - profile avatar
  - poster avatar
  - bot avatar in dialogue area

The skill must reject missing or unknown portrait ids. Avatar selection is no longer random.

### 4. `metrics`

- Type: array of objects
- Count: 4-6 total
- Structure:
  - `metrics[0]`: main score
  - `metrics[1..]`: progress-bar metrics

#### `metrics[0]`

- `label`: string, 6-10 characters, emoji included
- `value`: numeric string only, no `%`
- Used in:
  - main score card
  - poster score block
  - skill progress numeric display

#### `metrics[1..]`

- Count: 3-5
- `label`: string, 6-12 characters, emoji included
- `value`: percentage string ending in `%`
- Used in:
  - progress bars inside core metrics card

### 5. `posterSpeciesEmoji`

- Type: string
- Must be a non-empty single emoji-like token
- Used in:
  - species card
  - poster species section

### 6. `posterSpeciesName`

- Type: string
- Length: 3-8 characters
- Used in:
  - species card
  - poster species section

### 7. `posterSpeciesSub`

- Type: string
- Length: 5-8 characters
- Used in:
  - species card
  - poster species section

### 8. `description`

- Type: string
- Length: 150-250 characters
- Restrictions:
  - no markdown formatting
  - no newline characters
  - no HTML tags
  - no list prefixes
- Used in:
  - core metrics card
  - AI roast card

This field appears twice, so validation must be strict enough to avoid bloated layouts.

### 9. `qaCards`

- Type: array of objects
- Count: 2-3
- Each item:
  - `question`: string, 3-8 characters
  - `answer`: string, 80-150 characters
- Restrictions:
  - no markdown
  - no HTML
- Icon mapping by order:
  - first: `🔥`
  - second: `💪`
  - third: `💀`

### 10. `dialogs`

- Type: array of objects
- Count: 3-6
- Each item:
  - `speaker`: `"bot"` or `"user"`
  - `text`: string, 15-80 characters
- Used in:
  - dialogue card

Rendering rules:
- `bot` avatar uses the explicitly selected portrait image
- `user` avatar uses `👤`

### 11. `ctaText`

- Type: string
- Fixed required value:
  - `⭐ 生成我的牛马锐评`
- Used in:
  - skill file card progress label area

### 12. `installText`

- Type: string
- Fixed required value:
  - `复制链接发给你的 nexu agent：https://github.com/nexu-io/roast-skill`
- Used in:
  - skill file card code block

## Validation Strategy

Validation happens inside the template parser before any rendering or zipping.

Rules:

- Reject on any missing field.
- Reject on any count violation.
- Reject on any length violation.
- Reject on any malformed value shape.
- Reject fixed-string mismatches for `ctaText` and `installText`.
- Reject percent formatting violations in `metrics[0]` vs `metrics[1..]`.
- Reject invalid `dialogs[].speaker`.
- Reject description and analysis fields that contain markdown, HTML, or newlines.

No automatic fallback values should remain for poster species fields after this change. These fields become required parts of the contract.

## Rendering Mapping

The layout stays data-driven, but each field maps to one fixed visual responsibility.

- `title`
  - document title
  - profile title
  - poster title

- `subtitle`
  - profile subtitle only

- `tags`
  - profile tags
  - poster tags in two rows
  - first 4 quick prompt buttons

- `metrics[0]`
  - main score card
  - poster score block
  - skill progress number

- `metrics[1..]`
  - progress bars

- `posterSpeciesEmoji`
  - species icon in page card and poster

- `posterSpeciesName`
  - species title in page card and poster

- `posterSpeciesSub`
  - species subtitle in page card and poster

- `description`
  - core card
  - AI roast card

- `qaCards`
  - deep analysis cards

- `dialogs`
  - chat conversation list

- `ctaText`
  - skill file action copy

- `installText`
  - skill file code block

## Error Handling

The skill should fail early with explicit validation messages that name the failing field.

Examples:

- `deploy-skill requires title with length 2-10 characters.`
- `deploy-skill template field metrics[0].value must be a numeric string without %.`
- `deploy-skill template field ctaText must equal "⭐ 生成我的牛马锐评".`

Errors should be thrown from the parser boundary and stop rendering entirely.

## Testing Strategy

Follow TDD.

Add failing tests first for:

- valid canonical payload passes
- `title` too short and too long
- `subtitle` missing required overall format
- `tags` count and per-item length bounds
- `metrics` total count bounds
- `metrics[0].value` incorrectly contains `%`
- `metrics[1].value` missing `%`
- fixed-string mismatch for `ctaText`
- fixed-string mismatch for `installText`
- `description` contains newline or markdown
- `qaCards[].answer` too short or too long
- `dialogs[].speaker` invalid
- `posterSpecies*` missing or out of bounds

Keep the focused skill test file as the primary coverage target:

- `tests/skills/deploy-skill-core.test.ts`

## Implementation Plan Shape

1. Write failing validation tests in `tests/skills/deploy-skill-core.test.ts`.
2. Tighten `parseTemplateContent()` in `deploy_skill_core.js`.
3. Remove old poster species fallbacks.
4. Update `SKILL.md` so the documented contract matches the enforced one.
5. Run focused tests.

## Risks

- Existing template payloads that used looser copy will start failing.
- Subtitle validation can become too rigid if over-specified.

## Risk Mitigation

- Enforce only the subtitle markers that matter:
  - `牛马指数`
  - `/100`
  - `—`
- Keep error messages field-specific so callers can repair payloads quickly.

## Decision

Use a strict schema contract with no normalization. This makes the field structure the canonical frame for every page and keeps both content and layout consistent.
