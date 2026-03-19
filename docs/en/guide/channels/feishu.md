# Feishu

All you need is an App ID and App Secret to connect your Feishu bot to nexu.

## Step 1: Create a Feishu app

1. Go to the [Feishu Open Platform](https://open.feishu.cn/app), sign in, and click "Create Custom App".

![Feishu Open Platform app list](/assets/feishu/step1-app-list.webp)

2. Fill in the app name, description, choose an icon, and click "Create".

![Create Custom App](/assets/feishu/step1-create-app.webp)

3. On the "Credentials & Basic Info" page, copy these two values:
   - **App ID**
   - **App Secret**

![Get App ID and App Secret](/assets/feishu/step1-credentials.webp)

## Step 2: Add credentials to nexu

Open the nexu client, enter the App ID and App Secret in the Feishu channel settings, and click "Connect".

![Add credentials in nexu](/assets/feishu/step3-nexu-connect.webp)

## Step 3: Publish and test

1. Go back to the Feishu Open Platform, navigate to "Version Management & Release".

![Version Management & Release](/assets/feishu/step4-version-manage.webp)

2. Click "Create Version", fill in the version number and release notes, then click "Save".

![Create Version](/assets/feishu/step4-create-version.webp)

3. Click "Publish" and wait for approval.

![Publish](/assets/feishu/step4-publish.webp)

4. Once approved, click "Chat" in the nexu client to jump to Feishu and chat with your bot 🎉

![Feishu connected](/assets/feishu/step3-connected.webp)

## FAQ

**Q: Do I need a public server?**

No. nexu uses Feishu's long-connection (WebSocket) mode — no public IP or callback URL required.

**Q: Do I need to configure permissions manually?**

No. nexu handles all required permissions automatically. Just provide the App ID and App Secret.

