const {
  app, BrowserWindow, Tray, Menu, ipcMain,
  nativeTheme, shell, Notification, screen, dialog,
  globalShortcut, powerMonitor,
} = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('node:path');
const fs   = require('node:fs');

// ── Single-instance lock ───────────────────────────────────────────────────
// If another instance is already running, focus its tray popup and quit.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

// Reduce Chromium disk cache pressure (avoids "Unable to move cache" errors)
app.commandLine.appendSwitch('disk-cache-size', '1');

const config = require('./src/utils/config');
const api    = require('./src/utils/api');
const { makeTrayIcon, clearCache } = require('./src/utils/trayIcon');

// ── State ─────────────────────────────────────────────────────────────────

let tray, popupWin, settingsWin, loginWin, logsWin;
let usageData = null;
let lastError = null;
let refreshTimer = null;
let updateInfo = null;
let logs = [];
let lastRefreshTime = 0;
let trayFlashTimer = null;
let trayFlashVisible = true;

// Per-account notification state — keyed by orgId to avoid cross-account false positives
const accountNotifyState = {}; // { [orgId]: { prevResetsAt, prevPct, notified90 } }

function getNotifyState(orgId) {
  if (!accountNotifyState[orgId]) {
    accountNotifyState[orgId] = { prevResetsAt: {}, prevPct: {}, notified90: new Set() };
  }
  return accountNotifyState[orgId];
}

// ── Constants ─────────────────────────────────────────────────────────────

const CURRENT_VERSION = '1.0.1';
const MAX_HISTORY = 30;             // sparkline data points
const DEBOUNCE_MS = 10_000;         // minimum interval between manual refreshes
const MAX_LOG_ENTRIES = 500;        // circular log buffer size
const SMART_REFRESH_HIGH_PCT = 85;  // speed up refresh above this %
const SMART_REFRESH_MID_PCT = 70;   // moderate speed-up above this %
const SMART_REFRESH_NEAR_RESET = 600;   // seconds — <10 min to reset
const SMART_REFRESH_MID_RESET = 1800;   // seconds — <30 min to reset
const UPDATE_CHECK_INTERVAL = 6 * 60 * 60 * 1000; // 6 hours

// Per-account usage history for sparkline — keyed by orgId
const usageHistoryByAccount = {};
let activeOrgIdForHistory = null; // tracks which account's history to send

// ── App lifecycle ─────────────────────────────────────────────────────────

// When a second launch is attempted, show the popup on the already-running instance
app.on('second-instance', () => {
  if (tray) togglePopup();
});

app.whenReady().then(async () => {
  app.setAppUserModelId('com.usage4claude.app');
  nativeTheme.themeSource = config.get('theme') || 'system';
  await createTray();
  registerGlobalHotkey();
  scheduleRefresh(500);           // initial fetch
  scheduleWeeklySummary();        // weekly Telegram digest
  setupAutoUpdater();
  if (config.get('checkUpdates')) {
    checkUpdates();
    // Re-check every 6 hours while running
    setInterval(() => checkUpdates(), UPDATE_CHECK_INTERVAL);
  }

  // Refresh shortly after system wake / screen unlock — data is almost
  // always stale after sleep, and the timer fires unpredictably (upstream v3.0.0).
  // forceRefresh() bypasses the 10s debounce so it always fires.
  powerMonitor.on('resume', () => {
    addLog('INFO', 'System resumed from sleep — refreshing usage.');
    forceRefresh();
  });
  powerMonitor.on('unlock-screen', () => {
    addLog('INFO', 'Screen unlocked — refreshing usage.');
    forceRefresh();
  });
});

app.on('window-all-closed', e => e.preventDefault()); // keep alive in tray

// ── Global hotkey ─────────────────────────────────────────────────────────

function registerGlobalHotkey() {
  globalShortcut.unregisterAll();
  const hotkey = config.get('globalHotkey');
  if (!hotkey) return;
  try {
    globalShortcut.register(hotkey, () => togglePopup());
    addLog('INFO', `Global hotkey registered: ${hotkey}`);
  } catch (e) {
    addLog('WARN', `Failed to register hotkey "${hotkey}": ${e.message}`);
  }
}

app.on('will-quit', () => globalShortcut.unregisterAll());

// ── Tray ──────────────────────────────────────────────────────────────────

