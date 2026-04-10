# Windows 正式版安装指南

## 适用范围

- **曾安装过 Windows 内测版的用户**：在安装正式版之前，需要先按本文档关闭「智能应用控制」。
- **首次安装 Nexu Windows 版的用户**：无需进行以下操作，可直接下载安装。

## 背景说明

Nexu Windows 正式版的代码签名证书正在申请中，预计两周后到位。在此之前，Windows 系统的「智能应用控制」功能会将未经签名的安装包识别为不可信并阻止安装。

如果你使用过内测版，该功能可能已处于评估模式，需要手动将其关闭后再安装正式版。

## 操作步骤

### 第一步：打开开始菜单

点击任务栏左下角的 **Windows 开始菜单**。

![点击开始菜单](/assets/windows-install/step1-start-menu.webp)

### 第二步：打开设置

在开始菜单中，点击「**设置**」。

![打开设置](/assets/windows-install/step2-settings.webp)

### 第三步：进入隐私和安全性

在设置左侧导航栏中，点击「**隐私和安全性**」，然后点击右侧的「**Windows 安全中心**」。

![隐私和安全性](/assets/windows-install/step3-privacy.webp)

### 第四步：打开应用和浏览器控制

在 Windows 安全中心页面，点击「**应用和浏览器控制**」。

![应用和浏览器控制](/assets/windows-install/step4-security-center.webp)

### 第五步：进入智能应用控制

点击「**智能应用控制设置**」。

![智能应用控制设置](/assets/windows-install/step5-app-control.webp)

### 第六步：关闭智能应用控制

将选项切换为「**关闭**」。

![关闭智能应用控制](/assets/windows-install/step6-smart-app-control.webp)

完成以上操作后，前往 [nexu.io](https://nexu.io) 下载 Windows 正式版安装包并安装。

> **提示：** Windows 版本首次启动时，Agent 可能需要约 2 到 5 分钟完成初始化后才能正常使用。

> **说明：** 待官方签名证书正式下发后，Nexu 安装包将通过 Windows 系统验证，届时无需关闭此设置即可正常安装。
