# Seedance 2.0 视频生成（Windows 版）

这篇文档是给 Windows 用户准备的。

如果你使用的是 Mac，请参考 [Seedance 2.0 视频生成](/zh/guide/seedance)。

## 准备工作

开始之前，先确认这几项已经准备好：

- 已安装 Windows 内测版 `nexu`
- 可以正常登录 `nexu` 账号
- 已准备一个可用的 IM 渠道，用于和自己的 `nexu` 对话

如果你还没有安装 Windows 客户端，可以先看 [Windows 正式版安装指南](/zh/guide/windows-install)。

## 第一步：前往 GitHub 给 nexu 点 Star

如果你想领取我们赠送的免费体验资格，可以先去 GitHub 给 `nexu` 仓库点一个 Star。完成后，我们会为你发放 2 个体验资格。

领取免费体验资格的方式如下：

[前往 GitHub 给 nexu 点 Star](https://github.com/nexu-io/nexu)

点完 Star 后，记得把当前页面截一张图，后面填问卷时要上传。

**截图要求**：截图里要清楚看到 **仓库名称**、**已经点亮的 Star 状态**，以及 **当前登录的 GitHub 账号**。这三项都会影响审核，尽量一次截全。下方是符合要求的示例：

![通过审核的 GitHub Star 截图示例](/assets/seedance/github-star-review-example.webp)

## 第二步：进群并填写问卷

完成 GitHub Star 后，扫描下面的二维码进群，然后按群内置顶消息填写问卷就可以。

![微信群与飞书群二维码](/assets/seedance/seedance-groups-qr.webp)

![进入群聊后查看置顶消息并填写问卷](/assets/seedance/apply-key-step2-pinned-message.webp)

## 第三步：等待我们发放 Key

问卷提交后，我们会尽快审核，并把 Seedance 2.0 体验 Key 发给你。

## 第四步：配置 IM 渠道，并把压缩包和 Key 发给 nexu

收到 Key 后，先配置一个可用的 IM 渠道，再把压缩包和 Key 一起发给自己的 `nexu`。

选一个你常用的渠道，按页面提示配置完成就可以。详细步骤可以参考 [渠道配置](/zh/guide/channels)。

Windows 版本在使用 Seedance 2.0 之前，还需要先把下面这个压缩包发送给你自己的 `nexu`：

[下载 libtv-video.zip](/assets/seedance/libtv-video.zip)

在已经配置好的 IM 对话里，先把这个压缩包作为文件发给 `nexu`，再把体验 Key 发过去：

> 这是 nexu 官方给我的 LibTV Skill Access Key：`<your-key>`

这里的 Key 可以是官方发放的体验 Key，也可以是你自己的 Libtv Access Key。

![将 Libtv skill key 发送给 nexu](/assets/seedance/libtv-skill-key.webp)

这两样都发完之后，Windows 版 `nexu` 就可以开始使用 Seedance 2.0 生成视频了。

## 第五步：开始生成视频

完成压缩包发送和 Key 激活后，就可以直接给 `nexu` 发视频生成指令了。

如果你想直接照着试，可以继续参考主教程里的提示词和效果示例：

- [Seedance 2.0 视频生成](/zh/guide/seedance)

视频生成通常要等大约 15 分钟。如果超过 15 分钟还没收到结果，可以回到对话里追问一下 `nexu` 当前的生成进度。

![Seedance 2.0 视频生成任务](/assets/seedance/generate-video-anime-prompt.webp)

## 官方视频生成样例展示

下面放了两个字节官方的 Seedance 2.0 样例视频，你可以先感受一下大概效果。

**样例 1：赛博朋克动作风格**

<video controls preload="metadata" style="width: 100%; border-radius: 12px;">
  <source src="/assets/seedance/seedance-official-cyberpunk-assassin.mp4" type="video/mp4" />
  你的浏览器暂不支持视频播放，请直接打开 /assets/seedance/seedance-official-cyberpunk-assassin.mp4 查看。
</video>

**样例 2：香水广告片风格**

<video controls preload="metadata" style="display: block; width: 100%; max-width: 420px; margin: 0 auto; border-radius: 12px;">
  <source src="/assets/seedance/seedance-official-perfume-ad.mp4" type="video/mp4" />
  你的浏览器暂不支持视频播放，请直接打开 /assets/seedance/seedance-official-perfume-ad.mp4 查看。
</video>

## 常见问题

**Q: 为什么 Windows 版还要额外发送一个压缩包？**

这是 Windows 版本当前接入 Seedance 2.0 的额外准备步骤。先把压缩包发给自己的 `nexu`，后面的生成能力才能正常使用。

**Q: 压缩包应该发送到哪里？**

发到你已经配置好的 IM 渠道里，也就是你和自己 `nexu` 的聊天窗口。

**Q: 发送完压缩包之后，还需要做什么？**

还需要继续把体验 Key 发给 `nexu`，然后就可以开始生成视频了。

**Q: 官方发放的体验 Key 可以使用多久？为什么返回的画布链接打不开？**

`nexu` 是通过 `Libtv skill` 接入 Seedance 2.0 的。完成 GitHub Star 后，官方通常会提供 2 次体验额度。使用官方额度时，返回的画布链接会指向 `nexu` 官方账号的 Libtv 画布，你没有访问权限，直接忽略就可以，不影响生成。

**Q: 如何获取自己的 Libtv Access Key，并在画布中查看生成结果？**

去 [LibTV 官网](https://www.liblib.tv/) 登录账号后，一般可以在右上角头像附近找到自己的 Access Key。把这个 Key 发给 `nexu` 之后，后面再收到画布链接时，就可以在自己的 Libtv 画布里查看生成结果了。

**Q: 使用 `libtv-video` skill 时报错 `Cannot connect to gateway: timed out`，怎么办？**

这通常是由于网络环境或代理问题导致的，并非配置错误。请将网关地址更新为 `https://seedance.nexu.io/`，更新后重试即可恢复正常。

你可以直接复制以下指令发送给 `nexu`，它会自动帮你完成网关地址的更新：

> 请把 libtv-video skill 的网关地址更新为 https://seedance.nexu.io/
