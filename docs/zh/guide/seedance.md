# Seedance 2.0 视频生成

想试试 Seedance 2.0？跟着下面的步骤走一遍，配置完成后就可以直接在 `nexu` 里生成视频了。

> 当前这篇主教程主要面向 Mac 用户。
>
> 如果你使用的是 Windows，请优先查看 [Seedance 2.0 视频生成（Windows 版）](/zh/guide/seedance-windows)。

## 准备工作

开始之前，先确认这几项已经准备好：

- 已安装 nexu 最新版本客户端（0.10.0）
- 可以正常登录 nexu 账号
- 已准备一个可用的 IM 渠道，用于和 `nexu` 对话

如果你还没有安装客户端，可以先去 [nexu 官网](https://nexu.io/) 或 [GitHub 仓库](https://github.com/nexu-io/nexu) 看看，再从 [下载页面](https://nexu.io/download) 安装最新版。

## 第一步：申请 Seedance 2.0 体验 Key

打开客户端首页，找到 **Seedance 2.0** 的活动入口，按提示完成申请即可。

![首页 Seedance 2.0 活动 Banner](/assets/seedance/home-banner.webp)

整个申请流程一共 3 步：

1. 在 GitHub 为 `nexu` 点 Star
2. 进群后查看置顶消息，打开问卷链接并填写信息
3. 等待审核和发放 Key，一般会在 2 小时内完成

![申请体验 Key：前往 GitHub Star](/assets/seedance/apply-key-step1-star.webp)

点完 Star 后，记得顺手截一张图，后面填问卷时要用到。

**截图要求**：截图里需要清楚看到 **仓库名称**、**已经点亮的 Star 状态**，以及 **当前登录的 GitHub 账号**。这三项都会影响审核，尽量一次截全。下方是符合要求的示例：

![通过审核的 GitHub Star 截图示例](/assets/seedance/github-star-review-example.webp)

审核通过后，体验 Key 会发到你填写的邮箱里。

完成 Star 后，再按页面提示进群。

![申请体验 Key：点击按钮加入群聊](/assets/seedance/apply-key-step2-join-group.webp)

进群后看一下置顶消息，打开问卷链接把信息填好就行。

![申请体验 Key：进群后查看置顶消息获取问卷链接](/assets/seedance/apply-key-step2-pinned-message.webp)

## 第二步：先配置一个 IM 渠道

建议先把 IM 渠道配好。这样收到 Key 后，就可以直接发给 `nexu`，不用再来回切换操作。

选一个你平时最常用的渠道，按页面提示配置完成即可。详细步骤可以看 [渠道配置](/zh/guide/channels)。

![先配置一个 IM 渠道并进入聊天](/assets/seedance/im-channel-config.webp)

## 第三步：将 Key 发送给 `nexu`

`nexu` 目前是通过 `Libtv skill` 接入 Seedance 2.0 的。拿到 Key 以后，在已经配置好的 IM 对话里直接发给 `nexu` 就可以：

> 这是 nexu 官方给我的 LibTV Skill Access Key：`<your-key>`

这里的 Key 可以是官方发放的体验 Key，也可以是你自己的 Libtv Access Key。

![将 Libtv skill key 发送给 nexu](/assets/seedance/libtv-skill-key.webp)

收到邮件后，把 Seedance 2.0 体验 Key 复制出来，发到刚刚配置好的 IM 对话窗口里。

发出去之后，激活成功就可以开始生成视频了。

## 第四步：生成第一个视频

激活完成后，直接给 `nexu` 发视频生成指令就行。

如果你想先快速试一条，可以直接用下面这段提示词：

> **使用 Libtv skill 中的 Seedance 2.0 模型**，生成一支极致惊艳的青春动漫短片：盛夏傍晚，天空呈现梦幻的橙粉与蔚蓝渐变，微风吹动少年少女的校服衣角与发丝，他们并肩奔跑在洒满金色夕阳的校园天台与海边街道之间，画面充满青春悸动、自由感与怦然心动的气息。镜头从近景眼神特写开始，捕捉清澈发亮的瞳孔、微红的脸颊与呼吸起伏，随后切换到流畅的跟拍、环绕运镜、慢动作奔跑、抬头仰拍天空与飞鸟，画面中有飘动的花瓣、阳光粒子、镜头光晕、风吹树影、城市霓虹与夏日祭典灯光。整体为高质量日系动漫电影风格，线条干净细腻，色彩通透饱和，光影梦幻，人物动作自然，情绪真挚，充满青春、浪漫、热烈与希望。电影级构图，超高细节，强烈氛围感，流畅动画，唯美转场，视觉震撼，极具感染力。

![Seedance 2.0 视频生成任务](/assets/seedance/generate-video-anime-prompt.webp)

视频生成通常要等大约 15 分钟。如果超过 15 分钟还没收到结果，可以回到对话里追问一下 `nexu` 当前的生成进度。

如果你用的是官方提供的 2 次体验额度，生成过程中可能会返回一个画布链接。这个链接指向的是 `nexu` 官方账号的 Libtv 画布，你没有权限打开，直接忽略就好，不影响正常体验。

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

**Q: 提交问卷后，大概多久能收到 Key？**

通常在 2 小时内。审核通过后，Key 会发到你在问卷里填写的邮箱。

**Q: 必须先配置 IM 吗？**

建议先配好。因为 Key 需要发给 `nexu` 才能用，提前准备好会顺很多。

**Q: 官方发放的体验 Key 可以使用多久？为什么返回的画布链接打不开？**

`nexu` 是通过 `Libtv skill` 接入 Seedance 2.0 的。完成 GitHub Star 后，官方通常会提供 2 次体验额度。使用官方额度时，返回的画布链接会指向 `nexu` 官方账号的 Libtv 画布，你没有访问权限，直接忽略就可以，不影响生成。

**Q: 如何获取自己的 Libtv Access Key，并在画布中查看生成结果？**

去 [LibTV 官网](https://www.liblib.tv/) 登录账号后，一般可以在右上角头像附近找到自己的 Access Key。把这个 Key 发给 `nexu` 之后，后面再收到画布链接时，就可以在自己的 Libtv 画布里查看生成结果了。

## 进群答疑

如果你还有问题，或者想拿到最新支持：

[![联系我们](/assets/seedance/contact-us.webp)](/zh/guide/contact)
