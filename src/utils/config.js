const Store = require('electron-store');
const { safeStorage } = require('electron');

const store = new Store({
  defaults: {
    accounts: [],
    activeAccountIndex: 0,
    displayMode: 'combined',   // 'combined' | 'percentage' | 'icon'
    monochrome: false,
    smartRefresh: true,
    refreshInterval: 3,        // minutes
    notifyAt90: true,
    notifyOnReset: true,
    checkUpdates: true,
    updateRepo: 'SpillKernelX/Usage4Claude-Windows',
    theme: 'system',           // 'system' | 'dark' | 'light'
    timeFormat: 'system',      // 'system' | '12h' | '24h'
    launchAtLogin: false,
    mutedLimits: [],          // per-limit mute: subset of ['5h','7d','opus','sonnet']
    telegramBotToken: '',
    telegramChatId: '',
  }
});

// ── Session key encryption via Windows DPAPI (safeStorage) ────────────────

function encryptKey(plaintext) {
  if (!safeStorage.isEncryptionAvailable()) return plaintext;
  return safeStorage.encryptString(plaintext).toString('base64');
}

function decryptKey(encrypted) {
  if (!encrypted) return '';
  if (!safeStorage.isEncryptionAvailable()) return encrypted;
  try {
    return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
  } catch {
    return '';
  }
}

// ── Accounts ──────────────────────────────────────────────────────────────

function getAccounts() {
  return store.get('accounts', []);
}

function getSessionKey(account) {
  return decryptKey(account.encryptedKey || '');
}

function addAccount({ sessionKey, orgId, orgName, alias = '' }) {
  const accounts = getAccounts();
  const account = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2),
    alias,
    orgId,
    orgName,
    encryptedKey: encryptKey(sessionKey),
  };
  accounts.push(account);
  store.set('accounts', accounts);
  if (accounts.length === 1) store.set('activeAccountIndex', 0);
  return account;
}

function removeAccount(index) {
  const accounts = getAccounts();
  accounts.splice(index, 1);
  store.set('accounts', accounts);
  const active = store.get('activeAccountIndex', 0);
  if (active >= accounts.length) store.set('activeAccountIndex', Math.max(0, accounts.length - 1));
}

function updateAccountAlias(index, alias) {
  const accounts = getAccounts();
  if (accounts[index]) {
    accounts[index].alias = alias;
    store.set('accounts', accounts);
  }
}

function getActiveAccount() {
  const accounts = getAccounts();
  if (!accounts.length) return null;
  const idx = Math.min(store.get('activeAccountIndex', 0), accounts.length - 1);
  return accounts[idx];
}

function switchAccount(index) {
  store.set('activeAccountIndex', index);
}

function hasCredentials() {
  const acc = getActiveAccount();
  return !!(acc && getSessionKey(acc) && acc.orgId);
}

// ── Generic get/set ───────────────────────────────────────────────────────

function get(key) { return store.get(key); }
function set(key, value) { store.set(key, value); }
function getAll() { return store.store; }

module.exports = {
  getAccounts, getSessionKey, addAccount, removeAccount,
  updateAccountAlias, getActiveAccount, switchAccount, hasCredentials,
  get, set, getAll,
};