async function createTray() {
  let loadingIcon;
  try {
    loadingIcon = await makeTrayIcon({ pct: null });
  } catch (e) {
    // Fallback: 1×1 transparent PNG so the tray still appears
    const { nativeImage } = require('electron');
    loadingIcon = nativeImage.createEmpty();
  }
  tray = new Tray(loadingIcon);
  tray.setToolTip('Claude Usage — loading…');
  tray.on('click', togglePopup);
  tray.on('right-click', () => tray.popUpContextMenu(buildContextMenu()));
}

function updateTrayIcon() {
  const mode = config.get('displayMode') || 'combined';
  const mono = config.get('monochrome') || false;
  const pct  = usageData?.fiveHour?.percentage ?? usageData?.sevenDay?.percentage ?? null;
  makeTrayIcon({ pct, error: !!lastError && !usageData, monochrome: mono, mode })
    .then(img => {
      if (tray && !tray.isDestroyed()) {
        tray.setImage(img);
        tray.setToolTip(buildTooltip());
      }
    })
    .catch(() => {});

  // Flash tray icon when any limit is ≥90%
  const anyHigh = usageData && [usageData.fiveHour, usageData.sevenDay, usageData.opus, usageData.sonnet]
    .some(d => d && d.percentage >= 90);
  if (anyHigh && !trayFlashTimer) {
    startTrayFlash();
  } else if (!anyHigh && trayFlashTimer) {
    stopTrayFlash();
  }
}

function startTrayFlash() {
  if (trayFlashTimer) return;
  trayFlashVisible = true;
  const { nativeImage } = require('electron');
  const emptyIcon = nativeImage.createEmpty();
  trayFlashTimer = setInterval(() => {
    if (!tray || tray.isDestroyed()) { stopTrayFlash(); return; }
    trayFlashVisible = !trayFlashVisible;
    if (trayFlashVisible) {
      updateTrayIconImage(); // restore real icon
    } else {
      tray.setImage(emptyIcon);
    }
  }, 800);
}

function stopTrayFlash() {
  if (trayFlashTimer) { clearInterval(trayFlashTimer); trayFlashTimer = null; }
  trayFlashVisible = true;
  updateTrayIconImage(); // restore real icon
}

function updateTrayIconImage() {
  const mode = config.get('displayMode') || 'combined';
  const mono = config.get('monochrome') || false;
  const pct  = usageData?.fiveHour?.percentage ?? usageData?.sevenDay?.percentage ?? null;
  makeTrayIcon({ pct, error: !!lastError && !usageData, monochrome: mono, mode })
    .then(img => { if (tray && !tray.isDestroyed()) tray.setImage(img); })
    .catch(() => {});
}

function buildTooltip() {
  if (lastError && !usageData) return `Claude Usage — ${lastError}`;
  if (!usageData) return 'Claude Usage — loading…';
  const parts = [];
  if (usageData.fiveHour) parts.push(`5H: ${Math.round(usageData.fiveHour.percentage)}%`);
  if (usageData.sevenDay)  parts.push(`7D: ${Math.round(usageData.sevenDay.percentage)}%`);
  if (usageData.opus)      parts.push(`Opus: ${Math.round(usageData.opus.percentage)}%`);
  if (usageData.sonnet)    parts.push(`Sonnet: ${Math.round(usageData.sonnet.percentage)}%`);
  // Include active account name for multi-account users
  const acc = config.getActiveAccount();
  const accountLabel = config.getAccounts().length > 1 && acc
    ? ` (${acc.alias || acc.orgName || 'Account'})`
    : '';
  return 'Claude Usage — ' + (parts.join('  ') || 'No data') + accountLabel;
}

function buildContextMenu() {
  const accountItems = config.getAccounts().map((acc, i) => ({
    label: (i === (config.get('activeAccountIndex') || 0) ? '● ' : '○ ') +
           (acc.alias || acc.orgName || `Account ${i + 1}`),
    click: () => { config.switchAccount(i); forceRefresh(); },
  }));

  const items = [
    { label: 'Claude Usage', enabled: false },
    { type: 'separator' },
    ...accountItems,
    ...(accountItems.length ? [{ type: 'separator' }] : []),
    { label: 'Refresh Now',         click: triggerRefresh },
    { label: 'Open Usage Page',     click: () => shell.openExternal('https://claude.ai/settings/usage') },
    { type: 'separator' },
    { label: 'Settings…',           click: openSettings },
    { label: 'Diagnostics…',        click: openLogs },
    { label: 'Check for Updates',   click: () => checkUpdates(true) },
    ...(updateInfo?.ready ? [
      { type: 'separator' },
      { label: `Restart to install v${updateInfo.version}`,
        click: () => autoUpdater.quitAndInstall() },
    ] : []),
    { type: 'separator' },
    { label: 'Quit', click: () => app.exit(0) },
  ];
  return Menu.buildFromTemplate(items);
}

