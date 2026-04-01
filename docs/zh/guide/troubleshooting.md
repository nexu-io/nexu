# 修复指南

## 问题一：Nexu 无法启动 / 与 OpenClaw 冲突

**症状：** Nexu 打开后无响应、闪退，或提示端口被占用

**根本原因：** OpenClaw 后台网关服务（`ai.openclaw.gateway`）持续占用相关端口，导致 Nexu 无法正常启动。

**修复步骤：**

1. 打开终端（`Command + 空格` 搜索「终端」），逐行执行以下命令：

```bash
launchctl bootout gui/$(id -u)/ai.openclaw.gateway
rm ~/Library/LaunchAgents/ai.openclaw.gateway.plist
```

> 第一条：立即停止 OpenClaw 网关后台服务；第二条：删除开机自启配置，防止重启后再次冲突

2. 执行完成后，重新打开 Nexu 确认是否恢复正常。

---

## 问题二：安装或更新时提示「Nexu.app 正在使用中」

**症状：** 弹窗提示「无法完成此操作，因为项目 "Nexu.app" 正在使用中。」

![Nexu.app 正在使用中](/assets/nexu-app-in-use.webp)

**根本原因：** Nexu 的后台进程仍在运行，导致无法覆盖安装新版本。

**修复步骤：**

1. 打开终端（`Command + 空格` 搜索「终端」），执行以下命令一键终止所有 Nexu 相关进程：

```bash
curl -fsSL https://desktop-releases.nexu.io/scripts/kill-all.sh | bash
```

2. 执行完成后，重新安装或拖入新版本的 Nexu.app 即可。

---

## 联系支持

如问题仍未解决，请通过以下方式联系我们：

- **Github Issue：** [https://github.com/nexu-io/nexu/issues](https://github.com/nexu-io/nexu/issues)
- **社群：** [https://docs.nexu.io/zh/guide/contact](/zh/guide/contact)
