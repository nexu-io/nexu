# Discord

All you need is an Application ID and a Bot Token to connect your Discord bot to nexu.

## Step 1: Create a Discord application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) and click "New Application".

![Discord Applications page](/assets/discord/step1-applications.webp)

2. Enter the application name and click "Create".

![Create application](/assets/discord/step1-create-app.webp)

3. On the "General Information" page, copy and save:
   - **Application ID**

![Get Application ID](/assets/discord/step1-general-info.webp)

4. In the left menu, go to "Bot", click "Reset Token" to generate a Bot Token, and copy it:
   - **Bot Token**

![Generate Bot Token](/assets/discord/step3-bot-token.webp)

## Step 2: Add credentials to nexu

Open the nexu client, enter the App ID and Bot Token in the Discord channel settings, and click "Connect".

![Add credentials in nexu](/assets/discord/step2-nexu-connect.webp)

## Step 3: Configure permissions and invite the bot

1. Back in the Discord Developer Portal, on the "Bot" page, enable the following Privileged Gateway Intents:
   - **Message Content Intent**

![Enable Message Content Intent](/assets/discord/step4-intents.webp)

2. In the left menu, go to "OAuth2" → "URL Generator" and select Scopes:
   - `bot`
   - `applications.commands`

![Select Scopes](/assets/discord/step5-scopes.webp)

3. Under Bot Permissions, select:
   - `View Channels`
   - `Send Messages`
   - `Read Message History`
   - `Embed Links`
   - `Attach Files`
   - `Add Reactions`
   - `Use External Emojis`
   - `Use External Stickers`

![Select Bot Permissions](/assets/discord/step5-permissions.webp)

4. Copy the generated URL at the bottom of the page and open it in your browser.

![Copy generated URL](/assets/discord/step5-generated-url.webp)

5. Select your server and click "Continue".

![Select server](/assets/discord/step3-select-server.webp)

6. Confirm the permissions and click "Authorize" to add the bot.

![Authorize bot](/assets/discord/step3-authorize.webp)

## Step 4: Test

Once connected, click "Chat" in the nexu client to jump to Discord and chat with your bot 🎉

![Discord connected](/assets/discord/step4-connected.webp)

## FAQ

**Q: Do I need a public server?**

No. nexu uses the Discord Gateway (WebSocket) — no public IP or callback URL required.

**Q: The bot doesn't reply to messages?**

Make sure you've enabled Message Content Intent, otherwise the bot cannot read message content.