// ── Popup window ──────────────────────────────────────────────────────────

function createPopup() {
  popupWin = new BrowserWindow({
    width: 336, height: 480,
    show: false,
    frame: false,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    transparent: true,
    icon: path.join(__dirname, 'icon.ico'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'src/preload/popup.js'),
    },
  });
  popupWin.loadFile(path.join(__dirname, 'src/popup.html'));
  popupWin.on('blur', () => {
    if (popupWin && !popupWin.isDestroyed() && !config.get('pinPopup')) popupWin.hide();
  });
  popupWin.on('closed', () => { popupWin = null; });
}

function togglePopup() {
  if (!popupWin || popupWin.isDestroyed()) createPopup();
  if (!popupWin || popupWin.isDestroyed()) return;
  if (popupWin.isVisible()) {
    popupWin.hide();
    return;
  }
  positionPopup();
  popupWin.show();
  popupWin.focus();
  sendStateToPopup();
}

function positionPopup() {
  const trayBounds = tray.getBounds();
  const winBounds  = popupWin.getBounds();

  // Fall back to primary display if tray is in overflow area (getBounds returns zero-rect) (M1)
  const refPoint = (trayBounds.width === 0 && trayBounds.height === 0)
    ? screen.getPrimaryDisplay().workArea
    : { x: trayBounds.x, y: trayBounds.y };

  const display  = screen.getDisplayNearestPoint(refPoint);
  const workArea = display.workArea;

  let x, y;
  if (trayBounds.width === 0 && trayBounds.height === 0) {
    // Center above taskbar on primary display
    x = Math.round(workArea.x + workArea.width / 2 - winBounds.width / 2);
    y = Math.round(workArea.y + workArea.height - winBounds.height - 8);
  } else {
    x = Math.round(trayBounds.x + trayBounds.width / 2 - winBounds.width / 2);
    const taskbarAtBottom = trayBounds.y > workArea.y + workArea.height / 2;
    y = taskbarAtBottom
      ? Math.round(trayBounds.y - winBounds.height - 8)
      : Math.round(trayBounds.y + trayBounds.height + 8);
  }

  // Keep on-screen
  x = Math.max(workArea.x + 4, Math.min(x, workArea.x + workArea.width - winBounds.width - 4));
  y = Math.max(workArea.y + 4, Math.min(y, workArea.y + workArea.height - winBounds.height - 4));

  popupWin.setPosition(x, y, false);
}

function sendStateToPopup() {
  if (!popupWin || !popupWin.isVisible()) return;
  const acc = config.getActiveAccount();
  const orgId = acc?.orgId;
  popupWin.webContents.send('state', {
    usage: usageData,
    error: lastError,
    account: acc ? { alias: acc.alias, orgName: acc.orgName, orgId } : null,
    multiAccount: config.getAccounts().length > 1,
    lastFetched: usageData?.fetchedAt || null,
    timeFormat: config.get('timeFormat') || 'system',
    showRemaining: config.get('showRemainingMode') || false,
    history: orgId ? (usageHistoryByAccount[orgId] || []) : [],
    needsReauth: orgId ? (getNotifyState(orgId).authFailCount >= 3) : false,
    notificationsPausedUntil: config.get('notificationsPausedUntil') || 0,
    compactMode: config.get('compactMode') || false,
    pinPopup: config.get('pinPopup') || false,
  });
}

// ── Settings window ───────────────────────────────────────────────────────

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 520, height: 620,
    minWidth: 460, minHeight: 520,
    title: 'Usage4Claude — Settings',
    icon: path.join(__dirname, 'icon.ico'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'src/preload/settings.js'),
    },
  });
  settingsWin.loadFile(path.join(__dirname, 'src/settings.html'));
  settingsWin.on('closed', () => { settingsWin = null; });
}

