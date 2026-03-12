# QClaw 逆向分析报告

日期：2026-03-11

## 1. 执行摘要

- `QClaw` 是一个由腾讯签名的 Electron 桌面应用，包标识为 `com.tencent.qclaw`。
- 它的核心运行时不是 `zeroclaw`，而是明确打包了官方 `openclaw/openclaw` 项目的 `openclaw`。
- 内置的 OpenClaw 版本为 `2026.2.24`。
- 从证据看，QClaw 不是对 OpenClaw 做了深度源码 fork 的形态，更像是以下模型：
  - 官方 `openclaw` npm 发布包内容
  - 加上生产运行时依赖
  - 减去一部分文件和大型可选/运行时依赖
  - 再加上腾讯自有的 Electron 壳、配置、wrapper、登录、上报和生命周期管理
- 因此，QClaw 的主要风险不是“硬 fork 导致后续无法升级”，而是“定制发行版带来的集成耦合风险”。

## 2. 分析范围与方法

本次分析对象：

- DMG 安装包：`QClaw-latest-arm64.dmg`
- 挂载 DMG 后的应用内容：`QClaw.app`
- 提取出的 Electron 相关产物目录：`qclaw-dmg-analysis`
- 本地 OpenClaw 源码目录：`/Users/william/projects/openclaw`
- 为对照创建的干净 npm 安装目录：
  - `qclaw-dmg-analysis/npm-openclaw-2026.2.24`
  - `qclaw-dmg-analysis/npm-openclaw-2026.3.7`

使用的方法：

- 挂载 DMG 并检查目录结构
- 分析 Electron `app.asar`
- 对比包元数据
- 使用 `du` 进行体积测量
- 对 QClaw 内置 `openclaw@2026.2.24` 与干净 npm 安装的 `openclaw@2026.2.24` 进行文件级 SHA-256 hash 对比

## 3. 整体架构

### 3.1 高层结构

QClaw 可分为三层：

1. Electron 桌面宿主层
2. 内置 OpenClaw 运行时层
3. QClaw 自身围绕 OpenClaw 的集成层

### 3.2 Electron 宿主层

证据：

- `QClaw.app/Contents/Info.plist`
- `QClaw.app/Contents/Frameworks`
- `QClaw.app/Contents/Resources/app.asar`

观察结果：

- `CFBundleIdentifier`：`com.tencent.qclaw`
- `CFBundleShortVersionString`：`0.1.3`
- 应用由腾讯 Developer ID 签名
- 应用已公证并附带 notarization ticket
- `Info.plist` 中存在 `ElectronAsarIntegrity`

这说明它是一个标准的 Electron 打包应用。

### 3.3 前端层

证据：

- `qclaw-dmg-analysis/app-renderer-index.html`
- `qclaw-dmg-analysis/index-Dl1oKHN0.js`

观察结果：

- 渲染层由 Vite 构建
- 使用了 Vue 生态相关 bundle

### 3.4 OpenClaw 运行时层

证据：

- `QClaw.app/Contents/Resources/openclaw/node_modules/openclaw/package.json`
- `qclaw-dmg-analysis/app-main-index.js`

观察结果：

- QClaw 会拉起内置的 `openclaw.mjs`
- QClaw 负责管理 OpenClaw 的生命周期、日志、健康检查和重启
- OpenClaw 状态目录同时涉及 `.qclaw` 与 `.openclaw`

### 3.5 QClaw 自定义集成层

证据：

- `QClaw.app/Contents/Resources/openclaw/config/openclaw.json`
- `QClaw.app/Contents/Resources/openclaw/config/skills/qclaw-openclaw/SKILL.md`
- `QClaw.app/Contents/Resources/scripts/pack-qclaw.cjs`
- `qclaw-dmg-analysis/app-main-index.js`

观察结果：

- 默认 provider 为 `qclaw`
- 默认模型为 `qclaw/modelroute`
- 腾讯相关 endpoint 和 WeChat 相关设置是由外围应用注入的
- OpenClaw 在这里是一个被宿主应用管理的子运行时，而不是整个应用本身
- 存在专用的 wrapper skill，用来阻止用户直接调用 `openclaw` CLI，并将操作路由到 QClaw 管理的脚本

