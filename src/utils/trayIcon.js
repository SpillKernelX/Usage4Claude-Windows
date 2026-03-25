const { BrowserWindow, nativeImage } = require('electron');
const path = require('node:path');

const COLORS = {
  green:  '#4ade80',
  yellow: '#facc15',
  orange: '#fb923c',
  red:    '#f87171',
  mono:   '#9ca3af',
};

function getColor(pct, monochrome) {
  if (monochrome) return COLORS.mono;
  if (pct < 50)   return COLORS.green;
  if (pct < 70)   return COLORS.yellow;
  if (pct < 90)   return COLORS.orange;
  return COLORS.red;
}

// ── Offscreen icon renderer ───────────────────────────────────────────────

let _win = null;
let _readyPromise = null;
const _cache = new Map();

function getRenderer() {
  if (_win && !_win.isDestroyed()) return { win: _win, ready: _readyPromise };

  _win = new BrowserWindow({
    width: 64, height: 64,
    show: false,
    webPreferences: {
      offscreen: true,
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  _readyPromise = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('icon renderer timeout')), 5000);
    _win.webContents.once('did-finish-load', () => { clearTimeout(t); resolve(); });
    _win.webContents.once('did-fail-load', (_e, code, desc) => {
      clearTimeout(t);
      reject(new Error(`icon renderer load failed: ${desc}`));
    });
  });

  _win.loadFile(path.join(__dirname, '../iconCanvas.html'));
  _win.on('closed', () => { _win = null; _readyPromise = null; });
  return { win: _win, ready: _readyPromise };
}

async function renderIcon(opts) {
  const key = JSON.stringify(opts);
  if (_cache.has(key)) return _cache.get(key);

  const { win, ready } = getRenderer();
  await ready;

  const dataUrl = await win.webContents.executeJavaScript(
    `window.drawIcon(${JSON.stringify(opts)})`
  );
  const img = nativeImage.createFromDataURL(dataUrl);
  _cache.set(key, img);
  return img;
}

// ── Public API ────────────────────────────────────────────────────────────

async function makeTrayIcon({ pct = null, error = false, monochrome = false, mode = 'combined' } = {}) {
  if (error)        return renderIcon({ state: 'error' });
  if (pct === null) return renderIcon({ state: 'loading' });
  const color = getColor(pct, monochrome);
  return renderIcon({ pct, color, mode, monochrome, state: 'normal' });
}

function clearCache() { _cache.clear(); }

module.exports = { makeTrayIcon, getColor, COLORS, clearCache };
