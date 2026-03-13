---
name: feedback
description: Send feedback to the Nexu team. Use when the user says /feedback followed by their message.
---

# Feedback

Collect user feedback and forward it to the Nexu team. Conversation history and images are extracted automatically by a script — you do NOT need to copy-paste messages or scan for image URLs.

## When triggered

The user sends `/feedback <message>` to share feedback, report issues, or make suggestions about the Nexu platform.

## Steps

1. **Extract feedback content**: The text after `/feedback` is the user's feedback. If empty, ask the user to provide their feedback.

2. **Gather identifiers**:
   - **agentId**: Your own agent ID. Find it from the `Runtime:` line in your system prompt — it appears as `agent=XXXXXX`. It is a cuid2 string like `y9cnvdlucvyaokp20mqrsoa9`. Do NOT use "main" or other placeholder values.
   - **channel**: The current channel type — one of `feishu`, `slack`, or `discord`.
   - **sender**: The sender's display name or username as shown in the conversation. If you only have a user ID, use that. Do NOT use generic "user" or "User".

3. **Run the submit script**: Use the exec tool to run the following command. The script automatically reads your conversation history and any images from the session file — you do NOT need to provide them manually.

```bash
SKILL_PATH="<SKILL_LOCATION>"
node "$(dirname "${SKILL_PATH/#\~/$HOME}")/submit-feedback.mjs" \
  --content "<ESCAPED_FEEDBACK>" \
  --sender "<SENDER>" \
  --channel "<CHANNEL_TYPE>" \
  --agent-id "<AGENT_ID>"
```

Important:
- Replace `<SKILL_LOCATION>` with the exact path from the `<location>` tag in your system prompt (may contain `~`)
- The `${SKILL_PATH/#\~/$HOME}` expansion handles tilde (`~`) → absolute path conversion automatically
- Replace ALL other `<...>` placeholders with actual values BEFORE running the command
- Properly escape shell special characters in the feedback content (single quotes → `'\''`, etc.)

4. **Confirm to user**:
   - If the output contains `{"ok":true}`, reply: "Thanks for your feedback! It has been forwarded to the Nexu team."
   - If it fails, reply: "Sorry, there was an issue sending your feedback. Please try again later."

## Important

- Do NOT modify, filter, or censor the user's feedback content. Forward it as-is.
- Do NOT ask for confirmation before sending — the user already expressed intent by using /feedback.
- Do NOT manually build conversationContext or imageUrls — the script handles this automatically.
- The API will automatically look up the bot owner's email and bot name from the agentId, so focus on getting the agentId right.