function openLogs() {
  if (logsWin && !logsWin.isDestroyed()) { logsWin.focus(); return; }
  logsWin = new BrowserWindow({
    width: 700, height: 480,
    title: 'Diagnostics — Usage4Claude',
    icon: path.join(__dirname, 'icon.ico'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'src/preload/logs.js'),
    },
  });
  logsWin.loadFile(path.join(__dirname, 'src/logs.html'));
  logsWin.webContents.once('dom-ready', () =>
    logsWin.webContents.send('logs', logs));
  logsWin.on('closed', () => { logsWin = null; });
}

// ── Refresh logic ─────────────────────────────────────────────────────────

function triggerRefresh() {
  const now = Date.now();
  if (now - lastRefreshTime < DEBOUNCE_MS) return;
  lastRefreshTime = now; // set immediately so concurrent calls are blocked (H6)
  if (refreshTimer) clearTimeout(refreshTimer);
  doRefresh();
}

function forceRefresh() {
  lastRefreshTime = 0; // bypass debounce for intentional user actions
  triggerRefresh();
}

function scheduleRefresh(delayMs) {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(doRefresh, delayMs);
}

async function doRefresh() {
  if (!config.hasCredentials()) {
    lastError = 'Not configured';
    updateTrayIcon();
    if (popupWin?.isVisible()) sendStateToPopup();
    openSettings();
    return;
  }

  lastError = null;
  const acc = config.getActiveAccount();
  const sk  = config.getSessionKey(acc);
  activeOrgIdForHistory = acc.orgId;
  addLog('INFO', `Refreshing usage for '${acc.alias || acc.orgName}'…`);

  try {
    const data = await api.fetchUsage(sk, acc.orgId);
    checkResetNotifications(data);
    usageData = data;
    check90Notifications(data);
    addLog('INFO', `Usage fetched — primary: ${Math.round(data.fiveHour?.percentage ?? data.sevenDay?.percentage ?? 0)}%`);

    // Record per-account history for sparkline
    const pct = data.fiveHour?.percentage ?? data.sevenDay?.percentage ?? null;
    if (pct !== null) {
      if (!usageHistoryByAccount[acc.orgId]) usageHistoryByAccount[acc.orgId] = [];
      const hist = usageHistoryByAccount[acc.orgId];
      hist.push(Math.round(pct));
      if (hist.length > MAX_HISTORY) hist.shift();
    }

    // Track consecutive auth failures — reset on success
    const ns = getNotifyState(acc.orgId);
    ns.authFailCount = 0;
  } catch (err) {
    lastError = err.message;
    addLog('ERROR', err.message);
    if (err.code === 'AUTH') {
      // Track consecutive auth failures for session expiry warning
      const ns = getNotifyState(acc.orgId);
      ns.authFailCount = (ns.authFailCount || 0) + 1;
      if (ns.authFailCount >= 3 && !ns.authWarned) {
        ns.authWarned = true;
        notify('Claude Usage — Session Expired', `Re-authenticate '${acc.alias || acc.orgName}' in Settings.`);
        sendTelegramNotification(`Claude session expired for '${acc.alias || acc.orgName}' — please re-auth in app.`);
      }
    }
  }

  updateTrayIcon();
  if (popupWin?.isVisible()) sendStateToPopup();
  scheduleRefresh(computeInterval() * 1000);
}

function computeInterval() {
  const base = (config.get('refreshInterval') || 3) * 60;
  if (!config.get('smartRefresh') || !usageData) return base;
  const primary = usageData.fiveHour || usageData.sevenDay;
  if (!primary) return base;
  const pct = primary.percentage;
  const secs = primary.resetsAt ? (new Date(primary.resetsAt) - Date.now()) / 1000 : null;

  // Auto-pause: if usage just reset (≤2%), slow down to save API calls
  if (pct <= 2 && secs !== null && secs > SMART_REFRESH_MID_RESET) return Math.max(base, 600); // 10 min minimum

  if (pct >= SMART_REFRESH_HIGH_PCT || (secs !== null && secs < SMART_REFRESH_NEAR_RESET))  return 60;
  if (pct >= SMART_REFRESH_MID_PCT || (secs !== null && secs < SMART_REFRESH_MID_RESET)) return Math.min(base, 180);
  return base;
}

// ── Notifications ─────────────────────────────────────────────────────────

function notify(title, body) {
  addLog('INFO', `Notification: ${title} — ${body}`);
  if (Notification.isSupported()) new Notification({ title, body }).show();
}