## 4. OpenClaw 来源与版本

### 4.1 打包的是哪个项目？

QClaw 内置的包明确是官方 OpenClaw npm 包。

证据来自 `QClaw.app/Contents/Resources/openclaw/node_modules/openclaw/package.json`：

- `name`：`openclaw`
- `version`：`2026.2.24`
- `repository.url`：`git+https://github.com/openclaw/openclaw.git`

### 4.2 是否打包了 `zeroclaw`？

没有发现 `zeroclaw` 的证据。

### 4.3 内置 OpenClaw 版本

- QClaw 内置的是 `openclaw@2026.2.24`

## 5. 体积清单

以下体积均为本次分析环境中的实测值。

### 5.1 QClaw DMG 与安装后应用体积

| 对象 | 大小 KB | 约 MiB |
|---|---:|---:|
| `QClaw-latest-arm64.dmg` | 162,164 KB | 158.4 MiB |
| `QClaw-latest-arm64.dmg` 精确字节数 | 166,053,194 bytes | 158.4 MiB |
| `QClaw.app` | 503,512 KB | 491.7 MiB |
| `Resources/app.asar` | 8,064 KB | 7.9 MiB |
| `Resources/openclaw` | 270,784 KB | 264.4 MiB |
| `Resources/openclaw/config` | 9,844 KB | 9.6 MiB |
| `Resources/openclaw/node_modules` | 260,644 KB | 254.5 MiB |
| `Resources/openclaw/node_modules/openclaw` | 93,048 KB | 90.9 MiB |

### 5.2 本地 OpenClaw 源码目录体积

目录：`/Users/william/projects/openclaw`

| 对象 | 大小 KB | 约 MiB |
|---|---:|---:|
| 源码目录总计 | 1,041,852 KB | 1,017.4 MiB |
| `node_modules` | 544,496 KB | 531.7 MiB |
| `dist` | 79,888 KB | 78.0 MiB |
| `extensions` | 17,148 KB | 16.7 MiB |
| `skills` | 460 KB | 0.4 MiB |
| `docs` | 15,412 KB | 15.1 MiB |

说明：

- 这是开发工作区视角，不应直接与最终产品运行时体积类比。

### 5.3 干净 npm 安装：`openclaw@2026.2.24`

目录：`qclaw-dmg-analysis/npm-openclaw-2026.2.24`

| 对象 | 大小 KB | 约 MiB |
|---|---:|---:|
| `node_modules` 总计 | 641,704 KB | 626.7 MiB |
| `node_modules/openclaw` | 98,428 KB | 96.1 MiB |
| `node_modules/openclaw/dist` | 44,944 KB | 43.9 MiB |
| `node_modules/openclaw/extensions` | 31,852 KB | 31.1 MiB |
| `node_modules/openclaw/docs` | 15,900 KB | 15.5 MiB |

### 5.4 干净 npm 安装：`openclaw@2026.3.7`

目录：`qclaw-dmg-analysis/npm-openclaw-2026.3.7`

| 对象 | 大小 KB | 约 MiB |
|---|---:|---:|
| `node_modules` 总计 | 682,932 KB | 666.9 MiB |
| `node_modules/openclaw` | 170,724 KB | 166.7 MiB |
| `node_modules/openclaw/dist` | 92,640 KB | 90.5 MiB |
| `node_modules/openclaw/extensions` | 56,988 KB | 55.7 MiB |
| `node_modules/openclaw/docs` | 15,412 KB | 15.1 MiB |

## 6. 版本间对比：本地 `2026.2.24` vs 本地 `2026.3.7`

### 6.1 主要体积差异

| 指标 | `2026.2.24` | `2026.3.7` | 差值 |
|---|---:|---:|---:|
| npm 安装总大小 | 626.7 MiB | 666.9 MiB | +40.2 MiB |
| `openclaw` 包本体 | 96.1 MiB | 166.7 MiB | +70.6 MiB |
| `openclaw/dist` | 43.9 MiB | 90.5 MiB | +46.6 MiB |
| `openclaw/extensions` | 31.1 MiB | 55.7 MiB | +24.6 MiB |

