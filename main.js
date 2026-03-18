const {
  app, BrowserWindow, Tray, Menu, ipcMain,
  nativeTheme, shell, Notification, screen,
} = require('electron');
const path = require('path');

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
const prevResetsAt = {};
const prevPct = {};
const notified90 = new Set();
let lastRefreshTime = 0;

const CURRENT_VERSION = '1.0.0';

// ── App lifecycle ─────────────────────────────────────────────────────────

// When a second launch is attempted, show the popup on the already-running instance
app.on('second-instance', () => {
  if (tray) togglePopup();
});

app.whenReady().then(async () => {
  app.setAppUserModelId('com.usage4claude.app');
  nativeTheme.themeSource = config.get('theme') || 'system';
  await createTray();
  scheduleRefresh(500);           // initial fetch
  if (config.get('checkUpdates')) checkUpdates();
});

app.on('window-all-closed', e => e.preventDefault()); // keep alive in tray

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
}

function buildTooltip() {
  if (lastError && !usageData) return `Claude Usage — ${lastError}`;
  if (!usageData) return 'Claude Usage — loading…';
  const parts = [];
  if (usageData.fiveHour) parts.push(`5H: ${Math.round(usageData.fiveHour.percentage)}%`);
  if (usageData.sevenDay)  parts.push(`7D: ${Math.round(usageData.sevenDay.percentage)}%`);
  if (usageData.opus)      parts.push(`Opus: ${Math.round(usageData.opus.percentage)}%`);
  if (usageData.sonnet)    parts.push(`Sonnet: ${Math.round(usageData.sonnet.percentage)}%`);
  return 'Claude Usage — ' + (parts.join('  ') || 'No data');
}