async function sendTelegramNotification(msg) {
  const token  = config.get('telegramBotToken');
  const chatId = config.get('telegramChatId');
  if (!token || !chatId) return;
  try {
    // JSON.stringify handles escaping of special chars in the text field
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: String(msg) }),
    });
    const data = await res.json();
    if (!data.ok) addLog('WARN', `Telegram notification failed: ${data.description || res.status}`);
  } catch (e) {
    addLog('WARN', `Telegram notification error: ${e.message}`);
  }
}

function isNotificationsPaused() {
  const until = config.get('notificationsPausedUntil') || 0;
  if (until && Date.now() < until) return true;
  if (until && Date.now() >= until) config.set('notificationsPausedUntil', 0); // auto-clear
  return false;
}

function check90Notifications(usage) {
  if (!config.get('notifyAt90') || isNotificationsPaused()) return;
  const acc = config.getActiveAccount();
  if (!acc) return;
  const ns = getNotifyState(acc.orgId);

  // Per-limit mute list (from settings)
  const mutedLimits = config.get('mutedLimits') || [];

  // 7-day limits get an earlier 75% warning (aligned with upstream v2.6.0 / official behavior)
  const sevenDayKeys = new Set(['7d', 'opus', 'sonnet']);

  [['5h', usage.fiveHour], ['7d', usage.sevenDay], ['opus', usage.opus], ['sonnet', usage.sonnet]]
    .forEach(([key, data]) => {
      if (!data) return;
      if (mutedLimits.includes(key)) return; // skip muted limits

      const threshold = sevenDayKeys.has(key) ? 75 : 90;

      if (data.percentage >= threshold) {
        const bucket = `${key}_${Math.floor(data.percentage / 10) * 10}`;
        if (!ns.notified90.has(bucket)) {
          ns.notified90.add(bucket);
          notify('Claude Usage Warning', `${key.toUpperCase()} usage is at ${Math.round(data.percentage)}%!`);
          sendTelegramNotification(`Claude ${key.toUpperCase()} usage at ${Math.round(data.percentage)}% — quota nearly full.`);
        }
      }
      // Note: notified90 entries are only cleared on actual reset (in checkResetNotifications),
      // not on percentage drop — prevents re-notification within the same quota period (H5)
    });
}

function checkResetNotifications(usage) {
  if (!config.get('notifyOnReset') || isNotificationsPaused()) return;
  const acc = config.getActiveAccount();
  if (!acc) return;
  const ns = getNotifyState(acc.orgId);

  [['5h', usage.fiveHour], ['7d', usage.sevenDay], ['opus', usage.opus], ['sonnet', usage.sonnet]]
    .forEach(([key, data]) => {
      if (!data) return;
      const prevReset = ns.prevResetsAt[key];
      const prevP     = ns.prevPct[key] ?? null;
      const curr      = data.resetsAt ? new Date(data.resetsAt) : null;
      const pct       = data.percentage;

      // Detect reset via timestamp advancing ≥30 min (real reset moves it ~5h forward;
      // API jitter only changes it by seconds) OR ≥30% percentage drop
      const prevResetMs    = prevReset ? new Date(prevReset).getTime() : null;
      const timestampReset = prevResetMs !== null && curr !== null &&
        curr.getTime() - prevResetMs > 30 * 60 * 1000;
      const pctDrop = prevP !== null && prevP - pct >= 30;

      if (timestampReset || pctDrop) {
        notify('Claude Quota Reset', `${key.toUpperCase()} quota has reset — ${Math.round(pct)}% used.`);
        // Telegram only fires on confirmed timestamp advance — pctDrop alone is too unreliable
        if (timestampReset) {
          const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          sendTelegramNotification(`Claude ${key.toUpperCase()} quota reset at ${time} — your allowance has refreshed.`);
        }
        for (const k of [...ns.notified90]) if (k.startsWith(`${key}_`)) ns.notified90.delete(k);
      }
      ns.prevResetsAt[key] = data.resetsAt;
      ns.prevPct[key] = pct;
    });
}

// ── Update checker (electron-updater) ─────────────────────────────────────
//
// electron-updater reads `latest.yml` from the GitHub release matching
// our package.json `build.publish` config. Auto-download is on; the
// installer runs when the user picks "Restart to install" from the tray
// or when the app quits naturally (autoInstallOnAppQuit).

