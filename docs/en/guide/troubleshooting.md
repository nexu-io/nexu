# Troubleshooting

## Issue 1: nexu Does Not Launch or Conflicts with OpenClaw

**Symptoms:** nexu does not respond after launch, crashes immediately, or reports that a port is already in use.

**Root Cause:** the OpenClaw background gateway service (`ai.openclaw.gateway`) is still occupying the required port, preventing nexu from starting correctly.

**Fix:**

1. Open Terminal and run the following commands one by one:

```bash
launchctl bootout gui/$(id -u)/ai.openclaw.gateway
rm ~/Library/LaunchAgents/ai.openclaw.gateway.plist
```

> The first command stops the OpenClaw gateway service immediately. The second removes the auto-start configuration so it does not conflict again after reboot.

2. Reopen nexu and confirm that it starts normally.

---

## Issue 2: "Nexu.app Is in Use" During Install or Update

**Symptoms:** macOS shows a message saying it cannot complete the action because `Nexu.app` is currently in use.

![Nexu.app is in use](/assets/nexu-app-in-use.webp)

**Root Cause:** nexu background processes are still running, so macOS cannot replace the old application bundle.

**Fix:**

1. Open Terminal and run the following command to stop all nexu-related processes:

```bash
curl -fsSL https://desktop-releases.nexu.io/scripts/kill-all.sh | bash
```

2. After the script finishes, reinstall nexu or drag the new `Nexu.app` into Applications again.

---

## Contact Support

If the issue still is not resolved, contact us through one of the following:

- **GitHub Issues:** [https://github.com/nexu-io/nexu/issues](https://github.com/nexu-io/nexu/issues)
- **Community:** [Contact Us](/guide/contact)