### 6.2 元数据差异

| 指标 | `2026.2.24` | `2026.3.7` |
|---|---:|---:|
| dependencies 数量 | 54 | 53 |
| exports 数量 | 4 | 46 |
| peerDependencies | `@napi-rs/canvas`, `node-llama-cpp` | 相同 |
| optionalDependencies | `@discordjs/opus` | 无 |

依赖集合差异：

- 仅在 `2026.2.24` 中存在：
  - `@larksuiteoapi/node-sdk`
  - `@snazzah/davey`
- 仅在 `2026.3.7` 中存在：
  - `strip-ansi`

解释：

- `2026.3.7` 变大，主要不是因为依赖数量暴增。
- 主要原因是包内容本身变大，尤其是 `dist/` 和 `extensions/`。

## 7. 同版本对比：本地 npm `2026.2.24` vs QClaw 内置 `2026.2.24`

这是最关键的对比，因为它排除了版本漂移因素。

### 7.1 顶层体积对比

| 指标 | 本地 npm `2026.2.24` | QClaw 内置 `2026.2.24` | 差值 |
|---|---:|---:|---:|
| 运行时依赖树 `node_modules` | 626.7 MiB | 254.5 MiB | -372.2 MiB |
| `openclaw` 包本体 | 96.1 MiB | 90.9 MiB | -5.2 MiB |

解释：

- `openclaw` 包本体大小几乎相同。
- 巨大的体积差异主要来自包外依赖树，而不是 OpenClaw 核心包本身。

### 7.2 本地 npm 安装里存在、但 QClaw 中缺失的大型顶层包

以下顶层包存在于本地 npm `2026.2.24` 中，但不存在于 QClaw 打包的运行时中：

| 包名 | 大小 KB | 约 MiB |
|---|---:|---:|
| `koffi` | 88,360 | 86.3 MiB |
| `pdfjs-dist` | 41,016 | 40.1 MiB |
| `node-llama-cpp` | 33,584 | 32.8 MiB |
| `@napi-rs` | 26,124 | 25.5 MiB |
| `@img` | 16,352 | 16.0 MiB |
| `@octokit` | 11,776 | 11.5 MiB |
| `@cloudflare` | 9,376 | 9.2 MiB |
| `@node-llama-cpp` | 5,044 | 4.9 MiB |
| `bun-types` | 3,428 | 3.3 MiB |
| `hono` | 2,804 | 2.7 MiB |
| `simple-git` | 1,332 | 1.3 MiB |
| `ipull` | 1,244 | 1.2 MiB |
| `sleep-promise` | 464 | 0.5 MiB |
| `@reflink` | 432 | 0.4 MiB |
| `@huggingface` | 408 | 0.4 MiB |
| `lifecycle-utils` | 348 | 0.3 MiB |
| `cmake-js` | 224 | 0.2 MiB |
| `restore-cursor` | 184 | 0.2 MiB |
| `fast-xml-builder` | 176 | 0.2 MiB |
| `fs-extra` | 148 | 0.1 MiB |
| `ora` | 148 | 0.1 MiB |
| `env-var` | 144 | 0.1 MiB |
| `stdout-update` | 132 | 0.1 MiB |
| `node-api-headers` | 128 | 0.1 MiB |
| `lowdb` | 124 | 0.1 MiB |
| `minimist` | 120 | 0.1 MiB |
| `path-expression-matcher` | 120 | 0.1 MiB |
| `octokit` | 88 | 0.1 MiB |
| `@kwsites` | 84 | 0.1 MiB |
| `json-with-bigint` | 84 | 0.1 MiB |
| `fast-content-type-parse` | 80 | 0.1 MiB |
| `universal-github-app-jwt` | 80 | 0.1 MiB |
| `toad-cache` | 64 | 0.1 MiB |
| `before-after-hook` | 52 | 0.1 MiB |
| `rc` | 52 | 0.1 MiB |
| `cli-spinners` | 48 | 0.0 MiB |
| `universal-user-agent` | 48 | 0.0 MiB |
| `ci-info` | 44 | 0.0 MiB |
| `nanoid` | 44 | 0.0 MiB |
| `url-join` | 40 | 0.0 MiB |
| `@tinyhttp` | 36 | 0.0 MiB |
| `filenamify` | 36 | 0.0 MiB |
| `ansi-escapes` | 32 | 0.0 MiB |
| `chmodrp` | 32 | 0.0 MiB |
| `log-symbols` | 32 | 0.0 MiB |
| `deep-extend` | 28 | 0.0 MiB |
| `memory-stream` | 28 | 0.0 MiB |
| `jsonfile` | 24 | 0.0 MiB |
| `lodash.debounce` | 24 | 0.0 MiB |
| `pretty-ms` | 24 | 0.0 MiB |
| `cli-cursor` | 20 | 0.0 MiB |
| `ini` | 20 | 0.0 MiB |
| `is-interactive` | 20 | 0.0 MiB |
| `is-unicode-supported` | 20 | 0.0 MiB |
| `mimic-function` | 20 | 0.0 MiB |
| `onetime` | 20 | 0.0 MiB |
| `parse-ms` | 20 | 0.0 MiB |
| `pretty-bytes` | 20 | 0.0 MiB |
| `slice-ansi` | 20 | 0.0 MiB |
| `stdin-discarder` | 20 | 0.0 MiB |
| `steno` | 20 | 0.0 MiB |
| `async-retry` | 16 | 0.0 MiB |
| `filename-reserved-regex` | 16 | 0.0 MiB |
| `strip-json-comments` | 16 | 0.0 MiB |
| `universalify` | 16 | 0.0 MiB |
| `validate-npm-package-name` | 16 | 0.0 MiB |
| `.bin` | 0 | 0.0 MiB |