function setupAutoUpdater() {
  // Pipe updater logs into the in-app Diagnostics window
  autoUpdater.logger = {
    info:  m => addLog('INFO',  `[updater] ${m}`),
    warn:  m => addLog('WARN',  `[updater] ${m}`),
    error: m => addLog('ERROR', `[updater] ${typeof m === 'object' ? m.message || String(m) : m}`),
    debug: () => {},
  };
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available',     info => addLog('INFO', `Update available: v${info.version} — downloading…`));
  autoUpdater.on('update-not-available', info => addLog('INFO', `Up to date (v${info.version}).`));
  autoUpdater.on('download-progress',    p    => addLog('INFO', `Downloading update: ${Math.round(p.percent)}%`));
  autoUpdater.on('update-downloaded', info => {
    updateInfo = { version: info.version, ready: true };
    notify('Usage4Claude — Update Ready',
      `v${info.version} will install when you quit, or pick "Restart to install" from the tray menu.`);
  });
  autoUpdater.on('error', err => addLog('ERROR', `Updater error: ${err.message}`));
}

async function checkUpdates(manual = false) {
  // Skip when running from source — autoUpdater can't resolve a release file
  // for an unpackaged build and would just log a 'no latest.yml' error.
  if (!app.isPackaged) {
    if (manual) notify('Usage4Claude', 'Update check skipped (running from source).');
    return;
  }
  try {
    const result = await autoUpdater.checkForUpdates();
    // If no newer version was found, show a confirmation only on manual checks
    if (manual && result?.updateInfo && !result.downloadPromise) {
      notify('Usage4Claude', `You're up to date (v${CURRENT_VERSION}).`);
    }
  } catch (e) {
    if (manual) notify('Usage4Claude', `Update check failed: ${e.message}`);
  }
}

// ── Weekly summary ────────────────────────────────────────────────────────

function scheduleWeeklySummary() {
  // Check every hour if it's Sunday 8 PM local and we haven't sent this week
  setInterval(() => {
    const now = new Date();
    if (now.getDay() !== 0 || now.getHours() !== 20) return; // Sunday 8 PM
    const token = config.get('telegramBotToken');
    const chatId = config.get('telegramChatId');
    if (!token || !chatId) return;

    const weekKey = `${now.getFullYear()}-W${Math.ceil(now.getDate() / 7)}`;
    const lastSent = config.get('_lastWeeklySummary');
    if (lastSent === weekKey) return;
    config.set('_lastWeeklySummary', weekKey);

    const acc = config.getActiveAccount();
    if (!acc) return;
    const hist = usageHistoryByAccount[acc.orgId] || [];
    if (hist.length < 2) return;

    const avg = Math.round(hist.reduce((a, b) => a + b, 0) / hist.length);
    const peak = Math.max(...hist);
    const latest = hist[hist.length - 1];
    const msg = [
      `📊 Weekly Usage Summary — ${acc.alias || acc.orgName}`,
      `Current: ${latest}%  |  Average: ${avg}%  |  Peak: ${peak}%`,
      `Data points: ${hist.length}`,
    ].join('\n');
    sendTelegramNotification(msg);
    addLog('INFO', 'Weekly summary sent to Telegram.');
  }, 60 * 60 * 1000); // check hourly
}

// ── Browser login ─────────────────────────────────────────────────────────

function startBrowserLogin(resolve) {
  if (loginWin && !loginWin.isDestroyed()) { loginWin.focus(); return; }

  loginWin = new BrowserWindow({
    width: 960, height: 720,
    title: 'Log in to Claude — Usage4Claude',
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });

  loginWin.loadURL('https://claude.ai/login');

  // Poll for the sessionKey cookie every second
  const interval = setInterval(async () => {
    if (!loginWin || loginWin.isDestroyed()) {
      clearInterval(interval);
      resolve({ status: 'cancelled' });
      return;
    }
    try {
      const cookies = await loginWin.webContents.session.cookies.get({
        name: 'sessionKey',
        domain: 'claude.ai',
      });
      const valid = cookies.find(c => c.value?.includes('sk-ant-'));
      if (valid) {
        clearInterval(interval);
        const sessionKey = valid.value;
        loginWin.close();
        addLog('INFO', 'Browser login: session key captured.');
        resolve({ status: 'ok', sessionKey });
      }
    } catch {}
  }, 1000);

  loginWin.on('closed', () => {
    clearInterval(interval);
    loginWin = null;
  });
}