function buildContextMenu() {
  const accountItems = config.getAccounts().map((acc, i) => ({
    label: (i === (config.get('activeAccountIndex') || 0) ? '● ' : '○ ') +
           (acc.alias || acc.orgName || `Account ${i + 1}`),
    click: () => { config.switchAccount(i); notified90.clear(); forceRefresh(); },
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
    ...(updateInfo ? [
      { type: 'separator' },
      { label: `Update available: v${updateInfo.version}`, click: () => {
        // Validate URL before opening — only allow known GitHub releases path (HIGH-2)
        const u = updateInfo.url;
        if (typeof u === 'string' &&
            /^https:\/\/github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+\/releases/.test(u))
          shell.openExternal(u);
      }},
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
    thickFrame: false,
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
  // Popup stays open until explicitly closed via tray click or settings open
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
  popupWin.webContents.send('state', {
    usage: usageData,
    error: lastError,
    account: acc ? { alias: acc.alias, orgName: acc.orgName } : null,
    multiAccount: config.getAccounts().length > 1,
    lastFetched: usageData?.fetchedAt || null,
    timeFormat: config.get('timeFormat') || 'system',
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
  if (now - lastRefreshTime < 10_000) return; // 10-second debounce
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
  addLog('INFO', `Refreshing usage for '${acc.alias || acc.orgName}'…`);

  try {
    const data = await api.fetchUsage(sk, acc.orgId);
    checkResetNotifications(data);
    usageData = data;
    check90Notifications(data);
    addLog('INFO', `Usage fetched — primary: ${Math.round(data.fiveHour?.percentage ?? data.sevenDay?.percentage ?? 0)}%`);
  } catch (err) {
    lastError = err.message;
    addLog('ERROR', err.message);
    if (err.code === 'AUTH') notify('Claude Usage — Auth Error', err.message);
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
  if (pct >= 85 || (secs !== null && secs < 600))  return 60;
  if (pct >= 70 || (secs !== null && secs < 1800)) return Math.min(base, 180);
  return base;
}

// ── Notifications ─────────────────────────────────────────────────────────

function notify(title, body) {
  addLog('INFO', `Notification: ${title} — ${body}`);
  if (Notification.isSupported()) new Notification({ title, body }).show();
}

function check90Notifications(usage) {
  if (!config.get('notifyAt90')) return;
  [['5h', usage.fiveHour], ['7d', usage.sevenDay], ['opus', usage.opus], ['sonnet', usage.sonnet]]
    .forEach(([key, data]) => {
      if (!data) return;
      if (data.percentage >= 90) {
        const bucket = `${key}_${Math.floor(data.percentage / 10) * 10}`;
        if (!notified90.has(bucket)) {
          notified90.add(bucket);
          notify('Claude Usage Warning', `${key.toUpperCase()} usage is at ${Math.round(data.percentage)}%!`);
        }
      }
      // Note: notified90 entries are only cleared on actual reset (in checkResetNotifications),
      // not on percentage drop — prevents re-notification within the same quota period (H5)
    });
}

function checkResetNotifications(usage) {
  if (!config.get('notifyOnReset')) return;
  [['5h', usage.fiveHour], ['7d', usage.sevenDay], ['opus', usage.opus], ['sonnet', usage.sonnet]]
    .forEach(([key, data]) => {
      if (!data) return;
      const prevReset = prevResetsAt[key];
      const prevP     = prevPct[key] ?? null;
      const curr      = data.resetsAt ? new Date(data.resetsAt) : null;
      const pct       = data.percentage;

      // Detect reset via timestamp change OR ≥30% percentage drop
      const timestampReset = prevReset && curr &&
        curr.getTime() !== new Date(prevReset).getTime() && curr > new Date();
      const pctDrop = prevP !== null && prevP - pct >= 30;

      if (timestampReset || pctDrop) {
        notify('Claude Quota Reset', `${key.toUpperCase()} quota has reset — ${Math.round(pct)}% used.`);
        for (const k of [...notified90]) if (k.startsWith(`${key}_`)) notified90.delete(k);
      }
      prevResetsAt[key] = data.resetsAt;
      prevPct[key] = pct;
    });
}

// ── Update checker ────────────────────────────────────────────────────────

function versionGt(a, b) {
  // Strip pre-release suffixes (e.g. '1.2.0-beta' → '1.2.0') before comparing (M4)
  const pa = a.replace(/-.*$/, '').split('.').map(Number);
  const pb = b.replace(/-.*$/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true;
    if ((pa[i] || 0) < (pb[i] || 0)) return false;
  }
  return false;
}

async function checkUpdates(manual = false) {
  const repo = config.get('updateRepo');
  if (!repo) {
    if (manual) notify('Usage4Claude', 'No update repository configured in Settings.');
    return;
  }
  try {
    const latest = await api.checkForUpdate(repo);
    if (latest && versionGt(latest, CURRENT_VERSION)) {
      updateInfo = { version: latest, url: `https://github.com/${repo}/releases/latest` };
      notify('Usage4Claude Update Available', `Version ${latest} is available.`);
    } else if (manual) {
      notify('Usage4Claude', `You're up to date (v${CURRENT_VERSION}).`);
    }
  } catch (e) {
    if (manual) notify('Usage4Claude', `Update check failed: ${e.message}`);
  }
}

// ── Browser login ─────────────────────────────────────────────────────────

function startBrowserLogin(senderWin) {
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
      if (senderWin && !senderWin.isDestroyed())
        senderWin.webContents.send('browser-login-result', { status: 'cancelled' });
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
        if (senderWin && !senderWin.isDestroyed())
          senderWin.webContents.send('browser-login-result', { status: 'ok', sessionKey });
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
  if (logs.length > 500) logs.shift();
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
  launchAtLogin:      v => typeof v === 'boolean',
  checkUpdates:       v => typeof v === 'boolean',
  updateRepo:         v => typeof v === 'string' && (v === '' || /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(v)),
  activeAccountIndex: v => Number.isInteger(v) && v >= 0,
};

// ── IPC handlers ──────────────────────────────────────────────────────────

ipcMain.on('popup-ready', e => {
  sendStateToPopup();
});

ipcMain.on('refresh', () => triggerRefresh());

ipcMain.on('open-settings', () => openSettings());
ipcMain.on('show-context-menu', () => tray.popUpContextMenu(buildContextMenu()));

ipcMain.on('settings-ready', e => {
  // Strip accounts (with encryptedKey) from the settings object (LOW-3)
  const { accounts: _accts, ...safeSettings } = config.getAll();
  const safeAccounts = config.getAccounts().map(({ encryptedKey: _, ...rest }) => rest);
  e.sender.send('init', { settings: safeSettings, accounts: safeAccounts });
});

ipcMain.on('browser-login', e => startBrowserLogin(settingsWin));

ipcMain.on('fetch-orgs', async (e, sk) => {
  try {
    const orgs = await api.fetchOrganizations(sk);
    e.sender.send('fetch-orgs-result', { orgs });
  } catch (err) {
    e.sender.send('fetch-orgs-result', { error: err.message });
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
  clearCache(); // invalidate icon cache when display settings may have changed (H2)
  updateTrayIcon(); // apply new display mode immediately without waiting for network
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.close();
  forceRefresh(); // always refresh after saving (C2)
});

ipcMain.on('close-settings', () => {
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.close();
});

ipcMain.on('reset-all', () => {
  const n = config.getAccounts().length;
  for (let i = n - 1; i >= 0; i--) config.removeAccount(i);
  notified90.clear();
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.close();
  usageData = null;
  lastError = null;
  lastRefreshTime = 0;
  updateTrayIcon();
  openSettings();
});

ipcMain.on('open-logs', () => openLogs());