### 7.3 QClaw 中存在、但本地 npm 安装中没有的顶层包

QClaw bundle 中仅多出两个顶层包：

| 包名 | 大小 KB | 约 MiB |
|---|---:|---:|
| `prism-media` | 64 | 0.1 MiB |
| `picocolors` | 12 | 0.0 MiB |

这说明 QClaw 的差异总体是“删减型”的，而不是“新增型”的。

## 8. 为什么 QClaw 内置的 OpenClaw 更小

### 8.1 它不是整个 Git 仓库

本地源码目录中包含很多不会进入 npm 包，也不会进入 App 运行时的目录，例如：

- `src`
- `scripts`
- `test`
- `apps`
- `ui`
- `packages`
- `.git`
- CI、lint、TypeScript、Docker、workspace 配置等文件

### 8.2 npm 发布包本身就已经是裁剪后的产物

`openclaw/package.json` 通过 `files` 只发布以下路径：

- `CHANGELOG.md`
- `LICENSE`
- `openclaw.mjs`
- `README*`
- `assets/`
- `dist/`
- `docs/`
- `extensions/`
- `skills/`

### 8.3 QClaw 在安装后的运行时基础上继续做了裁剪

本地 npm `2026.2.24` 与 QClaw 内置 `2026.2.24` 的巨大体积差异，主要由以下因素解释：

- 去掉了大型可选/native 组件
- 去掉了一些 extension 级别的辅助二进制入口和类似 symlink 的条目
- 去掉了一些在干净 npm 安装中存在、但在桌面版运行时中并不需要的依赖子树

仅最大的几个缺失包，就已经解释了大部分体积节省：

- `koffi`：86.3 MiB
- `pdfjs-dist`：40.1 MiB
- `node-llama-cpp`：32.8 MiB
- `@napi-rs`：25.5 MiB

这四项合计约 184.7 MiB。

## 9. 具体裁剪了什么

### 9.1 `openclaw` 包内部的文件级对比

对比目录：

- 本地：`qclaw-dmg-analysis/npm-openclaw-2026.2.24/node_modules/openclaw`
- QClaw 内置：`QClaw.app/Contents/Resources/openclaw/node_modules/openclaw`

Hash 对比结果：

