# Skills Phase 2 — API Key Skills, AI-Only Skills & Media Generation

> Deferred from Phase 1 (OAuth2 skills only). Phase 2 adds skills that require API key authentication, AI-native skills with no external auth, and media generation skills.

**Goal:** Expand the Skills catalog beyond OAuth2 to cover API key integrations, standalone AI capabilities, and media generation tools.

**Prerequisites:** Phase 1 complete (OAuth2 skills, Composio integration, skill catalog UI).

---

## Category A: API Key Skills

These skills require user-provided API keys. The `api_key_user` auth scheme and credential form UI were built in Phase 1 but have no active skills yet.

| Skill | Toolkit Slug | Auth Scheme | Domain | Status |
|-------|-------------|-------------|--------|--------|
| Alpha Vantage | `alphavantage` | api_key | alphavantage.co | Toolkit exists in DB |
| Apollo | `apollo` | api_key | apollo.io | Toolkit exists in DB |
| Google Maps | `googlemaps` | api_key | maps.google.com | Toolkit exists in DB |
| Hunter | `hunter` | api_key | hunter.io | Toolkit exists in DB |
| Jina | `jina` | api_key | jina.ai | Toolkit exists in DB |
| Linkup | `linkup` | api_key | linkup.it | Toolkit exists in DB |
| Perplexity | `perplexity` | api_key | perplexity.ai | Toolkit exists in DB |
| Stripe | `stripe` | api_key | stripe.com | Toolkit exists in DB |

### Implementation tasks

1. **API key credential form** — The connect flow for `api_key_user` toolkits should show a dynamic form (fields from `auth_fields` column). This UI exists in `integrations.tsx` but needs testing with real skills.
2. **Credential encryption** — API keys stored via `encrypt()` in `integration_credentials` table, returned masked via `maskCredential()`. Already implemented, needs e2e verification.
3. **Re-add skills to `supported_skills`** — Insert rows with correct `toolkit_slugs`, translated English content, examples, and tags.
4. **Icons** — `jina.png` exists locally. Others need SVG download from Composio CDN or PNG fallback.

### Skill content (English, ready to insert)

| Skill slug | Name | Tag | Description |
|-----------|------|-----|-------------|
| alpha-vantage | Alpha Vantage | biz-analysis | Real-time and historical stock market data, forex, and crypto prices |
| apollo | Apollo | biz-analysis | B2B lead search, contact enrichment, and sales intelligence |
| google-maps | Google Maps | info-content | Location search, directions, geocoding, and place details |
| hunter | Hunter | info-content | Email finder, domain search, and email verification for outreach |
| jina | Jina | info-content | Web page reading, content extraction, and search via Jina AI |
| linkup | Linkup | info-content | People search and professional profile lookup |
| perplexity | Perplexity | info-content | AI-powered web search with cited, up-to-date answers |
| stripe | Stripe | dev-tools | Payment processing, subscription management, and billing operations |

---

## Category B: AI-Only Skills (No External Auth)

These skills use the AI model's native capabilities or Nexu-internal services. No Composio toolkit required — no `toolkit_slugs`.

| Skill | Description | Tag |
|-------|-------------|-----|
| Translation | Multi-language translation and localization | info-content |
| Writing Assistant | Blog posts, emails, reports, and creative writing | info-content |
| Code Review | Code analysis, bug detection, and improvement suggestions | dev-tools |
| Data Analysis | CSV/JSON data analysis, statistics, and insights | biz-analysis |
| Summarizer | Long document and article summarization | file-knowledge |
| Mind Map | Structured brainstorming and idea organization | creative-design |
| Math Solver | Step-by-step math problem solving | info-content |
| Interview Prep | Mock interviews and feedback for job preparation | info-content |
| Legal Assistant | Contract review and legal document analysis | file-knowledge |
| Presentation | Slide deck outline and content generation | creative-design |
| SEO Optimizer | SEO analysis and content optimization suggestions | biz-analysis |
| Meal Planner | Personalized meal plans and recipe suggestions | info-content |
| Fitness Coach | Workout plans and exercise guidance | info-content |
| Resume Builder | Resume writing, formatting, and optimization | creative-design |
| Study Guide | Study materials, flashcards, and quiz generation | info-content |
| Debate Partner | Argument analysis from multiple perspectives | info-content |
| Email Composer | Professional email drafting with tone control | office-collab |
| Meeting Notes | Meeting transcript summarization and action items | office-collab |
| Travel Planner | Itinerary planning with budget and preferences | info-content |
| Product Copywriter | Marketing copy, product descriptions, and taglines | creative-design |
| Tech Explainer | Complex technical concepts explained simply | info-content |

### Implementation tasks

1. **Skill icon strategy** — These skills have no toolkit, so they use Lucide icons via `icon_name`. The frontend already falls back to `SkillLucideIcon` when `iconUrl` is absent.
2. **Insert skill rows** — Add to `supported_skills` with `toolkit_slugs = NULL`, appropriate `icon_name`, and `source = 'official'`.
3. **Skill prompt design** — Each skill needs a well-crafted `prompt` field that instructs the AI model on behavior, tone, and output format.

---

## Category C: Media Generation Skills

These skills use internal or third-party AI APIs for image, audio, and video generation. Deferred because they require custom API integration beyond Composio.

| Skill | Toolkit | Auth | Description |
|-------|---------|------|-------------|
| Nano Banana Pro | `nano-banana-pro` | api_key (internal) | High-quality AI image generation |
| Wan 2.0 | `wan` | api_key | AI video generation from text prompts |
| Seedream 4.5 | `seedream` | api_key | AI image generation with style control |
| Volcengine Avatar | `volcengine-avatar` | api_key | AI avatar and portrait generation |
| Fish Audio | `fishaudio` | api_key | AI voice cloning and text-to-speech |
| Kling | `kling` | api_key | AI video generation and editing |

### Implementation tasks

1. **Internal API bridge** — Nano Banana Pro uses Nexu's internal Gemini API. Others need external API wrappers.
2. **Usage metering** — Media generation is expensive; needs per-user usage tracking and limits.
3. **Asset storage** — Generated media needs temporary storage and CDN delivery.
4. **Re-add toolkit rows** — Toolkits exist in DB but skills were removed. Re-insert skill rows when APIs are ready.

---

## Cleanup tasks

After Phase 2 skills are added:

1. **Remove orphaned toolkits** — Toolkits in `supported_toolkits` that have no linked skill and are not planned for future use.
2. **Remove unused icon files** — `jina.png` and any other PNGs for removed skills. Simplify `PNG_ICON_SLUGS` if all remaining icons are SVG.
3. **Update seed migration** — Consolidate all skill/toolkit inserts into a single migration for fresh deployments.

---

## Priority order

1. **Category B (AI-Only)** — No external dependencies, fastest to ship, broadens catalog significantly
2. **Category A (API Key)** — Infrastructure exists, just needs skill content and testing
3. **Category C (Media)** — Requires most engineering work (API bridges, metering, storage)