// ── Diagnostics ───────────────────────────────────────────────────────────

function addLog(level, msg) {
  const entry = { ts: new Date().toISOString(), level, msg };
  logs.push(entry);
  if (logs.length > MAX_LOG_ENTRIES) logs.shift();
}

// ── Settings schema — allowlist for save-settings IPC (MED-4) ─────────────

const SETTINGS_SCHEMA = {
  displayMode:        v => ['combined', 'percentage', 'icon'].includes(v),
  monochrome:         v => typeof v === 'boolean',
  theme:              v => ['system', 'light', 'dark'].includes(v),
  timeFormat:         v => ['system', '12h', '24h'].includes(v),
  smartRefresh:       v => typeof v === 'boolean',
  refreshInterval:    v => [1, 3, 5, 10].includes(v),
  notifyAt90:         v => typeof v === 'boolean',
  notifyOnReset:      v => typeof v === 'boolean',
  mutedLimits:        v => Array.isArray(v) && v.every(x => ['5h', '7d', 'opus', 'sonnet'].includes(x)),
  telegramBotToken:   v => typeof v === 'string' && (v === '' || /^\d+:[A-Za-z0-9_-]+$/.test(v)),
  telegramChatId:     v => typeof v === 'string' && (v === '' || /^-?\d+$/.test(v)),
  launchAtLogin:      v => typeof v === 'boolean',
  checkUpdates:       v => typeof v === 'boolean',
  activeAccountIndex: v => Number.isInteger(v) && v >= 0,
  showRemainingMode:  v => typeof v === 'boolean',
  notificationsPausedUntil: v => typeof v === 'number' && v >= 0,
  compactMode: v => typeof v === 'boolean',
  globalHotkey: v => typeof v === 'string' && v.length <= 50,
  pinPopup: v => typeof v === 'boolean',
};

// ── IPC handlers ──────────────────────────────────────────────────────────

ipcMain.on('popup-ready', e => {
  sendStateToPopup();
});

ipcMain.on('refresh', () => triggerRefresh());

ipcMain.on('open-settings', () => openSettings());
ipcMain.on('show-context-menu', () => tray.popUpContextMenu(buildContextMenu()));
ipcMain.on('hide-popup', () => {
  if (popupWin && !popupWin.isDestroyed()) popupWin.hide();
});

ipcMain.on('set-show-remaining', (_e, val) => {
  if (typeof val === 'boolean') config.set('showRemainingMode', val);
});

ipcMain.on('set-pin-popup', (_e, val) => {
  if (typeof val === 'boolean') {
    config.set('pinPopup', val);
    if (popupWin?.isVisible()) sendStateToPopup();
  }
});

ipcMain.on('set-compact-mode', (_e, val) => {
  if (typeof val === 'boolean') {
    config.set('compactMode', val);
    if (popupWin?.isVisible()) sendStateToPopup();
  }
});

ipcMain.on('pause-notifications', (_e, durationMs) => {
  if (typeof durationMs === 'number' && durationMs > 0 && durationMs <= 14400000) { // max 4h
    config.set('notificationsPausedUntil', Date.now() + durationMs);
    addLog('INFO', `Notifications paused for ${Math.round(durationMs / 60000)} minutes.`);
  } else if (durationMs === 0) {
    config.set('notificationsPausedUntil', 0);
    addLog('INFO', 'Notifications resumed.');
  }
  if (popupWin?.isVisible()) sendStateToPopup();
});

ipcMain.on('settings-ready', e => {
  // Strip accounts (with encryptedKey) from the settings object (LOW-3)
  const { accounts: _accts, ...safeSettings } = config.getAll();
  const safeAccounts = config.getAccounts().map(({ encryptedKey: _, ...rest }) => rest);
  e.sender.send('init', { settings: safeSettings, accounts: safeAccounts });
});

ipcMain.handle('browser-login', () => new Promise((resolve) => {
  startBrowserLogin(resolve);
}));