- 本地文件数：8,260
- QClaw 内置文件数：7,909
- 公共文件数：7,909
- 公共文件中 hash 不同的文件数：0
- 仅本地存在的文件数：351
- 仅 QClaw 存在的文件数：0

这意味着：

- QClaw 内置 `openclaw` 包中保留下来的每一个文件，都与官方 npm 安装的 `openclaw@2026.2.24` 逐字节一致
- 差异来自“删除 / 取子集”，而不是“修改内容”

### 9.2 `openclaw` 包内部缺失文件的主要模式

主要缺失文件组：

- `node_modules/tar/dist/*`：246 个文件
- `node_modules/minizlib/dist/*`：18 个文件
- `node_modules/chownr/dist/*`：10 个文件
- `node_modules/yallist/dist/*`：10 个文件
- `node_modules/commander/lib/*`：6 个文件
- 多个 `extensions/*/node_modules/.bin/*` 条目

代表性缺失文件：

- `extensions/bluebubbles/node_modules/.bin/.ignored_openclaw`
- `extensions/diagnostics-otel/node_modules/.bin/acorn`
- `extensions/matrix/node_modules/.bin/markdown-it`
- `extensions/memory-lancedb/node_modules/.bin/arrow2csv`
- `extensions/memory-lancedb/node_modules/.bin/openai`
- `extensions/nostr/node_modules/.bin/tsc`
- `extensions/nostr/node_modules/.bin/tsserver`
- `node_modules/chownr/dist/commonjs/index.js`
- `node_modules/commander/index.js`
- `node_modules/minizlib/dist/commonjs/index.js`
- `node_modules/tar/dist/commonjs/index.js`

解释：

- 一部分被裁剪的目标，明显属于 extension 的 helper bin 和工具入口
- 另一部分被裁剪的目标，是某些依赖包的子树，这些内容在桌面发行版运行时中未必需要，或在 QClaw 当前选定的运行模式下不可达

## 10. 关于可选功能与被删除的大型依赖的证据

在本地 npm 安装的 `openclaw@2026.2.24` 构建产物中，代码仍然保留了对以下可选依赖的动态导入路径和面向用户的提示文案：

- `node-llama-cpp`
- `@napi-rs/canvas`
- `pdfjs-dist`

在 `node_modules/openclaw/dist/*.js` 中可观察到的例子：

- 动态导入 `node-llama-cpp`
- 动态导入 `@napi-rs/canvas`
- 动态导入 `pdfjs-dist/legacy/build/pdf.mjs`
- 缺失这些可选依赖时的报错说明

解释：

- QClaw 很可能依赖了 OpenClaw 自身就支持的“可选依赖缺失 / 降级”路径
- 它看起来并没有从 OpenClaw 编译产物中删除这些代码路径
- 它做的是不把对应的大型依赖一起打进最终运行时

## 11. QClaw 很可能是如何裁剪 OpenClaw 的

基于安装包证据，最可能的过程如下：

1. 获取官方 `openclaw@2026.2.24` npm 包。
2. 安装运行时依赖，形成一棵可运行的 `node_modules` 树。
3. 在构建最终 App 镜像之前，删除选定的包和文件。
4. 将裁剪后的运行时嵌入到 `QClaw.app/Contents/Resources/openclaw`。
5. 在 OpenClaw 包之外，再加入腾讯 / QClaw 自身的 Electron 逻辑、配置、wrapper 和脚本。

从实现层面看，这种裁剪很可能发生在以下某一层：

- 安装完成后的 `node_modules` 二次裁剪
- 按 allowlist 复制最终需要的文件进入 App bundle
- 在打包阶段通过规则排除特定包或依赖子树

而当前证据**不支持**以下做法：

- 对 `openclaw/dist/*.js` 打补丁
- 改写 `openclaw/package.json`
- 基于修改后的 OpenClaw 源码重新编译并嵌入

## 12. 反对“深度源码 fork”判断的证据

这一部分是整个分析中最强的证据链。

### 12.1 包来源仍然指向上游

`QClaw.app/Contents/Resources/openclaw/node_modules/openclaw/package.json` 中仍声明：

