# WeCom

Using the Intelligent Bot feature inside the WeCom client, you only need to copy the `Bot ID` and `Secret` to connect WeCom to nexu.

## Prerequisites

- If you are already part of a WeCom organization, you need enterprise admin permission in that organization to create and use an intelligent bot.
- If you are an individual user, you can register your own WeCom account first. Personal registration is free and does not require business credentials.

## Step 1: Open Intelligent Bot and start creating

1. Open the nexu client and click **WeCom** in the Channels section.

![Choose WeCom in nexu](/assets/wecom/step0-choose-wecom-channel.webp)

2. In the WeCom client, click "Workbench" in the left sidebar, switch to "Smart Office" at the top, then open "Intelligent Bot".

![Open the Intelligent Bot page](/assets/wecom/step1-open-workbench.webp)

3. On the Intelligent Bot page, click "Create Bot".

![Click Create Bot](/assets/wecom/step2-create-bot-entry.webp)

4. In the creation dialog, click "Manual Create" in the lower-left corner.

![Choose Manual Create](/assets/wecom/step3-manual-create.webp)

## Step 2: Switch to API mode and copy credentials

1. On the creation page, click "Create in API Mode" on the right.

![Switch to API mode](/assets/wecom/step4-api-mode.webp)

2. In API settings, choose "Use Long Connection".

3. Copy and save these two values:
   - **Bot ID**
   - **Secret**

You will need them when connecting WeCom in nexu.

![Choose long connection and copy Bot ID and Secret](/assets/wecom/step5-copy-botid-secret.webp)

## Step 3: Grant permissions

1. On the same page, scroll down to "Available Permissions" and click the expand button on the right.

![Open the permissions panel](/assets/wecom/step6-open-permissions.webp)

2. In the permissions dialog, click "Authorize All".

![Authorize all permissions](/assets/wecom/step7-authorize-all.webp)

## Step 4: Finish the bot configuration and save

1. Back on the bot settings page, confirm or adjust the visibility scope so you or the intended members can see and use the bot.

![Set the visibility scope](/assets/wecom/step8-visible-range.webp)

2. If needed, edit the bot avatar, name, and description, then click "Confirm".

![Edit bot information](/assets/wecom/step9-edit-bot-info.webp)

3. After confirming the settings, click "Save" at the bottom.

![Save the bot configuration](/assets/wecom/step10-save-bot.webp)

## Step 5: Open the bot and start using it

1. After saving, click "Use Now" on the bot details page.

![Open the bot details page](/assets/wecom/step11-use-bot.webp)

2. Go back to nexu, paste the `Bot ID` and `Secret` into the WeCom channel dialog, then click "Connect WeCom".

![Enter Bot ID and Secret in nexu](/assets/wecom/step12-nexu-connect.webp)

3. In Contacts or in the bot list, find the bot you just created and click "Send Message".

![Open the bot conversation](/assets/wecom/step12-send-message.webp)

4. Once connected, you can chat with your Agent in WeCom like this.

![Chat with the bot in WeCom](/assets/wecom/step13-chat.webp)

---

## FAQ

**Q: Can I use this if I am not an enterprise admin?**

Yes. If you are not an admin in an existing organization, you can register your own WeCom account first and create the intelligent bot yourself.

**Q: Do I need my own server or public callback URL?**

No. If you choose "Use Long Connection" in this flow, you do not need to configure your own public callback address.

**Q: Why is the bot not replying after I connected it?**

Check these first:

- The `Bot ID` and `Secret` in nexu are correct
- Permissions in WeCom have been granted
- The visibility scope includes you
- The nexu client is still running

**Q: Can I add this bot to a group chat?**

Yes. It is best to confirm that the bot works in a 1:1 chat first, then add it to a WeCom group chat.