ipcMain.handle('fetch-orgs', async (_e, sk) => {
  try {
    const orgs = await api.fetchOrganizations(sk);
    return { orgs };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.on('save-settings', (_e, { settings: newSettings, accounts }) => {
  // Only write keys that pass schema validation — reject unknown/malformed values (MED-4)
  Object.entries(newSettings).forEach(([k, v]) => {
    if (SETTINGS_SCHEMA[k]?.(v)) config.set(k, v);
  });

  // Reconcile accounts (handle new accounts with _newKey)
  const existingBefore = config.getAccounts();
  const savedIds = new Set();

  accounts.forEach(acc => {
    if (acc._newKey) {
      const added = config.addAccount({
        sessionKey: acc._newKey,
        orgId: acc.orgId,
        orgName: acc.orgName,
        alias: acc.alias,
      });
      if (added?.id) savedIds.add(added.id);
    } else {
      if (acc.id) savedIds.add(acc.id);
      // Update alias using id-based lookup on the current store (H3: avoid stale snapshot index)
      const current = config.getAccounts();
      const idx = current.findIndex(e => e.id === acc.id);
      if (idx !== -1) config.updateAccountAlias(idx, acc.alias);
    }
  });

  // Remove accounts not in the saved set — iterate in reverse to avoid index shifting (C1)
  const finalAccounts = config.getAccounts();
  for (let i = finalAccounts.length - 1; i >= 0; i--) {
    if (!savedIds.has(finalAccounts[i].id)) config.removeAccount(i);
  }

  config.set('launchAtLogin', newSettings.launchAtLogin);
  app.setLoginItemSettings({ openAtLogin: newSettings.launchAtLogin });

  nativeTheme.themeSource = newSettings.theme || 'system';
  registerGlobalHotkey(); // re-register in case hotkey changed
  clearCache(); // invalidate icon cache when display settings may have changed (H2)
  updateTrayIcon(); // apply new display mode immediately without waiting for network
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.close();
  // Debounced refresh after save — avoids hammering API on rapid settings changes
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => forceRefresh(), 500);
});

ipcMain.on('close-settings', () => {
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.close();
});

ipcMain.on('reset-all', () => {
  const n = config.getAccounts().length;
  for (let i = n - 1; i >= 0; i--) config.removeAccount(i);
  Object.keys(accountNotifyState).forEach(k => delete accountNotifyState[k]);
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.close();
  usageData = null;
  lastError = null;
  lastRefreshTime = 0;
  Object.keys(usageHistoryByAccount).forEach(k => delete usageHistoryByAccount[k]);
  updateTrayIcon();
  openSettings();
});

ipcMain.on('open-logs', () => openLogs());

ipcMain.handle('telegram-test', async (_e, token, chatId) => {
  if (typeof token !== 'string' || !/^\d+:[A-Za-z0-9_-]+$/.test(token)) return { error: 'Invalid token format' };
  if (typeof chatId !== 'string' || !/^-?\d+$/.test(chatId)) return { error: 'Invalid chat ID format' };
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: 'Test from Usage4Claude — notifications are working!' }),
    });
    const data = await res.json();
    if (data.ok) return { ok: true };
    return { error: data.description || 'Unknown error' };
  } catch (e) {
    return { error: e.message };
  }
});

// ── Export / Import settings ──────────────────────────────────────────────

ipcMain.handle('export-settings', async () => {
  const result = await dialog.showSaveDialog(settingsWin || undefined, {
    title: 'Export Settings',
    defaultPath: 'usage4claude-settings.json',
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (result.canceled) return { canceled: true };
  try {
    const { accounts: rawAccounts, ...settings } = config.getAll();
    // Strip encrypted keys — export only safe account metadata
    const accounts = rawAccounts.map(({ encryptedKey: _, ...rest }) => rest);
    const data = { settings, accounts, exportedAt: new Date().toISOString(), version: CURRENT_VERSION };
    fs.writeFileSync(result.filePath, JSON.stringify(data, null, 2), 'utf-8');
    return { ok: true, path: result.filePath };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('import-settings', async () => {
  const result = await dialog.showOpenDialog(settingsWin || undefined, {
    title: 'Import Settings',
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['openFile'],
  });
  if (result.canceled) return { canceled: true };
  try {
    const raw = fs.readFileSync(result.filePaths[0], 'utf-8');
    const data = JSON.parse(raw);
    if (!data.settings) return { error: 'Invalid settings file — missing settings object.' };
    // Apply settings through schema validation
    Object.entries(data.settings).forEach(([k, v]) => {
      if (SETTINGS_SCHEMA[k]?.(v)) config.set(k, v);
    });
    addLog('INFO', `Settings imported from ${result.filePaths[0]}`);
    return { ok: true };
  } catch (e) {
    return { error: e.message };
  }
});
