# Slack

只需获取 Signing Secret 和 Bot Token，即可将 Slack 机器人接入 nexu。

## 第一步：创建 Slack 应用

1. 点击下方链接，使用预配置的 manifest 一键创建 Slack 应用（权限、事件订阅等已自动配好）：

👉 [Create Slack App](https://api.slack.com/apps?new_app=1&manifest_json=%7B%22display_information%22%3A%7B%22name%22%3A%22Nexu%22%2C%22description%22%3A%22Nexu%20%E2%80%94%20AI-powered%20workspace%20for%20your%20team%22%2C%22background_color%22%3A%22%2329292b%22%7D%2C%22features%22%3A%7B%22bot_user%22%3A%7B%22display_name%22%3A%22Nexu%22%2C%22always_online%22%3Atrue%7D%7D%2C%22oauth_config%22%3A%7B%22redirect_urls%22%3A%5B%22https%3A%2F%2Fapi.nexu.io%2Fapi%2Foauth%2Fslack%2Fcallback%22%5D%2C%22scopes%22%3A%7B%22bot%22%3A%5B%22app_mentions%3Aread%22%2C%22assistant%3Awrite%22%2C%22channels%3Ahistory%22%2C%22channels%3Aread%22%2C%22chat%3Awrite%22%2C%22chat%3Awrite.customize%22%2C%22chat%3Awrite.public%22%2C%22files%3Aread%22%2C%22files%3Awrite%22%2C%22groups%3Ahistory%22%2C%22groups%3Aread%22%2C%22im%3Ahistory%22%2C%22im%3Aread%22%2C%22im%3Awrite%22%2C%22im%3Awrite.topic%22%2C%22links%3Awrite%22%2C%22metadata.message%3Aread%22%2C%22mpim%3Ahistory%22%2C%22mpim%3Aread%22%2C%22mpim%3Awrite%22%2C%22mpim%3Awrite.topic%22%2C%22reactions%3Awrite%22%2C%22remote_files%3Aread%22%2C%22team%3Aread%22%2C%22usergroups%3Aread%22%2C%22users%3Aread%22%2C%22users.profile%3Aread%22%5D%7D%7D%2C%22settings%22%3A%7B%22event_subscriptions%22%3A%7B%22request_url%22%3A%22https%3A%2F%2Fapi.nexu.io%2Fapi%2Fslack%2Fevents%22%2C%22bot_events%22%3A%5B%22app_mention%22%2C%22app_uninstalled%22%2C%22file_created%22%2C%22message.channels%22%2C%22message.groups%22%2C%22message.im%22%2C%22message.mpim%22%2C%22subteam_created%22%2C%22team_join%22%2C%22team_rename%22%2C%22tokens_revoked%22%5D%7D%2C%22org_deploy_enabled%22%3Afalse%2C%22socket_mode_enabled%22%3Afalse%2C%22token_rotation_enabled%22%3Afalse%7D%7D)

2. 选择要安装到的 Workspace，点击「Next」。

![选择 Workspace](/assets/slack/step1-pick-workspace.webp)

3. 确认预配置的权限和 URL，点击「Create」。

![确认配置并创建](/assets/slack/step1-review-create.webp)

4. 创建成功后，点击「Got It」。

![创建成功](/assets/slack/step1-welcome.webp)

## 第二步：获取 Signing Secret

进入「Basic Information」→「App Credentials」，复制保存：
- **Signing Secret**

![获取 Signing Secret](/assets/slack/step2-signing-secret.webp)

## 第三步：获取 Bot Token

1. 在侧边栏进入「Install App」，点击「Install to Workspace」。

![安装应用](/assets/slack/step3-install-app.webp)

2. 在授权页面点击「允许」。

![授权应用](/assets/slack/step3-authorize.webp)

3. 复制保存：
   - **Bot User OAuth Token**

![获取 Bot Token](/assets/slack/step3-bot-token.webp)

## 第四步：开启私信

在侧边栏进入「App Home」，向下找到「Show Tabs」→「Messages Tab」，确认已开启，并勾选「Allow users to send Slash commands and messages from the messages tab」。

![开启私信](/assets/slack/step4-app-home.webp)

## 第五步：在 nexu 中填入凭证

打开 nexu 客户端，在 Slack 渠道配置中填入 Bot User OAuth Token 和 Signing Secret，点击「Connect」。

![在 nexu 中填入凭证](/assets/slack/step5-nexu-connect.webp)

连接成功后，点击「Chat」即可跳转到 Slack 与机器人对话 🎉

![Slack 已连接](/assets/slack/step5-connected.webp)

## 常见问题

**Q: 需要手动配置权限吗？**

不需要。通过上方链接创建的应用已自动配置好所有权限和事件订阅。

**Q: 需要公网服务器吗？**

不需要。nexu 会自动处理事件接收，无需额外配置回调地址。