- `name: openclaw`
- `version: 2026.2.24`
- `repository.url: git+https://github.com/openclaw/openclaw.git`

### 12.2 OpenClaw 运行时包内部几乎没有 QClaw 专属标记

在内置 `openclaw` 包内部搜索 `qclaw`、`tencent`、`guanjia`、`wechat`、`modelroute` 等关键词，几乎没有在运行时代码中命中 QClaw 专属逻辑，只在文档中出现了少量提及。

### 12.3 文件重叠部分的 hash 全部一致

以下关键文件在 QClaw 内置版与干净 npm 安装版之间的 SHA-256 完全一致：

| 文件 | SHA-256 |
|---|---|
| `package.json` | `d3bd6e8eff213660e3aab218034e428e970478a4e79c79c6b64793feb253b09f` |
| `openclaw.mjs` | `1703fc399886987942476241aee9a386f12e52aba88563365ae3f74acfce6955` |
| `dist/index.js` | `dc9ceb06b684acb5622dc7870975a042bb25a474b2c50aa3d62b303bbb8d05ac` |
| `dist/daemon-cli.js` | `629560b908963ab4ede0a23908b51b4d6b04a91e784f255e0b00fea70d7dd224` |
| `README.md` | `f90a1c39dbc4ba9b77b6f0e774748ee82bce4569c4b1cb76da077c1e458d7444` |
| `CHANGELOG.md` | `5f88cdc60b6654862d4dffb5ee9293f343b902f5314557d05273ff63f99607ef` |

不仅是这些样本文件，完整公共文件对比结果也是：

- 7,909 个公共文件中，hash 不同的数量为 0

这几乎可以视为非常强的证据，表明 QClaw 没有修改它保留下来的 OpenClaw 包文件。

## 13. 可升级性评估

### 13.1 它不是什么

当前证据**不支持**将 QClaw 定义为“长期维护的 OpenClaw 源码 fork，且编译产物被大规模改写”的产品。

### 13.2 它更像什么

当前证据强烈支持以下模型：

- 以官方 OpenClaw 包作为基础运行时
- 对文件和依赖做选择性裁剪
- 在包外叠加 QClaw 自身的桌面宿主与集成逻辑

### 13.3 升级风险画像

升级风险确实存在，但主要是集成风险，而不是源码 fork 风险。

未来升级 OpenClaw 时最可能出现摩擦的点：

- CLI 行为变化
- 配置 schema 变化
- 运行时路径 / 状态布局变化
- 健康检查和启动语义变化
- plugin / skill 兼容性变化
- 某些当前是可选依赖的能力在未来变得更重要，或加载方式发生变化

更准确的结论是：

- 源码 fork 风险：低到中
- 集成耦合风险：高

## 14. 最终判断

仅依据安装包证据，最合理的技术判断是：

- QClaw 是一个以官方 `openclaw@2026.2.24` 为底座的腾讯品牌 Electron 桌面发行版。
- 它看起来没有直接修改 OpenClaw 包文件内容。
- 它的体积缩减主要来自对已安装运行时依赖和部分包内文件的裁剪。
- 因此，QClaw 不是那种天然无法跟随上游的深度 OpenClaw fork。
- 更准确的描述是：一个在打包阶段做 pruning，并在外围叠加强耦合集成层的定制发行版。

## 15. 关键证据路径

- `QClaw-latest-arm64.dmg`
- `QClaw.app/Contents/Info.plist`
- `QClaw.app/Contents/Resources/app.asar`
- `QClaw.app/Contents/Resources/openclaw/node_modules/openclaw/package.json`
- `QClaw.app/Contents/Resources/openclaw/config/openclaw.json`
- `QClaw.app/Contents/Resources/openclaw/config/skills/qclaw-openclaw/SKILL.md`
- `QClaw.app/Contents/Resources/scripts/pack-qclaw.cjs`
- `qclaw-dmg-analysis/app-main-index.js`
- `qclaw-dmg-analysis/npm-openclaw-2026.2.24/node_modules/openclaw/package.json`
- `qclaw-dmg-analysis/npm-openclaw-2026.3.7/node_modules/openclaw/package.json`
