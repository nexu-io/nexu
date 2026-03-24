# RFC 0002 — Cloud Skills: pre-configured skills for logged-in users

| Field       | Value                          |
| ----------- | ------------------------------ |
| Status      | Draft                          |
| Author(s)   | @qiongyu1999                   |
| Created     | 2026-03-23                     |
| Discussion  | [#362](https://github.com/nexu-io/nexu/discussions/362) |

## Motivation

nexu already provides **cloud models** — users who log in with a nexu account can use Claude, GPT, Gemini, and other models without supplying their own API keys. This removes the biggest barrier to getting started.

However, **Skills** still require local setup. Users must obtain and configure their own API keys for third-party services (search engines, image generators, etc.) before any Skill can function. This creates a second onboarding wall right after the model problem is solved.

**Goal:** Extend the "log in and it just works" experience from models to Skills. When a user is signed in with a nexu account, a curated set of **cloud-hosted, pre-configured Skills** becomes available in the client — no API keys, no manual setup.

## Examples of cloud Skills

| Category | Examples | What the user gets |
| --- | --- | --- |
| **Search & retrieval** | Exa, Jina | Web search, URL reading, and RAG-style retrieval powered by pre-provisioned keys |
| **Media generation** | Banana (image, video, audio) | Generate images, videos, or audio clips via cloud-hosted model endpoints |

The list is expected to grow over time. The architecture should make it straightforward to add new cloud Skills without client updates.

## Non-goals

- Replacing local / BYO-key Skills — users who prefer their own keys or self-hosted services keep that option.
- Building a Skill marketplace or user-contributed Skill store (may come later, but out of scope here).
- Changing the OpenClaw Skill protocol itself.

## Proposal

### How it works (high level)

1. **User signs in** with their nexu account (existing auth flow).
2. **Client fetches the cloud Skill catalog** from the nexu backend — a list of Skills that are available to the user's plan/tier.
3. **Cloud Skills appear in the client** alongside locally installed Skills, visually distinguished (e.g. a "cloud" badge).
4. **At runtime**, when a cloud Skill is invoked:
   - For **tool-type Skills** (search, media generation): the Skill executes against nexu-managed API keys on the server side. The user's local client sends the Skill invocation to the nexu backend, which injects the pre-provisioned key, calls the third-party API, and returns the result.
   - For **channel-authorization Skills** (WhatsApp): the client presents a QR code or OAuth link; the authorization flow is handled server-side with pre-configured credentials, similar to how cloud models work today.
5. **No local key configuration** is needed for cloud Skills. Users who want to override with their own key can do so in settings (falls back to local execution).

### Key design questions

- **Server-side execution vs. key injection:** Should the nexu backend execute the third-party API call (proxy model), or send a short-lived / scoped key to the client so it can call directly? Proxy is simpler for security; direct call may have lower latency for some use cases.
- **Catalog format:** How is the cloud Skill catalog represented? A static list from the backend, or a dynamic registry that can be updated without client releases?
- **Tier / quota:** Are all cloud Skills available to all logged-in users, or are some gated by plan? How are usage limits enforced?

## Alternatives considered

- **Pre-bundle API keys in the client binary:** Rejected — keys would be extractable, and rotation would require a client update.
- **Require users to create accounts on each third-party service:** This is the status quo. Rejected as the default path because it defeats the "log in and go" value proposition.

## Migration & compatibility

- No breaking change. Cloud Skills are additive — they appear alongside existing local Skills.
- Users who are not logged in (BYO API key mode) see no difference.
- Existing locally configured Skills are unaffected and take precedence if both a local and cloud version exist for the same capability.

## Risks & open questions

1. **Cost control** — Cloud Skills consume third-party API quota paid by nexu. How do we set sustainable per-user limits without degrading the experience?
2. **Latency** — Proxying through the nexu backend adds a hop. Is this acceptable for real-time use cases (e.g. search during a conversation)?
3. **Third-party reliability** — If a cloud Skill's upstream provider has an outage, how does the client communicate this? Graceful fallback to local key if configured?
4. **Privacy** — Some Skill invocations may contain sensitive user data (search queries, document content). How do we handle data-in-transit and retention on the nexu backend?
5. **Skill versioning** — When a cloud Skill is updated server-side, does the client need to be aware? How do we handle backward compatibility?

## Next steps

- [ ] Define the cloud Skill catalog API (endpoint, schema, auth).
- [ ] Prototype one cloud Skill end-to-end (e.g. Exa search) to validate the proxy architecture.
- [ ] Design the client UI for cloud vs. local Skill distinction.
- [ ] Determine initial tier/quota model.
- [ ] Update this RFC with findings.
