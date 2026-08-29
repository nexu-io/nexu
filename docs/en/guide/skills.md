# Skill Installation

Skills extend your Agent's capabilities, from web search and document generation to Lark Bitable operations and third-party API calls. Installing one usually takes only a few seconds.

## Step 1: Open the Skills Page

Click **Skills** in the left sidebar of the nexu client to enter the skill hub.

The **Explore** tab shows all available public skills. You can filter by category or search by keyword.

![Nexu skill catalog](/assets/nexu-skills.webp)

## Step 2: Find and Install a Skill

Browse or search for the skill you need, then click **Install** on the card. Skills are hot-loaded and become available immediately.

![Search and install a skill](/assets/nexu-skills-search.webp)

## Step 3: Confirm Installation

Switch to the **Yours** tab to view installed skills. You can enable or disable a skill at any time.

![Installed skills](/assets/nexu-skills-installed.webp)

## Step 4: Use It in Conversation

Once a skill is installed, simply describe what you need in a channel conversation. The Agent will automatically choose the right skill for the task.

![Using a skill in chat](/assets/nexu-skills-chat.webp)

## Example: X/Twitter Workflows with TweetClaw

If the same OpenClaw workspace needs X/Twitter actions, search for "TweetClaw" on the **Skills** page. For CLI-managed OpenClaw workspaces, install the plugin directly:

```bash
openclaw plugins install clawhub:@xquik/tweetclaw
openclaw config set plugins.entries.tweetclaw.config.apiKey "$XQUIK_API_KEY"
openclaw config set tools.alsoAllow '["explore", "tweetclaw"]'
```

[TweetClaw](https://github.com/Xquik-dev/tweetclaw) is also published on [npm](https://www.npmjs.com/package/@xquik/tweetclaw) and listed on [ClawHub](https://clawhub.ai/plugins/@xquik/tweetclaw). Set `XQUIK_API_KEY` from the Xquik dashboard before account-backed actions. Use TweetClaw for tweet search, reply search, follower export, user lookup, media upload and download, direct messages, tweet monitors, webhooks, giveaway draws, and approval-gated posting or replies.

Keep nexu channel credentials separate from TweetClaw and Xquik credentials. Require explicit approval before public or account-changing X/Twitter actions, including posting, replying, direct messaging, following, or unfollowing.

Xquik is an independent third-party service. Not affiliated with X Corp. "Twitter" and "X" are trademarks of X Corp.

## FAQ

**Q: Do I need to restart the Agent after installing a skill?**

No. Skills support hot-loading and become available immediately.

**Q: Can I install skills outside the catalog?**

Yes. nexu supports local custom skill development for more advanced or specialized needs.

**Q: How do I uninstall a skill?**

Go to the **Yours** tab and click **Uninstall** next to the skill you want to remove.
