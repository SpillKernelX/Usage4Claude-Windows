# Usage4Claude — Windows Port — Full Project Context

## What This Project Is

A Windows system tray app that monitors Claude AI subscription quota in real time.
It is a **Windows port** of the original macOS menu bar app [f-is-h/Usage4Claude](https://github.com/f-is-h/Usage4Claude).
The Windows version lives at: https://github.com/SpillKernelX/Usage4Claude-Windows

Built with **Electron + Node.js**. No React, no bundler — plain HTML/CSS/JS renderer files.

---

## Repository Layout

```
Usage4Claude/
├── main.js                        # Main Electron process — all app logic lives here
├── package.json                   # electron ^35, electron-builder ^26, electron-store ^8
├── icon.ico                       # App icon (PNG wrapped in ICO via PowerShell System.Drawing)
├── icon.png                       # Original macOS app icon (orange sparkle) — used in popup header
├── launch.vbs                     # Silent VBScript launcher for desktop shortcut (no console window)
├── check-upstream.ps1             # Manually triggers upstream-sync GitHub Actions workflow
├── check-upstream.vbs             # Silent VBScript launcher for check-upstream.ps1
├── release.ps1                    # One-command release: bumps version, tags, pushes → triggers CI
├── .upstream-version              # Tracks last-seen upstream commit/tag (e.g. "commit-90a1372")
├── .github/
│   └── workflows/
│       ├── release.yml            # Builds Windows NSIS installer on vX.Y.Z tag push
│       └── upstream-sync.yml      # Daily cron: checks f-is-h/Usage4Claude for changes, creates GitHub issue
├── docs/
│   ├── Screenshot (4).png         # Dark mode preview (used in README)
│   └── Preview 4.jpeg             # Light mode preview (used in README)
└── src/
    ├── popup.html                 # Tray popup UI — dark/light via CSS media query + nativeTheme
    ├── popup.js                   # Popup renderer — uses window.api (contextBridge)
    ├── settings.html              # Settings window — 5 tabs: Accounts, Display, Refresh, Notifications, Advanced
    ├── settings.js                # Settings renderer — uses window.api (contextBridge)
    ├── logs.html                  # Diagnostics window — log viewer + connection test
    ├── iconCanvas.html            # Offscreen canvas renderer for tray icon (loaded by trayIcon.js)
    ├── preload/
    │   ├── popup.js               # contextBridge preload for popup window
    │   ├── settings.js            # contextBridge preload for settings window
    │   └── logs.js                # contextBridge preload for logs window
    └── utils/
        ├── api.js                 # Claude API client (fetch-based, no extra deps)
        ├── config.js              # electron-store v8 settings + Windows DPAPI session key encryption
        └── trayIcon.js            # Offscreen BrowserWindow + canvas → nativeImage for tray icon
```

---

## Architecture

### Main Process (`main.js`)
All business logic runs here:
- **Tray**: created via `trayIcon.js` (offscreen canvas renderer)
- **Popup**: frameless transparent `alwaysOnTop` BrowserWindow, toggled by tray click
- **Settings**: normal BrowserWindow, opened from popup or tray right-click
- **Refresh loop**: `scheduleRefresh()` → `doRefresh()` → `api.fetchUsage()` → `updateTrayIcon()` + `sendStateToPopup()`
- **Smart refresh**: speeds up at ≥85%/≥70% usage or when reset is near
- **Notifications**: 90% threshold alerts + quota reset detection (timestamp change OR ≥30% pct drop)
- **Single instance**: `app.requestSingleInstanceLock()` — second launch shows popup on running instance

### Renderer Processes (Popup, Settings, Logs)
- All use `contextIsolation: true`, `nodeIntegration: false` + preload scripts
- Communicate with main via `window.api.*` methods exposed through `contextBridge`
- **Never** use `require('electron')` directly

### Tray Icon (`src/utils/trayIcon.js` + `src/iconCanvas.html`)
- Creates an offscreen `BrowserWindow` (64×64, `offscreen: true`, `contextIsolation: true`)
- Calls `window.drawIcon(opts)` via `executeJavaScript()` to render to canvas
- Returns `nativeImage` from the canvas data URL
- Three modes: `combined` (ring + number on gray badge), `percentage` (number only), `icon` (ring only)
- Cache keyed by JSON-stringified opts; invalidated by `clearCache()` on settings save

### Session Key Security
- Stored encrypted via **Windows DPAPI** (`safeStorage.encryptString` / `decryptString`)
- `encryptedKey` field is **never sent to renderer processes** — stripped in `settings-ready` IPC handler
- Session key flows: browser login → main process → org fetch → `config.addAccount()` → encrypted store

---

## IPC Channels

| Channel | Direction | Purpose |
|---|---|---|
| `popup-ready` | renderer→main | Popup loaded, request initial state |
| `state` | main→renderer | Push usage data to popup |
| `refresh` | renderer→main | Manual refresh request |
| `open-settings` | renderer→main | Open settings window |
| `open-logs` | renderer→main | Open diagnostics window |
| `show-context-menu` | renderer→main | Show tray right-click menu from popup |
| `settings-ready` | renderer→main | Settings loaded, request init data |
| `init` | main→renderer | Send settings + accounts to settings window |
| `browser-login` | renderer→main | Start browser login flow |
| `browser-login-result` | main→renderer | Result of browser login |
| `fetch-orgs` | renderer→main | Fetch Claude organizations for session key |
| `fetch-orgs-result` | main→renderer | Org list result |
| `save-settings` | renderer→main | Save settings + accounts |
| `close-settings` | renderer→main | Close settings window |
| `reset-all` | renderer→main | Wipe all accounts + settings |
| `logs` | main→renderer | Push log entries to diagnostics window |

---

## Settings Schema (validated in `main.js` `SETTINGS_SCHEMA`)

| Key | Type | Values |
|---|---|---|
| `displayMode` | string | `'combined'` \| `'percentage'` \| `'icon'` |
| `monochrome` | boolean | |
| `theme` | string | `'system'` \| `'light'` \| `'dark'` |
| `timeFormat` | string | `'system'` \| `'12h'` \| `'24h'` |
| `smartRefresh` | boolean | |
| `refreshInterval` | number | `1` \| `3` \| `5` \| `10` (minutes) |
| `notifyAt90` | boolean | |
| `notifyOnReset` | boolean | |
| `launchAtLogin` | boolean | |
| `checkUpdates` | boolean | |
| `updateRepo` | string | `''` or `owner/repo` pattern |
| `activeAccountIndex` | integer ≥ 0 | |

---

## Known Issues / Open Work

### ⚠ Bar appearing behind popup on focus loss (UNRESOLVED)
When the popup loses focus (user clicks elsewhere), a gray Windows title bar/chrome appears at the top of the popup window. Two fixes were attempted:
1. `thickFrame: false` on the BrowserWindow — did not fully resolve it
2. `hookWindowMessage(0x0086 /* WM_NCACTIVATE */)` with `setEnabled(false/true)` workaround — still appearing

**Root cause**: Windows DWM draws non-client area (caption bar) on transparent frameless windows when they become inactive. The `WM_NCACTIVATE` hook approach is correct in theory but the `setEnabled` trick isn't fully suppressing it in Electron 35.

**Things tried (all failed)**:
1. `thickFrame: false`
2. `hookWindowMessage(0x0086)` with `setEnabled(false/true)` workaround
3. `focusable: false` — window can never become inactive so WM_NCACTIVATE never fires (current attempt)

**Remaining things to try if focusable:false still fails**:
- Try `win.setBackgroundColor('#00000000')` explicitly
- Try replacing `transparent: true` with a solid bg workaround
- Try `type: 'toolbar'` BrowserWindow option (sets WS_EX_TOOLWINDOW)
- Try handling `WM_NCPAINT` (0x0085)

### Multi-account display
- Account switching works but requires a full refresh
- Alias editing is id-based (correct) — not index-based

---

## Security Hardening Applied

All the following were implemented and pushed:

1. **CRIT**: `contextIsolation: true` + `nodeIntegration: false` on all user-facing windows; preload scripts via `contextBridge`
2. **CRIT**: GitHub Actions workflow injection fixed — step outputs passed via `env:` vars, not `${{ }}` interpolation in script/shell bodies
3. **HIGH**: `disable-gpu-sandbox` removed
4. **HIGH**: `shell.openExternal` validates URL matches `https://github.com/*/releases*`
5. **HIGH**: `escapeHtml()` applied to API-sourced org/alias names before `innerHTML`
6. **MED**: `updateRepo` validated against `owner/repo` pattern before GitHub API fetch
7. **MED**: `orgId` validated as UUID-shaped (`/^[0-9a-f-]{36}$/i`) before API URL construction
8. **MED**: `SETTINGS_SCHEMA` allowlist — `save-settings` IPC validates every key + type
9. **LOW**: `encryptedKey` stripped from accounts before sending to renderer
10. **LOW**: CSP meta tags on all HTML files
11. **DEPS**: Upgraded electron 33→35, electron-builder 25→26 (resolved tar CVEs + ASAR integrity bypass)

---

## Claude API Details (`src/utils/api.js`)

- Base URL: `https://claude.ai/api/organizations`
- Auth: `Cookie: sessionKey=<sk-ant-sid01-...>` header
- Endpoints used:
  - `GET /api/organizations` — list orgs (for account setup)
  - `GET /api/organizations/{orgId}/usage` — fiveHour, sevenDay, opus, sonnet limits
  - `GET /api/organizations/{orgId}/overage_spend_limit` — extra usage / overage
- Response parsing: `parseLimit({ utilization, resets_at })` → `{ percentage, resetsAt }`
- Error classification: 401 → `AUTH`, 403 → `CLOUDFLARE`, HTML body → `CLOUDFLARE`, 429 → `RATE_LIMIT`

---

## Upstream Sync System

- **Daily cron** (`.github/workflows/upstream-sync.yml`): checks `f-is-h/Usage4Claude` for new releases/commits
- Compares against `.upstream-version` file in repo root
- If new version found: creates a labelled GitHub issue (`upstream-sync` label) with diff links and per-file review checklist
- Updates `.upstream-version` and commits it
- **Manual trigger**: double-click `check-upstream.vbs` shortcut → shows balloon notification → opens Actions page in browser
- This is a **review-only** workflow (no auto-merge) because Swift→JavaScript porting requires manual review

---

## Release Process

```powershell
.\release.ps1 -Version 1.1.0
```
This script:
1. Bumps `version` in `package.json`
2. Updates `CURRENT_VERSION` constant in `main.js`
3. Commits both
4. Tags `v1.1.0`
5. Pushes → triggers `.github/workflows/release.yml`
6. GitHub Actions builds Windows NSIS installer and creates a GitHub Release with `.exe` attached

---

## Desktop Shortcuts

Two shortcuts exist on the developer's desktop:
- **Usage4Claude**: runs `launch.vbs` → `cmd /c npx electron .` (silent, no console)
- **Check Upstream**: runs `check-upstream.vbs` → `check-upstream.ps1` → triggers GitHub Actions workflow + balloon notification

---

## Theme System

- CSS uses `@media (prefers-color-scheme: dark)` for dark/light theming
- `nativeTheme.themeSource` is set from `config.get('theme')` on startup AND on settings save
- Values: `'system'` (follows OS), `'light'` (force light), `'dark'` (force dark)
- This makes the CSS media query respond to the app setting, not just the OS setting

---

## Development Notes

- **electron-store v8** is used (not v9+) because v9+ is ESM-only and breaks CommonJS `require()`
- The offscreen icon renderer (`iconCanvas.html`) uses `executeJavaScript()` — not IPC — to call `window.drawIcon()`
- `positionPopup()` handles the case where `tray.getBounds()` returns a zero-rect (icon in Windows overflow tray) by falling back to center-above-taskbar on primary display
- `triggerRefresh()` has a 10-second debounce; `forceRefresh()` bypasses it (used after settings save, account switch)
- `check90Notifications()` uses a bucket key (`5h_90`, `7d_90` etc.) so re-notification only happens after a quota reset, not on percentage drop
- `checkResetNotifications()` detects reset via timestamp change OR ≥30% percentage drop (handles cases where API doesn't update the timestamp immediately)
