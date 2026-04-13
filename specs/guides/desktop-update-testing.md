# Desktop update testing guide

## When this applies

Use this guide when you are validating a locally built desktop installer (`local-dist`) and want to exercise the real desktop update flow on purpose.

Local validation builds do **not** use the production update feed by default. The UI will label them as `Local validation build` / `本地验收构建`.

## Windows update flow expectations

Windows checks a JSON manifest, then opens the installer URL declared in that manifest.

- Manifest shape: `latest-win.json`
- Expected feed path example: `https://desktop-releases.nexu.io/<channel>/win32/x64/latest-win.json`

## Opt into update testing

Before building the installer, set an explicit update feed URL:

### PowerShell

```powershell
$env:NEXU_UPDATE_FEED_URL = "https://desktop-releases.nexu.io/stable/win32/x64/latest-win.json"
pnpm --filter @nexu/desktop dist:win
```

### Mock/test feed

Point `NEXU_UPDATE_FEED_URL` at a test manifest you control. The feed should return:

- HTTP 200
- valid `latest-win.json`
- an `installer.url` that is reachable from the packaged app

## What to verify

1. The packaged app shows `Update test mode` / `更新测试模式`
2. Manual `Check for updates` succeeds
3. Update details show the expected version / notes
4. Clicking the installer action opens the expected `.exe`

## Common failures

### `404 Not Found`

The configured `NEXU_UPDATE_FEED_URL` does not exist, or the manifest was not uploaded to the expected channel path.

### Feed works but installer download fails

The manifest is valid, but `installer.url` is wrong, inaccessible, or points to an artifact that was not uploaded.
