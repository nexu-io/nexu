# Nexu Desktop 版本更新系统设计文档

> 日期: 2026-03-13
> 状态: Draft

## 目录

1. [概述](#1-概述)
2. [架构总览](#2-架构总览)
3. [版本策略](#3-版本策略)
4. [基础设施: Cloudflare R2 + Worker](#4-基础设施-cloudflare-r2--worker)
5. [CI/CD 自动化发布流水线](#5-cicd-自动化发布流水线)
6. [客户端更新机制](#6-客户端更新机制)
7. [组件级独立更新](#7-组件级独立更新)
8. [安全: 代码签名与公证](#8-安全-代码签名与公证)
9. [回滚机制](#9-回滚机制)
10. [数据迁移与安全关闭](#10-数据迁移与安全关闭)
11. [强制更新与离线处理](#11-强制更新与离线处理)
12. [监控与 Changelog](#12-监控与-changelog)
13. [分阶段实施计划](#13-分阶段实施计划)
14. [关键技术决策总结](#14-关键技术决策总结)

---

## 1. 概述

### 1.1 背景

Nexu Desktop 是一个 Electron 37 桌面客户端，采用 sidecar 架构，内嵌多个后端服务作为子进程运行：

| 组件 | 运行方式 | 说明 |
|------|---------|------|
| Electron Shell | 主进程 | 窗口管理、IPC、进程编排 |
| Web Surface | utility-process | 前端 UI |
| API Server | utility-process | 本地 API 服务 |
| Gateway | utility-process | 网关，管理 OpenClaw |
| OpenClaw | delegated (由 Gateway 启动) | AI 运行时，npm 包 `openclaw` |
| PGlite | spawn | 本地 PostgreSQL |
| Session Chat | utility-process | 会话聊天服务 |
| Session Chat DB | utility-process | 聊天数据库 |

### 1.2 设计目标

1. **全量更新**: 应用整包更新，保证版本一致性（阶段一）
2. **组件独立更新**: OpenClaw 等高频变更组件可独立热更新（阶段二）
3. **国内可用**: 基于 Cloudflare R2，无需翻墙即可下载更新
4. **自动化发布**: git tag → CI 构建 → 签名 → 上传 → 用户收到通知，全自动
5. **安全可靠**: 代码签名、hash 校验、失败回滚

### 1.3 不在范围内

- Linux 平台支持（后续按需添加）
- 企业内网私有部署更新
- A/B 测试分发

---

## 2. 架构总览

```
┌─────────────────────────────────────────────────────────┐
│                    发布流程 (Push)                        │
│                                                         │
│  开发者 git tag v1.2.0                                   │
│       │                                                 │
│       ▼                                                 │
│  GitHub Actions                                         │
│  ┌──────────────────────────────────────┐               │
│  │ 1. Build (macOS arm64/x64, Windows) │               │
│  │ 2. Code Sign + Notarize            │               │
│  │ 3. Generate latest.yml / manifest   │               │
│  │ 4. Upload → Cloudflare R2           │               │
│  │ 5. Purge CDN cache                  │               │
│  │ 6. (可选) API 广播 update event      │               │
│  └──────────────────────────────────────┘               │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                 分发基础设施 (Serve)                      │
│                                                         │
│  Cloudflare R2 Bucket: nexu-releases                    │
│  ┌────────────────────────────────────────┐             │
│  │ /desktop/                              │             │
│  │   ├── latest.yml          (Win meta)   │             │
│  │   ├── latest-mac.yml      (Mac meta)   │             │
│  │   ├── Nexu-1.2.0-arm64.dmg            │             │
│  │   ├── Nexu-1.2.0-arm64-mac.zip        │             │
│  │   ├── Nexu-1.2.0-arm64-mac.zip.blockmap│            │
│  │   ├── Nexu-1.2.0.exe                  │             │
│  │   ├── Nexu-1.2.0.exe.blockmap         │             │
│  │   └── ...                              │             │
│  │ /components/                           │             │
│  │   ├── manifest.json       (组件清单)    │             │
│  │   ├── openclaw/                        │             │
│  │   │   ├── 2026.3.15-darwin-arm64.tar.gz│             │
│  │   │   └── 2026.3.15-win32-x64.tar.gz  │             │
│  │   └── ...                              │             │
│  └────────────────────────────────────────┘             │
│       │                                                 │
│       ▼                                                 │
│  Cloudflare Worker: nexu-releases-worker                │
│  (可选, 提供版本查询 API / 下载统计 / 访问控制)           │
│       │                                                 │
│       ▼                                                 │
│  自定义域名: releases.nexu.space                         │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                 客户端更新 (Pull)                         │
│                                                         │
│  Nexu Desktop (Electron)                                │
│  ┌──────────────────────────────────────┐               │
│  │ UpdateManager                        │               │
│  │  ├── 启动后 60s 首次检查              │               │
│  │  ├── 之后每 4h 轮询                   │               │
│  │  ├── WS 推送触发立即检查 (可选)        │               │
│  │  │                                   │               │
│  │  ├── 全量更新 (electron-updater)      │               │
│  │  │   GET releases.nexu.space/        │               │
│  │  │       desktop/latest-mac.yml      │               │
│  │  │   → 对比版本 → 下载 → 安装重启     │               │
│  │  │                                   │               │
│  │  └── 组件更新 (ComponentUpdater)      │               │
│  │      GET releases.nexu.space/        │               │
│  │          components/manifest.json    │               │
│  │      → 对比版本 → 下载 → 替换 → 重启组件│              │
│  └──────────────────────────────────────┘               │
└─────────────────────────────────────────────────────────┘
```

---

## 3. 版本策略

### 3.1 应用版本 (Electron Shell)

采用 **semver** 语义化版本:

```
MAJOR.MINOR.PATCH[-channel.N]

示例:
  1.0.0           # 正式版
  1.1.0-beta.1    # Beta 通道
  1.1.0-canary.3  # Canary 通道
```

- **MAJOR**: 不兼容的架构变更（sidecar 协议变化、数据格式迁移）
- **MINOR**: 新功能（新 sidecar、新 IPC 通道）
- **PATCH**: Bug 修复、小优化

### 3.2 组件版本 — 统一版本号

所有 sidecar 组件**共享同一个版本号**（与应用版本一致），不独立维护版本。统一发布、按需下载：

- 发布时所有组件同时构建、打包、上传
- 客户端检查更新时对比每个组件的 sha256，只下载**实际有变更**的组件
- 避免组件间版本不匹配导致的兼容性问题

```json
// components/manifest.json (R2 上)
{
  "schemaVersion": 1,
  "version": "1.2.0",
  "minShellVersion": "1.0.0",
  "components": {
    "web": {
      "platforms": {
        "darwin-arm64": {
          "url": "/components/1.2.0/web-darwin-arm64.tar.gz",
          "sha256": "aaa111...",
          "size": 8000000
        }
      }
    },
    "api": {
      "platforms": {
        "darwin-arm64": {
          "url": "/components/1.2.0/api-darwin-arm64.tar.gz",
          "sha256": "bbb222...",
          "size": 15000000
        }
      }
    },
    "gateway": {
      "platforms": {
        "darwin-arm64": {
          "url": "/components/1.2.0/gateway-darwin-arm64.tar.gz",
          "sha256": "ccc333...",
          "size": 12000000
        }
      }
    },
    "openclaw": {
      "platforms": {
        "darwin-arm64": {
          "url": "/components/1.2.0/openclaw-darwin-arm64.tar.gz",
          "sha256": "ddd444...",
          "size": 52000000
        }
      }
    },
    "session-chat": {
      "platforms": {
        "darwin-arm64": {
          "url": "/components/1.2.0/session-chat-darwin-arm64.tar.gz",
          "sha256": "eee555...",
          "size": 10000000
        }
      }
    },
    "pglite": {
      "platforms": {
        "darwin-arm64": {
          "url": "/components/1.2.0/pglite-darwin-arm64.tar.gz",
          "sha256": "fff666...",
          "size": 5000000
        }
      }
    }
  }
}
```

**更新判断逻辑**: 客户端本地存储每个组件当前的 sha256，对比远程 manifest，sha256 不同的才下载。即使版本号从 1.1.0 → 1.2.0，如果某个组件的产物没变（sha256 相同），则跳过。

### 3.3 组件清单

| 组件 | 内容 | 更新后动作 |
|------|------|-----------|
| `web` | 前端静态文件 | 刷新 webview |
| `api` | Hono API server + migrations | 重启 api sidecar，自动 migrate |
| `gateway` | Gateway 服务 | 重启 gateway sidecar |
| `openclaw` | OpenClaw npm 包 | 重启 gateway（由 gateway 启动 openclaw） |
| `session-chat` | Next.js 聊天应用 | 重启 session-chat sidecar |
| `pglite` | PGlite socket server | 重启 pglite sidecar（需先停 api） |

### 3.4 更新通道 (Channels)

| 通道 | 文件 | 用途 | 用户群 |
|------|------|------|--------|
| stable | `latest.yml` / `latest-mac.yml` | 正式版 | 所有用户 |
| beta | `beta.yml` / `beta-mac.yml` | 测试版 | 内测用户 |

用户可在设置中切换通道。默认 stable。

---

## 4. 基础设施: Cloudflare R2 + Worker

### 4.1 为什么选 R2

- 你们已有 Cloudflare 账号（tunnel、3 个 Worker）
- **出站流量永久免费**（vs S3 按 GB 收费）
- 中国大陆基本可访问（比 GitHub/S3 好很多）
- 10GB 免费存储 + 1000 万次/月免费读取

### 4.2 R2 Bucket 设置

```bash
# 创建 bucket
wrangler r2 bucket create nexu-releases

# 绑定自定义域名 (Cloudflare Dashboard)
# nexu-releases bucket → Settings → Custom Domains → releases.nexu.space
```

Bucket 目录结构:

```
nexu-releases/
├── desktop/                          # 应用全量包
│   ├── latest.yml                    # Windows stable 元信息
│   ├── latest-mac.yml                # macOS stable 元信息
│   ├── beta.yml                      # Windows beta 元信息
│   ├── beta-mac.yml                  # macOS beta 元信息
│   ├── Nexu-1.0.0-arm64.dmg         # macOS ARM 安装包 (首次安装用)
│   ├── Nexu-1.0.0-arm64-mac.zip     # macOS ARM 更新包 (自动更新用)
│   ├── Nexu-1.0.0-arm64-mac.zip.blockmap  # 差分更新 blockmap
│   ├── Nexu-1.0.0-x64.dmg
│   ├── Nexu-1.0.0-x64-mac.zip
│   ├── Nexu-1.0.0.exe               # Windows 安装包
│   ├── Nexu-1.0.0.exe.blockmap
│   └── archive/                      # 历史版本归档
│       └── 0.9.0/
├── components/                       # 组件独立更新
│   ├── manifest.json                 # 组件版本清单
│   └── openclaw/
│       ├── 2026.3.15-darwin-arm64.tar.gz
│       ├── 2026.3.15-darwin-x64.tar.gz
│       └── 2026.3.15-win32-x64.tar.gz
└── _meta/                            # 元数据
    └── releases.json                 # 所有发布版本记录
```

### 4.3 可选: Worker API

在 `apps/router` 同级创建 `apps/releases-worker`，或直接用 R2 Public Access。

**方案 A: R2 Public Access（推荐起步）**

直接开启 R2 bucket 的公开访问并绑定自定义域名，无需额外 Worker。electron-updater 直接请求静态文件。

```
releases.nexu.space/desktop/latest-mac.yml → R2 静态文件
```

**方案 B: Worker API（后续增强）**

当需要下载统计、访问控制、动态路由时，加一层 Worker:

```toml
# apps/releases-worker/wrangler.toml
name = "nexu-releases-worker"
main = "src/index.ts"
compatibility_date = "2025-01-01"

[[r2_buckets]]
binding = "RELEASES"
bucket_name = "nexu-releases"

[routes]
pattern = "releases.nexu.space/*"
```

```typescript
// apps/releases-worker/src/index.ts
export default {
  async fetch(request: Request, env: { RELEASES: R2Bucket }) {
    const url = new URL(request.url);
    const key = url.pathname.slice(1); // 去掉前导 /

    // 直接代理 R2
    const object = await env.RELEASES.get(key);
    if (!object) return new Response("Not Found", { status: 404 });

    return new Response(object.body, {
      headers: {
        "content-type": object.httpMetadata?.contentType || "application/octet-stream",
        "cache-control": key.includes("latest")
          ? "public, max-age=300"   // 元信息缓存 5 分钟
          : "public, max-age=86400", // 安装包缓存 1 天
        "etag": object.httpEtag,
      },
    });
  },
};
```

---

## 5. CI/CD 自动化发布流水线

### 5.1 两套发布流程

| | 测试发布 (Beta) | 线上发布 (Stable) |
|---|---|---|
| **触发方式** | 手动 (workflow_dispatch) 或推 `v*-beta.*` tag | 推 `v*` 正式 tag (不含 `-beta`) |
| **签名** | 可选（未签名需手动绕过 Gatekeeper） | 必须签名 + 公证 |
| **R2 路径** | `desktop/beta/` | `desktop/stable/` |
| **元信息文件** | `beta-mac.yml` / `beta.yml` | `latest-mac.yml` / `latest.yml` |
| **客户端检测** | 仅 beta 通道用户收到 | 所有用户收到 |
| **用途** | 内部团队测试、验证功能 | 正式推送给用户 |
| **GitHub Release** | Draft (不公开) | Published |

```
测试流程:
  git tag v1.2.0-beta.1 → CI 构建 → 跳过签名(或签名) → 上传 R2 beta/ → 团队手动下载测试
  或: 手动触发 workflow_dispatch → 选择分支 → 构建 → 上传

线上流程:
  团队验证 beta OK → git tag v1.2.0 → CI 构建 → 签名+公证 → 上传 R2 stable/ → 全量用户自动收到更新
```

### 5.2 共享构建 Job (复用)

两套流程共享同一个 build job，通过参数区分：

```yaml
# .github/workflows/desktop-release.yml
name: Desktop Release

on:
  push:
    tags:
      - 'v*'
  workflow_dispatch:
    inputs:
      channel:
        description: 'Release channel'
        required: true
        default: 'beta'
        type: choice
        options: [beta, stable]
      skip_signing:
        description: 'Skip code signing (for testing without Apple cert)'
        required: false
        default: true
        type: boolean

concurrency:
  group: desktop-release
  cancel-in-progress: false

jobs:
  # ---- 确定发布参数 ----
  prepare:
    runs-on: ubuntu-latest
    outputs:
      channel: ${{ steps.params.outputs.channel }}
      version: ${{ steps.params.outputs.version }}
      skip_signing: ${{ steps.params.outputs.skip_signing }}
    steps:
      - uses: actions/checkout@v4
      - name: Determine release params
        id: params
        run: |
          if [ "${{ github.event_name }}" = "workflow_dispatch" ]; then
            # 手动触发：从 package.json 读版本
            VERSION=$(node -p "require('./apps/desktop/package.json').version")
            CHANNEL="${{ inputs.channel }}"
            SKIP_SIGNING="${{ inputs.skip_signing }}"
          else
            # Tag 触发
            TAG=${GITHUB_REF#refs/tags/v}
            VERSION="$TAG"
            if [[ "$TAG" == *"-beta"* ]]; then
              CHANNEL="beta"
              SKIP_SIGNING="true"  # beta 默认跳过签名
            else
              CHANNEL="stable"
              SKIP_SIGNING="false" # stable 必须签名
            fi
          fi

          echo "channel=$CHANNEL" >> $GITHUB_OUTPUT
          echo "version=$VERSION" >> $GITHUB_OUTPUT
          echo "skip_signing=$SKIP_SIGNING" >> $GITHUB_OUTPUT
          echo "📦 Release: v$VERSION ($CHANNEL) skip_signing=$SKIP_SIGNING"

  # ---- 多平台构建 ----
  build:
    needs: prepare
    strategy:
      fail-fast: false
      matrix:
        include:
          - os: macos-14
            arch: arm64
            platform: darwin
          - os: macos-13
            arch: x64
            platform: darwin
          - os: windows-latest
            arch: x64
            platform: win32

    runs-on: ${{ matrix.os }}

    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Build monorepo
        run: pnpm build

      - name: Prepare sidecars
        working-directory: apps/desktop
        run: |
          pnpm prepare:api-sidecar
          pnpm prepare:gateway-sidecar
          pnpm prepare:openclaw-sidecar
          pnpm prepare:pglite-sidecar
          pnpm prepare:session-chat-sidecar
          pnpm prepare:web-sidecar

      - name: Build & Package Desktop
        working-directory: apps/desktop
        env:
          # macOS 签名 (skip_signing=true 时 CSC_LINK 为空，electron-builder 自动跳过)
          CSC_LINK: ${{ needs.prepare.outputs.skip_signing == 'false' && secrets.MAC_CERTIFICATE_P12_BASE64 || '' }}
          CSC_KEY_PASSWORD: ${{ secrets.MAC_CERTIFICATE_PASSWORD }}
          APPLE_ID: ${{ secrets.APPLE_ID }}
          APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_APP_PASSWORD }}
          APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
          # Windows 签名
          WIN_CSC_LINK: ${{ needs.prepare.outputs.skip_signing == 'false' && secrets.WIN_CERTIFICATE_P12_BASE64 || '' }}
          WIN_CSC_KEY_PASSWORD: ${{ secrets.WIN_CERTIFICATE_PASSWORD }}
        run: pnpm build:dist  # → electron-builder --publish never

      - name: Upload artifacts
        uses: actions/upload-artifact@v4
        with:
          name: desktop-${{ matrix.platform }}-${{ matrix.arch }}
          path: apps/desktop/release/*
          retention-days: 30

  # ---- 上传到 R2 ----
  publish:
    needs: [prepare, build]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Download all artifacts
        uses: actions/download-artifact@v4
        with:
          path: release-artifacts
          merge-multiple: true

      - name: Upload to R2
        env:
          AWS_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}
          R2_ENDPOINT: ${{ secrets.R2_ENDPOINT }}
          CHANNEL: ${{ needs.prepare.outputs.channel }}
          VERSION: ${{ needs.prepare.outputs.version }}
        run: |
          curl -O https://downloads.rclone.org/rclone-current-linux-amd64.deb
          sudo dpkg -i rclone-current-linux-amd64.deb

          rclone config create r2 s3 \
            provider=Cloudflare \
            access_key_id=$AWS_ACCESS_KEY_ID \
            secret_access_key=$AWS_SECRET_ACCESS_KEY \
            endpoint=$R2_ENDPOINT \
            no_check_bucket=true

          # 根据通道决定上传路径
          if [ "$CHANNEL" = "stable" ]; then
            R2_DIR="desktop/stable"
          else
            R2_DIR="desktop/beta"
          fi

          # 上传安装包、blockmap、元信息文件
          rclone copy release-artifacts/ r2:nexu-releases/$R2_DIR/ \
            --include "*.{exe,dmg,zip,blockmap,yml}" \
            --transfers 4

          # 归档到版本目录 (用于历史回溯和手动下载)
          rclone copy release-artifacts/ \
            r2:nexu-releases/desktop/archive/$VERSION/ \
            --include "*.{exe,dmg,zip}" \
            --transfers 4

      - name: Create GitHub Release
        env:
          GH_TOKEN: ${{ github.token }}
          CHANNEL: ${{ needs.prepare.outputs.channel }}
          VERSION: ${{ needs.prepare.outputs.version }}
        run: |
          if [ "$CHANNEL" = "stable" ]; then
            # 正式版：Published Release
            gh release create "v$VERSION" \
              --title "Nexu Desktop v$VERSION" \
              --generate-notes \
              release-artifacts/*.{dmg,exe}
          else
            # 测试版：Draft Release (不公开)
            gh release create "v$VERSION" \
              --title "Nexu Desktop v$VERSION (Beta)" \
              --prerelease \
              --generate-notes \
              release-artifacts/*.{dmg,exe}
          fi

      - name: Notify (stable only)
        if: needs.prepare.outputs.channel == 'stable'
        run: |
          curl -sf -X POST https://api.nexu.io/api/internal/desktop-release \
            -H "Authorization: Bearer ${{ secrets.INTERNAL_API_TOKEN }}" \
            -H "Content-Type: application/json" \
            -d "{\"version\": \"${{ needs.prepare.outputs.version }}\", \"channel\": \"stable\"}" \
            || echo "API notify failed (non-fatal)"
```

### 5.3 发布操作手册

**测试发布 (内部团队验证)**:

```bash
# 方式一：打 beta tag
git tag v1.2.0-beta.1
git push origin v1.2.0-beta.1
# → CI 自动构建，跳过签名，上传到 R2 beta/
# → 团队从 GitHub Release (prerelease) 或 R2 beta/ 下载测试
# → macOS 用户需手动: 右键→打开 或 xattr -cr Nexu.app

# 方式二：手动触发 (可选择任意分支)
# GitHub → Actions → Desktop Release → Run workflow
# 选择 channel=beta, skip_signing=true, 选择分支
```

**线上发布 (推送给所有用户)**:

```bash
# 1. 确认 beta 测试通过

# 2. 更新版本号 (去掉 -beta 后缀)
cd apps/desktop && npm version 1.2.0

# 3. 提交
git add -A && git commit -m "release: desktop v1.2.0"

# 4. 打正式 tag
git tag v1.2.0
git push && git push origin v1.2.0
# → CI 自动构建，签名+公证，上传到 R2 stable/
# → 所有 stable 通道用户 4h 内自动收到更新通知

# 5. 验证
# - 检查 GitHub Release 是否 Published
# - 检查 releases.nexu.space/desktop/stable/latest-mac.yml 是否更新
# - 本地客户端手动检查更新
```

### 5.3 electron-builder 配置

```yaml
# apps/desktop/electron-builder.yml
appId: com.nexu.desktop
productName: Nexu
copyright: Copyright © 2026 Nexu

# 配置 generic provider 以便 electron-builder 生成 latest.yml 元信息文件
# CI 构建时用 --publish never 阻止自动上传，手动用 rclone 上传到 R2
publish:
  provider: generic
  url: https://releases.nexu.space/desktop

directories:
  output: release
  buildResources: build

# Sidecar 打包为 extraResources
extraResources:
  - from: .tmp/sidecars/api
    to: sidecar/api
    filter: ["**/*", "!node_modules/.cache"]
  - from: .tmp/sidecars/gateway
    to: sidecar/gateway
    filter: ["**/*", "!node_modules/.cache"]
  - from: .tmp/sidecars/web
    to: sidecar/web
    filter: ["**/*"]
  - from: .tmp/sidecars/pglite
    to: sidecar/pglite
    filter: ["**/*"]
  - from: .tmp/sidecars/session-chat
    to: sidecar/session-chat
    filter: ["**/*"]
  - from: .tmp/sidecars/openclaw
    to: sidecar/openclaw
    filter: ["**/*"]

files:
  - "dist/**/*"
  - "dist-electron/**/*"
  - "package.json"

# ---- macOS ----
mac:
  target:
    - target: dmg
      arch: [arm64, x64]
    - target: zip      # 自动更新必须用 zip
      arch: [arm64, x64]
  category: public.app-category.productivity
  hardenedRuntime: true
  gatekeeperAssess: false
  entitlements: build/entitlements.mac.plist
  entitlementsInherit: build/entitlements.mac.plist

dmg:
  sign: false  # DMG 本身不需要签名

afterPack: scripts/after-pack.js    # 签名 sidecar 二进制
afterSign: scripts/notarize.js      # macOS 公证

# ---- Windows ----
win:
  target:
    - target: nsis
      arch: [x64]
  signingHashAlgorithms: [sha256]

nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
  perMachine: false
  differentialPackage: true

# ---- 生成 blockmap 用于差分更新 ----
# electron-builder 默认生成 .blockmap 文件
```

### 5.4 package.json 新增 scripts

```jsonc
// apps/desktop/package.json 新增
{
  "scripts": {
    // ... 现有 scripts
    "build:dist": "vite build && electron-builder",
    "build:dist:mac": "vite build && electron-builder --mac",
    "build:dist:win": "vite build && electron-builder --win",
    "release:dry": "vite build && electron-builder --mac --win --publish never"
  }
}
```

---

## 6. 客户端更新机制

### 6.1 UpdateManager 模块

```
apps/desktop/main/
├── updater/
│   ├── update-manager.ts       # 主更新管理器
│   ├── component-updater.ts    # 组件独立更新 (阶段二)
│   └── rollback.ts             # 回滚逻辑
```

### 6.2 全量更新流程 (electron-updater)

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   定时轮询    │────▶│  检查版本     │────▶│  发现新版本   │
│  (每 4 小时)  │     │ GET latest-  │     │  通知渲染进程  │
│  或 WS 推送   │     │ mac.yml      │     │  显示更新横幅  │
└──────────────┘     └──────────────┘     └──────┬───────┘
                                                  │
                              用户点击「下载更新」   │
                                                  ▼
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   安装重启    │◀────│  下载完成     │◀────│  后台下载     │
│              │     │  提示用户重启  │     │  显示进度条   │
│ 1.关闭sidecar│     │              │     │  支持差分下载  │
│ 2.PGlite备份 │     └──────────────┘     └──────────────┘
│ 3.quit+install│
└──────────────┘
```

### 6.3 核心实现

```typescript
// apps/desktop/main/updater/update-manager.ts

import { autoUpdater, UpdateCheckResult, UpdateInfo } from "electron-updater";
import { app, BrowserWindow, ipcMain } from "electron";
import type { RuntimeOrchestrator } from "../runtime/daemon-supervisor";

interface UpdateManagerOptions {
  /** 更新文件基础 URL */
  feedUrl: string;
  /** 检查间隔 (ms), 默认 4 小时 */
  checkInterval?: number;
  /** 首次检查延迟 (ms), 默认 60 秒 */
  initialDelay?: number;
  /** 是否自动下载, 默认 false (提示用户) */
  autoDownload?: boolean;
}

const DEFAULT_OPTIONS: Required<UpdateManagerOptions> = {
  feedUrl: "https://releases.nexu.space/desktop",
  checkInterval: 4 * 60 * 60 * 1000,
  initialDelay: 60_000,
  autoDownload: false,
};

export class UpdateManager {
  private win: BrowserWindow;
  private orchestrator: RuntimeOrchestrator;
  private opts: Required<UpdateManagerOptions>;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    win: BrowserWindow,
    orchestrator: RuntimeOrchestrator,
    options?: UpdateManagerOptions,
  ) {
    this.win = win;
    this.orchestrator = orchestrator;
    this.opts = { ...DEFAULT_OPTIONS, ...options };

    this.configure();
    this.bindEvents();
    this.registerIPC();
  }

  // ---- 配置 ----

  private configure() {
    autoUpdater.setFeedURL({
      provider: "generic",
      url: this.opts.feedUrl,
    });
    autoUpdater.autoDownload = this.opts.autoDownload;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowDowngrade = false;
  }

  // ---- 事件绑定 ----

  private bindEvents() {
    autoUpdater.on("checking-for-update", () => {
      this.send("update:checking");
    });

    autoUpdater.on("update-available", (info: UpdateInfo) => {
      this.send("update:available", {
        version: info.version,
        releaseDate: info.releaseDate,
        releaseNotes: info.releaseNotes,
      });
    });

    autoUpdater.on("update-not-available", () => {
      this.send("update:up-to-date");
    });

    autoUpdater.on("download-progress", (progress) => {
      this.send("update:progress", {
        percent: Math.round(progress.percent),
        transferred: progress.transferred,
        total: progress.total,
        bytesPerSecond: progress.bytesPerSecond,
      });
    });

    autoUpdater.on("update-downloaded", (info: UpdateInfo) => {
      this.send("update:downloaded", { version: info.version });
    });

    autoUpdater.on("error", (err) => {
      console.error("[updater] error:", err.message);
      this.send("update:error", { message: err.message });
    });
  }

  // ---- IPC 注册 ----

  private registerIPC() {
    ipcMain.handle("update:check", () => this.checkNow());
    ipcMain.handle("update:download", () => autoUpdater.downloadUpdate());
    ipcMain.handle("update:install", () => this.quitAndInstall());
    ipcMain.handle("update:get-current-version", () => app.getVersion());
    ipcMain.handle("update:set-channel", (_e, channel: string) => {
      this.setChannel(channel);
    });
  }

  // ---- 公开方法 ----

  /** 启动定时检查 */
  startPeriodicCheck() {
    setTimeout(() => this.checkNow(), this.opts.initialDelay);
    this.timer = setInterval(() => this.checkNow(), this.opts.checkInterval);
  }

  /** 停止定时检查 */
  stopPeriodicCheck() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** 立即检查一次 */
  async checkNow(): Promise<UpdateCheckResult | null> {
    try {
      return await autoUpdater.checkForUpdates();
    } catch (err) {
      console.error("[updater] check failed:", err);
      return null;
    }
  }

  /** 切换更新通道 */
  setChannel(channel: "stable" | "beta") {
    autoUpdater.channel = channel;
    // 切换后立即检查
    this.checkNow();
  }

  /** 安全关闭所有 sidecar 后退出安装 */
  private async quitAndInstall() {
    console.log("[updater] preparing to quit and install...");

    // 1. 通知 UI 正在准备
    this.send("update:installing");

    // 2. 优雅关闭所有 sidecar
    await this.orchestrator.stopAll();

    // 3. Windows: 等待文件句柄释放
    if (process.platform === "win32") {
      await sleep(2000);
    }

    // 4. 退出并安装
    autoUpdater.quitAndInstall(false, true);
  }

  private send(channel: string, data?: unknown) {
    if (!this.win.isDestroyed()) {
      this.win.webContents.send(channel, data);
    }
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

### 6.4 IPC 通道扩展

在现有 `host.ts` 的 IPC 通道列表中新增:

```typescript
// 新增到 hostInvokeChannels
const updateChannels = [
  "update:check",                // → 手动触发检查
  "update:download",             // → 开始下载
  "update:install",              // → 退出并安装
  "update:get-current-version",  // → 获取当前版本
  "update:set-channel",          // → 切换通道 stable/beta
] as const;

// 新增 main→renderer 推送事件 (通过 webContents.send)
// update:checking          检查中
// update:available          有新版本
// update:up-to-date         已是最新
// update:progress           下载进度
// update:downloaded         下载完成
// update:installing         正在安装
// update:error              错误
```

### 6.5 Preload 扩展

```typescript
// preload/index.ts 新增
contextBridge.exposeInMainWorld("nexuUpdater", {
  check: () => ipcRenderer.invoke("update:check"),
  download: () => ipcRenderer.invoke("update:download"),
  install: () => ipcRenderer.invoke("update:install"),
  getVersion: () => ipcRenderer.invoke("update:get-current-version"),
  setChannel: (ch: string) => ipcRenderer.invoke("update:set-channel", ch),

  // 事件监听
  onAvailable: (cb: (data: any) => void) =>
    ipcRenderer.on("update:available", (_e, data) => cb(data)),
  onProgress: (cb: (data: any) => void) =>
    ipcRenderer.on("update:progress", (_e, data) => cb(data)),
  onDownloaded: (cb: (data: any) => void) =>
    ipcRenderer.on("update:downloaded", (_e, data) => cb(data)),
  onError: (cb: (data: any) => void) =>
    ipcRenderer.on("update:error", (_e, data) => cb(data)),
});
```

### 6.6 可选: WebSocket 推送即时通知

利用已有的 API WebSocket 连接，在服务端发布新版本时广播事件:

```typescript
// API 端 - 收到 CI 的 release webhook 后广播
ws.broadcast({
  type: "desktop:update-available",
  payload: { version: "1.1.0", channel: "stable" },
});

// 客户端 - 监听 WS 事件触发即时检查
ws.on("desktop:update-available", () => {
  updateManager.checkNow();
});
```

这样用户在发布后几秒钟内就能收到更新通知，而不用等 4 小时轮询。

---

## 7. 组件级独立更新

### 7.1 适用场景

| 场景 | 全量更新 | 组件更新 |
|------|---------|---------|
| Electron Shell / IPC / preload 变更 | ✅ 必须 | ❌ |
| 前端 UI 变更 | 可以但浪费 | ✅ 推荐 (只更新 web 组件) |
| API 逻辑变更 | 可以但浪费 | ✅ 推荐 (只更新 api 组件) |
| Gateway 逻辑变更 | 可以但浪费 | ✅ 推荐 (只更新 gateway 组件) |
| OpenClaw 版本升级 | 可以但浪费 | ✅ 推荐 (只更新 openclaw 组件) |
| Session Chat 变更 | 可以但浪费 | ✅ 推荐 |
| PGlite 升级 | ✅ 推荐 (涉及数据迁移) | 可以但需谨慎 |

**只有 Electron Shell 本身的变更才需要全量更新**。其他所有 sidecar 组件都走组件级更新：
- 所有组件同一版本号，统一发布
- 客户端按 sha256 差异只下载实际变更的组件
- 减少用户下载量（只下载变更的包，而非整个应用）
- 加快发布速度（无需重新构建+签名整个 Electron 应用）

### 7.2 组件存储位置

组件文件从应用包内迁移到用户数据目录，使其可以独立于应用包更新:

```
macOS: ~/Library/Application Support/Nexu/
Windows: %APPDATA%/Nexu/

目录结构:
├── components/
│   ├── manifest.local.json      # 本地已安装组件版本清单 (含每个组件的路径和 sha256)
│   ├── web/
│   │   └── 1.2.0/               # 版本目录
│   ├── api/
│   │   └── 1.2.0/
│   ├── gateway/
│   │   └── 1.2.0/
│   ├── openclaw/
│   │   └── 1.2.0/
│   ├── session-chat/
│   │   └── 1.2.0/
│   └── pglite/
│       └── 1.2.0/
├── data/
│   ├── pglite/                  # PGlite 数据目录
│   └── openclaw/                # OpenClaw 状态/技能
└── logs/
```

> **注意**: 不使用 symlink 指向 `current`，因为 Windows 创建 symlink 需要管理员权限。
> 改为在 `manifest.local.json` 中记录当前生效版本的完整路径，启动时直接读取。

```json
// manifest.local.json 示例
{
  "version": "1.2.0",
  "components": {
    "web":          { "sha256": "aaa111...", "path": ".../components/web/1.2.0" },
    "api":          { "sha256": "bbb222...", "path": ".../components/api/1.2.0" },
    "gateway":      { "sha256": "ccc333...", "path": ".../components/gateway/1.2.0" },
    "openclaw":     { "sha256": "ddd444...", "path": ".../components/openclaw/1.2.0" },
    "session-chat": { "sha256": "eee555...", "path": ".../components/session-chat/1.2.0" },
    "pglite":       { "sha256": "fff666...", "path": ".../components/pglite/1.2.0" }
  },
  "updatedAt": "2026-03-15T10:00:00Z"
}
```

**manifests.ts 需要动态解析 sidecar 路径**:

```typescript
function getSidecarDir(name: string): string {
  if (app.isPackaged) {
    // 优先从 userData/components 加载（组件更新后的版本）
    const localManifest = loadLocalManifestSync();
    if (localManifest?.components?.[name]?.path) {
      return localManifest.components[name].path;
    }
    // 回退到应用包内的 bundled 版本
    return path.join(process.resourcesPath, "sidecar", name);
  }
  // 开发模式
  return path.resolve(__dirname, `../../.tmp/sidecars/${name}`);
}
```

### 7.3 ComponentUpdater 实现

```typescript
// apps/desktop/main/updater/component-updater.ts

import { app } from "electron";
import { createHash } from "crypto";
import { createReadStream, createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import { extract } from "tar";
import * as fs from "fs/promises";
import * as path from "path";
import * as semver from "semver";

interface ComponentManifest {
  schemaVersion: number;
  components: Record<string, ComponentInfo>;
}

interface ComponentInfo {
  version: string;
  minShellVersion: string;
  maxShellVersion: string;
  releaseNotes?: string;
  platforms: Record<string, PlatformArtifact>;
}

interface PlatformArtifact {
  url: string;        // 相对于 baseUrl 的路径
  sha256: string;
  size: number;
}

interface LocalManifest {
  version: string;
  components: Record<string, { sha256: string; path: string }>;
  updatedAt: string;
}

export class ComponentUpdater {
  private baseUrl: string;
  private componentsDir: string;
  private localManifestPath: string;

  constructor(baseUrl = "https://releases.nexu.space") {
    this.baseUrl = baseUrl;
    this.componentsDir = path.join(app.getPath("userData"), "components");
    this.localManifestPath = path.join(this.componentsDir, "manifest.local.json");
  }

  /** 检查哪些组件需要更新 (按 sha256 差异判断) */
  async checkForUpdates(): Promise<ComponentUpdate[]> {
    const platform = `${process.platform}-${process.arch}`;
    const shellVersion = app.getVersion();

    // 拉取远程 manifest
    const res = await fetch(`${this.baseUrl}/components/manifest.json`);
    if (!res.ok) return [];
    const remote: ComponentManifest = await res.json();

    // 检查 shell 版本兼容性
    if (remote.minShellVersion && semver.lt(shellVersion, remote.minShellVersion)) {
      console.log("[component-updater] shell version too old, need full update");
      return [];
    }

    // 读取本地 manifest
    const local = await this.loadLocalManifest();

    const updates: ComponentUpdate[] = [];

    for (const [name, info] of Object.entries(remote.components)) {
      const artifact = info.platforms[platform];
      if (!artifact) continue;

      // 按 sha256 判断是否有变更 (同一版本号下某些组件可能没变)
      const localSha = local.components[name]?.sha256;
      if (localSha === artifact.sha256) continue; // 没变，跳过

      updates.push({
        name,
        newVersion: remote.version,
        artifact,
      });
    }

    return updates;
  }

  /** 下载并安装单个组件更新 */
  async installUpdate(
    update: ComponentUpdate,
    onProgress?: (percent: number) => void,
  ): Promise<void> {
    const { name, newVersion, artifact } = update;

    const versionDir = path.join(this.componentsDir, name, newVersion);
    const tempFile = `${versionDir}.tar.gz.tmp`;

    // 1. 下载
    await fs.mkdir(path.dirname(tempFile), { recursive: true });
    await this.downloadWithProgress(
      `${this.baseUrl}${artifact.url}`,
      tempFile,
      artifact.size,
      onProgress,
    );

    // 2. 校验 SHA-256
    const hash = await this.sha256File(tempFile);
    if (hash !== artifact.sha256) {
      await fs.rm(tempFile, { force: true });
      throw new Error(`SHA-256 mismatch for ${name}: expected ${artifact.sha256}, got ${hash}`);
    }

    // 3. 解压到版本目录
    await fs.mkdir(versionDir, { recursive: true });
    await extract({ file: tempFile, cwd: versionDir });
    await fs.rm(tempFile, { force: true });

    // 4. 更新本地 manifest (记录路径和 sha256)
    const local = await this.loadLocalManifest();
    local.version = newVersion;
    local.components[name] = {
      sha256: artifact.sha256,
      path: versionDir,
    };
    local.updatedAt = new Date().toISOString();
    await fs.writeFile(this.localManifestPath, JSON.stringify(local, null, 2));

    console.log(`[component-updater] ${name} updated to ${newVersion}`);
  }

  /** 首次启动: 从应用包拷贝所有内置组件到 userData */
  async bootstrapFromBundle(bundledSidecarDir: string) {
    const local = await this.loadLocalManifest();
    if (local.version) return; // 已经 bootstrap 过

    const version = app.getVersion();
    const componentNames = ["web", "api", "gateway", "openclaw", "session-chat", "pglite"];

    for (const name of componentNames) {
      const bundledDir = path.join(bundledSidecarDir, name);
      if (!(await this.exists(bundledDir))) continue;

      const targetDir = path.join(this.componentsDir, name, version);
      await fs.cp(bundledDir, targetDir, { recursive: true });

      // 计算 sha256 (对 tar 或目录内容)
      local.components[name] = {
        sha256: "bundled", // 首次 bootstrap 标记
        path: targetDir,
      };
    }

    local.version = version;
    local.updatedAt = new Date().toISOString();
    await fs.writeFile(this.localManifestPath, JSON.stringify(local, null, 2));
  }

  // ---- 内部方法 ----

  private async downloadWithProgress(
    url: string,
    dest: string,
    totalSize: number,
    onProgress?: (percent: number) => void,
  ): Promise<void> {
    const res = await fetch(url);
    if (!res.ok || !res.body) throw new Error(`Download failed: ${res.status}`);

    const writer = createWriteStream(dest);
    const reader = res.body.getReader();
    let received = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      writer.write(value);
      received += value.length;
      onProgress?.(Math.round((received / totalSize) * 100));
    }

    writer.end();
    await new Promise((resolve) => writer.on("finish", resolve));
  }

  private async sha256File(filePath: string): Promise<string> {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    await pipeline(stream, hash);
    return hash.digest("hex");
  }

  private async loadLocalManifest(): Promise<LocalManifest> {
    try {
      const raw = await fs.readFile(this.localManifestPath, "utf-8");
      return JSON.parse(raw);
    } catch {
      return { components: {} };
    }
  }

  private async exists(p: string): Promise<boolean> {
    try { await fs.access(p); return true; } catch { return false; }
  }
}

interface ComponentUpdate {
  name: string;
  currentVersion: string;
  newVersion: string;
  artifact: PlatformArtifact;
  releaseNotes?: string;
}
```

### 7.4 组件更新后重启策略

组件更新后，只需重启变更的 sidecar，不需要重启整个应用:

```typescript
// 按依赖顺序重启变更的组件
const RESTART_ORDER: Record<string, string[]> = {
  "pglite":       ["api", "pglite"],           // PGlite 变更需先停 api 再重启
  "api":          ["api"],                      // API 重启会自动 migrate
  "gateway":      ["gateway"],                  // Gateway 重启会自动重启 OpenClaw
  "openclaw":     ["gateway"],                  // OpenClaw 由 Gateway 启动
  "web":          [],                           // Web 是静态文件，刷新 webview 即可
  "session-chat": ["session-chat"],
};

async function restartUpdatedComponents(
  updatedComponents: string[],
  orchestrator: RuntimeOrchestrator,
  win: BrowserWindow,
) {
  // 收集需要重启的 sidecar (去重)
  const toRestart = new Set<string>();
  for (const comp of updatedComponents) {
    for (const sidecar of RESTART_ORDER[comp] || []) {
      toRestart.add(sidecar);
    }
  }

  // 按安全顺序: 先停，再启
  for (const unit of toRestart) await orchestrator.stopOne(unit);
  for (const unit of toRestart) await orchestrator.startOne(unit);

  // Web 组件只需刷新 webview
  if (updatedComponents.includes("web")) {
    win.webContents.send("component:web-updated"); // renderer 刷新 webview
  }
}
```

### 7.5 组件更新的 CI 流程

OpenClaw 等组件可以独立于 Desktop 应用发布:

```yaml
# .github/workflows/component-release.yml
name: Component Release

on:
  workflow_dispatch:
    inputs:
      component:
        description: 'Component name'
        required: true
        type: choice
        options: [openclaw]
      version:
        description: 'Version (e.g. 2026.3.15)'
        required: true

jobs:
  package:
    strategy:
      matrix:
        include:
          - os: macos-14
            platform: darwin-arm64
          - os: macos-13
            platform: darwin-x64
          - os: windows-latest
            platform: win32-x64

    runs-on: ${{ matrix.os }}

    steps:
      - uses: actions/checkout@v4

      # 构建组件
      - name: Build component
        run: |
          # 组件特定的构建步骤
          pnpm build:${{ inputs.component }}

      # 打包为 tar.gz
      - name: Package
        run: |
          tar -czf ${{ inputs.component }}-${{ inputs.version }}-${{ matrix.platform }}.tar.gz \
            -C dist/${{ inputs.component }} .

      - uses: actions/upload-artifact@v4
        with:
          name: ${{ inputs.component }}-${{ matrix.platform }}
          path: "*.tar.gz"

  publish:
    needs: package
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v4
        with:
          path: artifacts
          merge-multiple: true

      # 计算 SHA-256
      - name: Compute hashes
        run: |
          for f in artifacts/*.tar.gz; do
            sha256sum "$f" >> hashes.txt
          done
          cat hashes.txt

      # 上传到 R2
      - name: Upload to R2
        run: |
          rclone copy artifacts/ \
            r2:nexu-releases/components/${{ inputs.component }}/ \
            --include "*.tar.gz"

      # 更新 manifest.json
      - name: Update manifest
        run: |
          # 下载现有 manifest
          rclone copy r2:nexu-releases/components/manifest.json ./

          # 用脚本更新 manifest (添加新版本、新平台 artifact)
          node scripts/update-component-manifest.js \
            --component=${{ inputs.component }} \
            --version=${{ inputs.version }} \
            --hashes=hashes.txt

          # 上传更新后的 manifest
          rclone copy manifest.json r2:nexu-releases/components/
```

---

## 8. 安全: 代码签名与公证

### 8.1 macOS

**必须项:**
1. **Apple Developer Program** ($99/年) → 获得 Developer ID Application 证书
2. **Hardened Runtime** → 启用沙箱安全特性
3. **Notarization** → Apple 审核扫描恶意软件
4. **Sidecar 签名** → 所有 sidecar 中的二进制都必须签名

```xml
<!-- build/entitlements.mac.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key><true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
  <key>com.apple.security.cs.disable-library-validation</key><true/>
  <key>com.apple.security.network.client</key><true/>
  <key>com.apple.security.network.server</key><true/>
</dict>
</plist>
```

```javascript
// scripts/after-pack.js — 在打包后签名所有 sidecar 二进制
const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

exports.default = async function (context) {
  if (process.platform !== "darwin") return;

  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
  );
  const sidecarDir = path.join(appPath, "Contents", "Resources", "sidecar");

  // 递归查找所有可执行文件并签名
  function signRecursive(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        signRecursive(full);
      } else {
        try {
          fs.accessSync(full, fs.constants.X_OK);
          console.log(`Signing: ${full}`);
          execSync(
            `codesign --force --options runtime ` +
            `--sign "${process.env.CSC_NAME}" ` +
            `--entitlements build/entitlements.mac.plist "${full}"`,
          );
        } catch { /* 不可执行，跳过 */ }
      }
    }
  }

  if (fs.existsSync(sidecarDir)) signRecursive(sidecarDir);
};
```

```javascript
// scripts/notarize.js — macOS 公证
const { notarize } = require("@electron/notarize");

exports.default = async function (context) {
  if (context.electronPlatformName !== "darwin") return;

  const appName = context.packager.appInfo.productFilename;
  await notarize({
    appBundleId: "com.nexu.desktop",
    appPath: `${context.appOutDir}/${appName}.app`,
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
    teamId: process.env.APPLE_TEAM_ID,
  });
};
```

### 8.2 Windows

**推荐项:**
1. **EV Code Signing Certificate** (~$200+/年) → 避免 SmartScreen 警告
2. **签名工具**: `signtool.exe` 或 electron-builder 内置签名

暂时可以不签名，但用户首次安装会看到 SmartScreen 警告。

### 8.3 更新包完整性校验

electron-updater 内置了 SHA-512 校验（在 `latest.yml` 中）。组件更新使用 SHA-256 手动校验。

---

## 9. 回滚机制

### 9.1 全量更新回滚

electron-updater 不支持内置回滚。采用启动健康检查机制:

```typescript
// apps/desktop/main/updater/rollback.ts

import { app } from "electron";
import * as fs from "fs/promises";
import * as path from "path";

const HEALTH_FILE = path.join(app.getPath("userData"), ".startup-health");
const MAX_FAILURES = 3;
const HEALTHY_THRESHOLD_MS = 30_000; // 30 秒内不崩溃视为健康

interface HealthRecord {
  version: string;
  consecutiveFailures: number;
  lastAttempt: string;
}

export class StartupHealthCheck {
  /** 启动时调用。返回 false 表示需要回滚 */
  async check(): Promise<{ healthy: boolean; failCount: number }> {
    const record = await this.load();
    const currentVersion = app.getVersion();

    // 版本变化，重置计数
    if (record.version !== currentVersion) {
      await this.save({ version: currentVersion, consecutiveFailures: 1, lastAttempt: new Date().toISOString() });
      this.scheduleHealthyMark();
      return { healthy: true, failCount: 0 };
    }

    // 同版本再次启动，说明上次崩溃了
    record.consecutiveFailures++;
    record.lastAttempt = new Date().toISOString();
    await this.save(record);

    if (record.consecutiveFailures >= MAX_FAILURES) {
      console.error(`[health] ${MAX_FAILURES} consecutive failures, version ${currentVersion} is unhealthy`);
      return { healthy: false, failCount: record.consecutiveFailures };
    }

    this.scheduleHealthyMark();
    return { healthy: true, failCount: record.consecutiveFailures };
  }

  /** 30 秒后标记为健康（重置计数） */
  private scheduleHealthyMark() {
    setTimeout(async () => {
      const record = await this.load();
      record.consecutiveFailures = 0;
      await this.save(record);
      console.log("[health] startup marked as healthy");
    }, HEALTHY_THRESHOLD_MS);
  }

  private async load(): Promise<HealthRecord> {
    try {
      return JSON.parse(await fs.readFile(HEALTH_FILE, "utf-8"));
    } catch {
      return { version: "", consecutiveFailures: 0, lastAttempt: "" };
    }
  }

  private async save(record: HealthRecord) {
    await fs.writeFile(HEALTH_FILE, JSON.stringify(record));
  }
}
```

全量更新回滚只能提示用户重新下载上一个稳定版本（从 R2 归档目录）。

### 9.2 组件更新回滚

组件更新天然支持回滚，因为旧版本保留在 userData 中:

```typescript
// ComponentUpdater 增加回滚方法 — 整体回退到上一个版本
async rollbackAll(): Promise<void> {
  const local = await this.loadLocalManifest();
  const currentVersion = local.version;

  // 遍历所有组件，查找上一个版本目录
  for (const [name, info] of Object.entries(local.components)) {
    const compDir = path.join(this.componentsDir, name);
    const versions = (await fs.readdir(compDir, { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort(semver.rcompare);

    const prevVersion = versions.find((v) => v !== currentVersion);
    if (prevVersion) {
      local.components[name].path = path.join(compDir, prevVersion);
      local.components[name].sha256 = "rollback";
    }
  }

  local.version = "rollback";
  local.updatedAt = new Date().toISOString();
  await fs.writeFile(this.localManifestPath, JSON.stringify(local, null, 2));
  console.log(`[component-updater] rolled back all components from ${currentVersion}`);
}
```

---

## 10. 数据迁移与安全关闭

### 10.1 PGlite 数据迁移

更新后 PGlite 数据库 schema 可能变化。API sidecar 已有 Drizzle migration 机制，需确保更新后自动迁移：

```
更新安装完成 → 应用启动 → PGlite 启动 → API 启动 (自动 migrate)
→ 健康检查通过 → 继续启动其他 sidecar
→ 迁移失败 → 回滚数据 → 报错通知用户
```

**迁移前自动备份**:

```typescript
async function postUpdateMigration(orchestrator: RuntimeOrchestrator) {
  const dbDir = path.join(app.getPath("userData"), "data", "pglite");
  const backupDir = `${dbDir}.backup-${Date.now()}`;

  // 1. 备份
  await fs.cp(dbDir, backupDir, { recursive: true });

  try {
    // 2. 启动 PGlite + API (API 启动时自动 migrate)
    await orchestrator.startOne("pglite");
    await orchestrator.startOne("api");
    // 3. 健康检查
    await waitForPort(50800, 30_000);
  } catch (err) {
    // 4. 迁移失败，回滚数据
    await fs.rm(dbDir, { recursive: true, force: true });
    await fs.rename(backupDir, dbDir);
    throw new Error(`Migration failed: ${err.message}`);
  }
}
```

### 10.2 Sidecar 安全关闭顺序

全量更新时关闭所有 sidecar，必须按依赖关系逆序，避免 API 写入 PGlite 时 PGlite 已关导致数据损坏：

```typescript
// RuntimeOrchestrator.stopAll() 有序关闭
const SHUTDOWN_ORDER = [
  "openclaw",       // 由 gateway 管理，先停
  "gateway",
  "session-chat",
  "session-chat-db",
  "api",
  "web",
  "pglite",         // 最后关闭，确保所有写入完成
];
```

---

## 11. 强制更新与离线处理

### 11.1 强制更新

当 API 协议发生破坏性变更时，旧客户端无法正常工作，需要强制更新。

在 R2 上维护 `desktop/policy.json`:

```json
{
  "minVersion": "1.0.0",
  "message": "此版本包含重要安全更新，请立即更新。",
  "action": "force"
}
```

客户端启动时检查：

```typescript
async checkPolicy(): Promise<UpdatePolicy | null> {
  const res = await fetch(`${this.opts.feedUrl}/policy.json`);
  if (!res.ok) return null;
  const policy = await res.json();
  if (semver.lt(app.getVersion(), policy.minVersion)) {
    return policy; // UI 弹模态对话框，禁用关闭，只能更新
  }
  return null;
}
```

### 11.2 离线/弱网处理

- **更新检查失败**: 静默忽略，下次定时再试
- **下载中断**: 支持断点续传（`Range` header + 本地记录已下载字节数）
- **离线模式**: 所有功能正常工作，更新相关 UI 显示"离线，无法检查更新"

---

## 12. 监控与 Changelog

### 12.1 更新成功率监控

利用已有的 Amplitude SDK 埋点：

```typescript
// 下载完成
autoUpdater.on("update-downloaded", (info) => {
  amplitude.track("desktop_update_downloaded", {
    fromVersion: app.getVersion(),
    toVersion: info.version,
  });
});

// 更新安装重启后，检测版本变化
app.on("ready", () => {
  const lastVersion = store.get("lastVersion");
  const currentVersion = app.getVersion();
  if (lastVersion && lastVersion !== currentVersion) {
    amplitude.track("desktop_update_success", {
      fromVersion: lastVersion,
      toVersion: currentVersion,
    });
  }
  store.set("lastVersion", currentVersion);
});
```

### 12.2 Changelog 展示

发布时在 R2 上传 changelog，客户端在更新提示中展示：

```
desktop/changelogs/
├── 1.0.0.md
├── 1.1.0.md
└── latest.md
```

---

## 13. 分阶段实施计划

### 阶段零: 基础设施搭建

- [ ] 创建 R2 bucket `nexu-releases`
- [ ] 开启 R2 Public Access，绑定 `releases.nexu.space` 域名
- [ ] 配置 GitHub Secrets (R2 凭证)
- [ ] 手动上传一个测试文件验证访问

### 阶段一: 打包 + 全量更新 MVP

**打包**
- [ ] 安装 `electron-builder` + 配置 `electron-builder.yml`
- [ ] 配置 `extraResources` 打包所有 sidecar
- [ ] 修改 `manifests.ts`: 打包后从 `process.resourcesPath/sidecar/` 加载
- [ ] 本地测试 `pnpm build:dist` 生成 .dmg / .exe
- [ ] 确认安装后应用能正常启动所有 sidecar

**CI/CD**
- [ ] 创建 `.github/workflows/desktop-release.yml`
- [ ] 实现 tag → build → upload to R2 流程
- [ ] 测试一次完整发布流程

**客户端更新**
- [ ] 实现 `UpdateManager` (基于 electron-updater)
- [ ] 扩展 IPC + preload bridge
- [ ] 实现简单的更新 UI（顶部横幅: "有新版本 → 下载 → 重启"）
- [ ] 端到端测试: 安装 v1.0.0 → 发布 v1.0.1 → 客户端检测到更新 → 下载安装

### 阶段二: 代码签名

- [ ] 注册 Apple Developer Program ($99/yr)
- [ ] 生成 Developer ID Application 证书
- [ ] 配置 CI 签名 + Notarization
- [ ] (可选) Windows EV 证书

### 阶段三: 全组件独立更新

- [ ] 实现 `ComponentUpdater`（用 manifest.local.json 记录路径+sha256，不用 symlink）
- [ ] 修改 `manifests.ts`: 所有 sidecar 路径从 userData/components 加载
- [ ] 首次安装时从应用包 bootstrap 所有组件到 userData
- [ ] 创建 `component-release.yml` CI workflow（统一版本号，所有组件同时构建上传）
- [ ] 实现按 sha256 差异只下载变更的组件
- [ ] 实现组件更新后按依赖顺序重启对应 sidecar

### 阶段四: 增强

- [ ] Worker API 替换纯静态访问 (灰度/统计/强制更新)
- [ ] 数据迁移保护 (PGlite 备份 + 自动 migrate)
- [ ] 断点续传
- [ ] Beta/Canary 通道
- [ ] Changelog 展示
- [ ] Amplitude 埋点

---

## 14. 关键技术决策总结

| 决策点 | 推荐方案 | 理由 |
|--------|---------|------|
| 分发基础设施 | R2 Public Access (阶段零) → Worker (阶段四) | 最小起步成本 |
| 全量更新 | electron-updater + generic provider | 标准方案，支持差分 |
| 组件版本切换 | manifest.local.json 记录路径+sha256 | 跨平台兼容，不依赖 symlink |
| 组件版本策略 | 所有组件统一版本号，按 sha256 差异下载 | 避免版本不匹配，减少下载量 |
| 签名 | macOS 必签 (否则 Gatekeeper 拒绝) | Windows 可延后 |
| CI 触发 | git tag `v*` | 简单可靠 |
| 组件更新粒度 | 所有 sidecar 都支持组件更新 | 只有 Shell 变更才需全量更新 |
| 回滚 | 组件: 保留旧版本目录; 全量: 健康检查 + 提示重装 | 组件回滚简单，全量回滚困难 |

---

## 附录

### A. 需要新增的依赖

```bash
# apps/desktop
pnpm add electron-updater semver
pnpm add -D electron-builder @electron/notarize
```

### B. 需要新增的 GitHub Secrets

| Secret | 用途 |
|--------|------|
| `R2_ACCESS_KEY_ID` | Cloudflare R2 API Token |
| `R2_SECRET_ACCESS_KEY` | Cloudflare R2 Secret |
| `R2_ENDPOINT` | R2 S3 API endpoint |
| `MAC_CERTIFICATE_P12_BASE64` | macOS 开发者证书 (base64) |
| `MAC_CERTIFICATE_PASSWORD` | 证书密码 |
| `APPLE_ID` | Apple ID 邮箱 |
| `APPLE_APP_PASSWORD` | App-specific password |
| `APPLE_TEAM_ID` | Apple Team ID |
| `WIN_CERTIFICATE_P12_BASE64` | Windows 签名证书 (可选) |
| `WIN_CERTIFICATE_PASSWORD` | 证书密码 (可选) |
| `INTERNAL_API_TOKEN` | API 内部通信 token (推送通知用) |

### C. 现有 Cloudflare 资源

| 资源 | 名称 | 状态 |
|------|------|------|
| Tunnel | nexu-dev | ✅ 已有 |
| Worker | nexu-router | ✅ 已有 |
| Worker | nexu-landing-worker | ✅ 已有 |
| Worker | nexu-app-worker | ✅ 已有 |
| R2 Bucket | nexu-releases | ❌ 需创建 |
| Worker | nexu-releases-worker | ❌ 可选，后续按需创建 |
| Domain | releases.nexu.space | ❌ 需添加 DNS |
