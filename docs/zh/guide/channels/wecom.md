# 企业微信

通过企业微信客户端里的「智能机器人」能力，只需复制 `Bot ID` 和 `Secret`，即可将企业微信接入 nexu。

## 前置条件

- 如果你已经加入某个企业微信组织架构，需要拥有该组织的企业管理员权限，才可以创建和使用智能机器人。
- 如果你是个人用户，也可以先注册企业微信账号再使用，个人注册免费，无需企业资质。

## 第一步：进入智能机器人并开始创建

1. 打开 nexu 客户端，在 Channels 区域点击 **企微**。

![在 nexu 中选择企微渠道](/assets/wecom/step0-choose-wecom-channel.webp)

2. 在企业微信客户端中，点击左侧「工作台」，切换到上方「智能办公」，再点击「智能机器人」。

![进入智能机器人页面](/assets/wecom/step1-open-workbench.webp)

3. 进入智能机器人页面后，点击「创建机器人」。

![点击创建机器人](/assets/wecom/step2-create-bot-entry.webp)

4. 在弹出的创建窗口中，点击左下角「手动创建」。

![选择手动创建](/assets/wecom/step3-manual-create.webp)

## 第二步：切换到 API 模式并复制凭证

1. 进入创建页后，点击右侧的「API 模式创建」。

![切换到 API 模式创建](/assets/wecom/step4-api-mode.webp)

2. 在 API 配置区域选择「使用长连接」。

3. 复制并保存以下两个参数：
   - **Bot ID**
   - **Secret**

后面在 nexu 中连接企业微信时，就会用到这两个参数。

![选择长连接并复制 Bot ID 和 Secret](/assets/wecom/step5-copy-botid-secret.webp)

## 第三步：完成权限授权

1. 在同一页面继续往下，找到「可使用权限」，点击右侧展开按钮。

![打开权限设置](/assets/wecom/step6-open-permissions.webp)

2. 在权限弹窗中点击「全部授权」。

![全部授权](/assets/wecom/step7-authorize-all.webp)

## 第四步：完善机器人配置并保存

1. 回到机器人配置页后，确认或修改「可见范围」，确保你自己或目标成员可以看到并使用这个机器人。

![设置可见范围](/assets/wecom/step8-visible-range.webp)

2. 如有需要，可以继续编辑机器人头像、名称和简介，填好后点击「确定」。

![完善机器人信息](/assets/wecom/step9-edit-bot-info.webp)

3. 确认权限和配置信息无误后，点击底部「保存」。

![保存机器人配置](/assets/wecom/step10-save-bot.webp)

## 第五步：打开机器人并开始使用

1. 保存成功后，在机器人详情页点击「去使用」。

![进入机器人详情](/assets/wecom/step11-use-bot.webp)

2. 回到 nexu，将前面复制的 `Bot ID` 和 `Secret` 填入企微渠道配置，点击「连接企微」。

![在 nexu 中填写 Bot ID 和 Secret](/assets/wecom/step12-nexu-connect.webp)

3. 在通讯录或机器人列表中找到刚创建的机器人，点击「发消息」。

![打开机器人会话](/assets/wecom/step12-send-message.webp)

4. 连接成功后，就可以像下面这样在企业微信里和 Agent 正常对话。

![企业微信中与机器人对话](/assets/wecom/step13-chat.webp)

---

## 常见问题

**Q: 我不是企业管理员，也能用企业微信接入吗？**

可以。个人用户可以自己注册企业微信账号，再直接创建智能机器人使用。

**Q: 需要自己准备服务器或者公网地址吗？**

不需要。按这套流程选择「使用长连接」即可，无需自己配置公网回调地址。

**Q: 连接成功后为什么机器人不回复？**

优先检查这几项：

- nexu 里填写的 `Bot ID` 和 `Secret` 是否正确
- 企业微信里的权限是否已经授权
- 机器人可见范围里是否包含你自己
- nexu 客户端是否仍在运行

**Q: 可以把这个机器人拉进群聊里用吗？**

可以。先确认单聊正常，再把机器人加入企业微信群聊使用会更稳妥。
