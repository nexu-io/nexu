---
name: feedback
description: Send feedback to the Nexu team. Use when the user says /feedback followed by their message.
---

# Feedback

Collect user feedback and forward it to the Nexu team.

## When triggered

The user sends `/feedback <message>` to share feedback, report issues, or make suggestions about the Nexu platform.

## Steps

1. **Extract feedback content**: The text after `/feedback` is the user's feedback. If empty, ask the user to provide their feedback.

2. **Gather context**:
   - **agentId**: Your own agent ID. Find it from the `Runtime:` line in your system prompt — it appears as `agent=XXXXXX`. It is a cuid2 string like `y9cnvdlucvyaokp20mqrsoa9`. Do NOT use "main" or other placeholder values.
   - **channel**: The current channel type — one of `feishu`, `slack`, or `discord`.
   - **sender**: The sender's display name or username as shown in the conversation. If you only have a user ID, use that. Do NOT use generic "user" or "User".
   - **conversationContext**: Copy the actual messages from your context window (up to the last 30 messages). Format each message on its own line as:
     ```
     👤 message content
     🤖 assistant reply
     ```
     Use 👤 for user messages and 🤖 for your (assistant) replies. This must be real messages, NOT a summary.

3. **Submit feedback**: Use the exec tool to run a curl command. Build the JSON payload as a variable first, then POST it:

```bash
PAYLOAD='{"content":"<ESCAPED_FEEDBACK>","channel":"<CHANNEL_TYPE>","sender":"<SENDER>","agentId":"<AGENT_ID>","conversationContext":"<ESCAPED_CONTEXT>"}'
curl -s -X POST "${RUNTIME_API_BASE_URL:-http://localhost:3000}/api/internal/feedback" \
  -H "x-internal-token: ${SKILL_API_TOKEN:-gw-secret-token}" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD"
```

Important:
- Replace ALL `<...>` placeholders with actual values BEFORE running the command
- Properly escape JSON special characters in strings (double quotes → `\"`, newlines → `\n`, backslashes → `\\`)
- Keep conversationContext under 8000 characters
- The `${VAR:-default}` syntax provides fallback values; do NOT replace these — they are shell expressions

4. **Confirm to user**:
   - If the curl returns `{"ok":true}`, reply: "Thanks for your feedback! It has been forwarded to the Nexu team."
   - If it fails, reply: "Sorry, there was an issue sending your feedback. Please try again later."

## Important

- Do NOT modify, filter, or censor the user's feedback content. Forward it as-is.
- Do NOT ask for confirmation before sending — the user already expressed intent by using /feedback.
- The conversationContext must contain ACTUAL messages, not a one-line summary.
- The API will automatically look up the bot owner's email and bot name from the agentId, so focus on getting the agentId right.
