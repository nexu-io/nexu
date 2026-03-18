# Slack

All you need is a Signing Secret and a Bot Token to connect your Slack bot to nexu.

## Step 1: Create a Slack app

1. Click the link below to create a pre-configured Slack app using a manifest (permissions, events, and bot settings are all set up automatically):

👉 [Create Slack App](https://api.slack.com/apps?new_app=1&manifest_json=%7B%22display_information%22%3A%7B%22name%22%3A%22Nexu%22%2C%22description%22%3A%22Nexu%20%E2%80%94%20AI-powered%20workspace%20for%20your%20team%22%2C%22background_color%22%3A%22%2329292b%22%7D%2C%22features%22%3A%7B%22bot_user%22%3A%7B%22display_name%22%3A%22Nexu%22%2C%22always_online%22%3Atrue%7D%7D%2C%22oauth_config%22%3A%7B%22redirect_urls%22%3A%5B%22https%3A%2F%2Fapi.nexu.io%2Fapi%2Foauth%2Fslack%2Fcallback%22%5D%2C%22scopes%22%3A%7B%22bot%22%3A%5B%22app_mentions%3Aread%22%2C%22assistant%3Awrite%22%2C%22channels%3Ahistory%22%2C%22channels%3Aread%22%2C%22chat%3Awrite%22%2C%22chat%3Awrite.customize%22%2C%22chat%3Awrite.public%22%2C%22files%3Aread%22%2C%22files%3Awrite%22%2C%22groups%3Ahistory%22%2C%22groups%3Aread%22%2C%22im%3Ahistory%22%2C%22im%3Aread%22%2C%22im%3Awrite%22%2C%22im%3Awrite.topic%22%2C%22links%3Awrite%22%2C%22metadata.message%3Aread%22%2C%22mpim%3Ahistory%22%2C%22mpim%3Aread%22%2C%22mpim%3Awrite%22%2C%22mpim%3Awrite.topic%22%2C%22reactions%3Awrite%22%2C%22remote_files%3Aread%22%2C%22team%3Aread%22%2C%22usergroups%3Aread%22%2C%22users%3Aread%22%2C%22users.profile%3Aread%22%5D%7D%7D%2C%22settings%22%3A%7B%22event_subscriptions%22%3A%7B%22request_url%22%3A%22https%3A%2F%2Fapi.nexu.io%2Fapi%2Fslack%2Fevents%22%2C%22bot_events%22%3A%5B%22app_mention%22%2C%22app_uninstalled%22%2C%22file_created%22%2C%22message.channels%22%2C%22message.groups%22%2C%22message.im%22%2C%22message.mpim%22%2C%22subteam_created%22%2C%22team_join%22%2C%22team_rename%22%2C%22tokens_revoked%22%5D%7D%2C%22org_deploy_enabled%22%3Afalse%2C%22socket_mode_enabled%22%3Afalse%2C%22token_rotation_enabled%22%3Afalse%7D%7D)

2. Select the Workspace to install to and click "Next".

![Pick a Workspace](/assets/slack/step1-pick-workspace.webp)

3. Review the pre-configured permissions and URLs, then click "Create".

![Review and Create](/assets/slack/step1-review-create.webp)

4. Once created, click "Got It".

![App Created](/assets/slack/step1-welcome.webp)

## Step 2: Get the Signing Secret

Go to "Basic Information" → "App Credentials" and copy:
- **Signing Secret**

![Get Signing Secret](/assets/slack/step2-signing-secret.webp)

## Step 3: Get the Bot Token

1. In the sidebar, go to "Install App" and click "Install to Workspace".

![Install App](/assets/slack/step3-install-app.webp)

2. On the authorization page, click "Allow".

![Authorize App](/assets/slack/step3-authorize.webp)

3. Copy and save:
   - **Bot User OAuth Token**

![Get Bot Token](/assets/slack/step3-bot-token.webp)

## Step 4: Enable Direct Messages

In the sidebar, go to "App Home", scroll down to "Show Tabs" → "Messages Tab", make sure it's enabled, and check "Allow users to send Slash commands and messages from the messages tab".

![Enable Direct Messages](/assets/slack/step4-app-home.webp)

## Step 5: Add credentials to nexu

Open the nexu client, enter the Bot User OAuth Token and Signing Secret in the Slack channel settings, and click "Connect".

![Add credentials in nexu](/assets/slack/step5-nexu-connect.webp)

Once connected, click "Chat" to jump to Slack and chat with your bot 🎉

![Slack connected](/assets/slack/step5-connected.webp)

## FAQ

**Q: Do I need to configure permissions manually?**

No. The app created via the link above comes with all permissions and event subscriptions pre-configured.

**Q: Do I need a public server?**

No. nexu handles event receiving automatically — no callback URL configuration needed.
