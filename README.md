# Usage4Claude — Windows

A Windows system tray app that monitors your Claude AI subscription quota in real time.

> **Windows port of [f-is-h/Usage4Claude](https://github.com/f-is-h/Usage4Claude)** — the original macOS menu bar app by [@f-is-h](https://github.com/f-is-h). All credit for the concept, design, and API research goes to them.

| Dark Mode | Light Mode |
|:---------:|:----------:|
| ![Dark mode preview](docs/Screenshot%20(4).png) | ![Light mode preview](docs/Preview%204.jpeg) |

---

## Features

- **System tray icon** — progress ring showing current usage at a glance
- **Popup card** — dual-ring chart (5-Hour + 7-Day limits), per-model limits (Opus, Sonnet), extra usage, and reset times
- **Multi-account** — switch between Claude accounts from the tray
- **Browser login** — auto-captures your session key from claude.ai, no manual copy-paste
- **Smart refresh** — speeds up automatically when usage is high or reset is near
- **Notifications** — alerts at 90% usage and when your quota resets
- **Three icon modes** — combined ring+number, number only, ring only
- **Auto-updates** — new versions download in the background; restart to install
- **Windows DPAPI** — session keys encrypted at rest via Windows credential store

---

## Installation

### Option A — Download installer (recommended)

1. Download `Usage4Claude.Setup.<version>.exe` from the [latest release](https://github.com/SpillKernelX/Usage4Claude-Windows/releases/latest).
2. Double-click to run it. The installer is unsigned, so Windows SmartScreen
   will show **"Windows protected your PC"** on first run — click **More info → Run anyway**
   to proceed. This is the standard friction for indie apps without a paid code-signing certificate.
3. Once installed, future versions download automatically. When an update is
   ready, the tray menu shows **Restart to install vX.Y.Z** — pick that, or
   quit the app and reopen to apply.

### Option B — Run from source

```bash
git clone https://github.com/SpillKernelX/Usage4Claude-Windows.git
cd Usage4Claude-Windows
npm install
npm start
```

Source builds don't auto-update — `git pull && npm start` to refresh.

---

## Getting your session key

1. Open the app — it will prompt you to log in
2. Click **Log in with Browser** in Settings
3. Sign in to claude.ai in the window that opens
4. The app captures your session key automatically

---

## Credits

- **Original concept & macOS app** — [f-is-h/Usage4Claude](https://github.com/f-is-h/Usage4Claude) by [@f-is-h](https://github.com/f-is-h)
- **Windows port** — [@SpillKernelX](https://github.com/SpillKernelX)

---

## License

This project is a Windows port of an open-source macOS app. Please refer to the [original repository](https://github.com/f-is-h/Usage4Claude) for license terms.
