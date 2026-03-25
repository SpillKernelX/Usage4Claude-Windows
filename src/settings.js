/* Settings renderer — uses window.api exposed by preload/settings.js */

let settings = {};
let accounts = [];
let fetchedOrgs = [];

// ── HTML escaping ─────────────────────────────────────────────────────────

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Init ──────────────────────────────────────────────────────────────────

window.api.onInit(data => {
  settings = data.settings;
  accounts = data.accounts;
  populate();
});

function populate() {
  // Display
  document.querySelectorAll('input[name="displayMode"]').forEach(r => {
    r.checked = r.value === settings.displayMode;
  });
  document.getElementById('monoToggle').checked = settings.monochrome;
  document.getElementById('themeSelect').value = settings.theme || 'system';
  document.getElementById('timeFormatSelect').value = settings.timeFormat || 'system';

  // Refresh
  document.getElementById('smartRefreshToggle').checked = settings.smartRefresh;
  document.getElementById('intervalSelect').value = String(settings.refreshInterval || 3);

  // Notifications
  document.getElementById('notify90Toggle').checked = settings.notifyAt90;
  document.getElementById('notifyResetToggle').checked = settings.notifyOnReset;
  document.getElementById('telegramTokenInput').value = settings.telegramBotToken || '';
  document.getElementById('telegramChatIdInput').value = settings.telegramChatId || '';

  // Per-limit mute
  const muted = settings.mutedLimits || [];
  document.getElementById('mute5h').checked = muted.includes('5h');
  document.getElementById('mute7d').checked = muted.includes('7d');
  document.getElementById('muteOpus').checked = muted.includes('opus');
  document.getElementById('muteSonnet').checked = muted.includes('sonnet');

  // Advanced
  document.getElementById('launchAtLoginToggle').checked = settings.launchAtLogin;
  document.getElementById('checkUpdatesToggle').checked = settings.checkUpdates;
  document.getElementById('updateRepoInput').value = settings.updateRepo || '';

  renderAccountList();
}

// ── Tabs ──────────────────────────────────────────────────────────────────

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
  });
});

// ── Account list ──────────────────────────────────────────────────────────

function renderAccountList() {
  const container = document.getElementById('accountList');
  if (!accounts.length) {
    container.innerHTML = '<div style="padding:12px 14px;color:var(--subtext)">No accounts yet.</div>';
    return;
  }
  const activeIdx = settings.activeAccountIndex || 0;
  container.innerHTML = '';
  accounts.forEach((acc, i) => {
    const isActive = i === activeIdx;
    // Escape user/API-sourced strings before inserting into HTML (HIGH-3)
    const displayName = escapeHtml(acc.alias || acc.orgName || 'Account ' + (i + 1));
    const orgName     = escapeHtml(acc.orgName);
    const div = document.createElement('div');
    div.className = 'account-item';
    div.innerHTML = `
      <div class="account-dot ${isActive ? '' : 'inactive'}"></div>
      <div class="account-info">
        <div class="account-name">${displayName}</div>
        <div class="account-org">${orgName}</div>
      </div>
      ${!isActive ? `<button class="btn btn-secondary" data-switch="${i}" style="padding:5px 10px;font-size:12px">Switch</button>` : '<span style="font-size:11px;color:var(--accent)">Active</span>'}
      <button class="btn btn-danger" data-remove="${i}" style="padding:5px 10px;font-size:12px">Remove</button>
    `;
    container.appendChild(div);
  });

  container.querySelectorAll('[data-switch]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.switch);
      settings.activeAccountIndex = idx;
      renderAccountList();
    });
  });
  container.querySelectorAll('[data-remove]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.remove);
      const name = accounts[idx]?.alias || accounts[idx]?.orgName || `Account ${idx + 1}`;
      if (!confirm(`Remove account "${name}"?`)) return;
      accounts.splice(idx, 1);
      if (settings.activeAccountIndex >= accounts.length)
        settings.activeAccountIndex = Math.max(0, accounts.length - 1);
      renderAccountList();
    });
  });
}

// ── Browser login ─────────────────────────────────────────────────────────

document.getElementById('browserLoginBtn').addEventListener('click', async () => {
  const btn = document.getElementById('browserLoginBtn');
  btn.disabled = true;
  btn.textContent = 'Opening browser…';
  setStatus('browserStatus', 'Log in to Claude in the window that opens.', '');
  const result = await window.api.browserLogin();
  btn.disabled = false;
  btn.textContent = 'Log in with Browser';
  if (result.status === 'ok') {
    document.getElementById('skInput').value = result.sessionKey;
    setStatus('browserStatus', 'Session key captured — fetch organizations to continue.', 'ok');
  } else if (result.status === 'cancelled') {
    setStatus('browserStatus', 'Login cancelled.', '');
  } else {
    setStatus('browserStatus', 'Error: ' + (result.msg || 'unknown'), 'err');
  }
});

// ── Session key toggle ────────────────────────────────────────────────────

document.getElementById('skToggle').addEventListener('click', () => {
  const inp = document.getElementById('skInput');
  inp.type = inp.type === 'password' ? 'text' : 'password';
});

// ── Fetch orgs ────────────────────────────────────────────────────────────

document.getElementById('fetchOrgsBtn').addEventListener('click', async () => {
  const sk = document.getElementById('skInput').value.trim();
  if (!sk) { setStatus('fetchStatus', 'Enter a session key first.', 'err'); return; }
  setStatus('fetchStatus', 'Fetching…', '');
  document.getElementById('fetchOrgsBtn').disabled = true;
  const result = await window.api.fetchOrgs(sk);
  document.getElementById('fetchOrgsBtn').disabled = false;
  if (result.error) {
    setStatus('fetchStatus', result.error, 'err');
    return;
  }
  fetchedOrgs = result.orgs;
  const sel = document.getElementById('orgSelect');
  sel.innerHTML = '<option value="">— Select organization —</option>';
  fetchedOrgs.forEach((o, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = o.name;
    sel.appendChild(opt);
  });
  if (fetchedOrgs.length) sel.value = '0';
  setStatus('fetchStatus', `${fetchedOrgs.length} org(s) found.`, 'ok');
});

// ── Add account ───────────────────────────────────────────────────────────

document.getElementById('addAccountBtn').addEventListener('click', () => {
  const sk = document.getElementById('skInput').value.trim();
  const orgIdx = document.getElementById('orgSelect').value;
  const alias = document.getElementById('aliasInput').value.trim();

  if (!sk) { setStatus('fetchStatus', 'Enter a session key.', 'err'); return; }
  const org = fetchedOrgs[parseInt(orgIdx)];
  if (!org) { setStatus('fetchStatus', 'Select an organization.', 'err'); return; }

  accounts.push({ alias, orgId: org.uuid, orgName: org.name, _newKey: sk });
  if (accounts.length === 1) settings.activeAccountIndex = 0;

  document.getElementById('skInput').value = '';
  document.getElementById('aliasInput').value = '';
  document.getElementById('orgSelect').innerHTML = '<option value="">— Select organization —</option>';
  fetchedOrgs = [];
  setStatus('fetchStatus', `Account '${org.name}' added.`, 'ok');
  renderAccountList();
});

// ── Save / Cancel ─────────────────────────────────────────────────────────

function collectMutedLimits() {
  const muted = [];
  if (document.getElementById('mute5h').checked) muted.push('5h');
  if (document.getElementById('mute7d').checked) muted.push('7d');
  if (document.getElementById('muteOpus').checked) muted.push('opus');
  if (document.getElementById('muteSonnet').checked) muted.push('sonnet');
  return muted;
}

document.getElementById('saveBtn').addEventListener('click', () => {
  const newSettings = {
    displayMode: document.querySelector('input[name="displayMode"]:checked')?.value || 'combined',
    monochrome: document.getElementById('monoToggle').checked,
    theme: document.getElementById('themeSelect').value,
    timeFormat: document.getElementById('timeFormatSelect').value,
    smartRefresh: document.getElementById('smartRefreshToggle').checked,
    refreshInterval: parseInt(document.getElementById('intervalSelect').value),
    notifyAt90: document.getElementById('notify90Toggle').checked,
    notifyOnReset: document.getElementById('notifyResetToggle').checked,
    mutedLimits: collectMutedLimits(),
    telegramBotToken: document.getElementById('telegramTokenInput').value.trim(),
    telegramChatId: document.getElementById('telegramChatIdInput').value.trim(),
    launchAtLogin: document.getElementById('launchAtLoginToggle').checked,
    checkUpdates: document.getElementById('checkUpdatesToggle').checked,
    updateRepo: document.getElementById('updateRepoInput').value.trim(),
    activeAccountIndex: settings.activeAccountIndex || 0,
  };
  window.api.saveSettings({ settings: newSettings, accounts });
});

document.getElementById('cancelBtn').addEventListener('click', () =>
  window.api.closeSettings());

document.getElementById('resetBtn').addEventListener('click', () => {
  if (confirm('Remove all accounts and reset settings?')) {
    window.api.resetAll();
  }
});

document.getElementById('openLogsBtn').addEventListener('click', () =>
  window.api.openLogs());

document.getElementById('telegramTokenToggle').addEventListener('click', () => {
  const inp = document.getElementById('telegramTokenInput');
  inp.type = inp.type === 'password' ? 'text' : 'password';
});

document.getElementById('telegramTestBtn').addEventListener('click', async () => {
  const token  = document.getElementById('telegramTokenInput').value.trim();
  const chatId = document.getElementById('telegramChatIdInput').value.trim();
  if (!token || !chatId) {
    setStatus('telegramStatus', 'Enter both a bot token and chat ID first.', 'err');
    return;
  }
  setStatus('telegramStatus', 'Sending…', '');
  document.getElementById('telegramTestBtn').disabled = true;
  const result = await window.api.telegramTest(token, chatId);
  document.getElementById('telegramTestBtn').disabled = false;
  if (result.ok) {
    setStatus('telegramStatus', 'Message sent — check Telegram!', 'ok');
  } else {
    setStatus('telegramStatus', 'Failed: ' + (result.error || 'unknown error'), 'err');
  }
});

// ── Export / Import ───────────────────────────────────────────────────────

document.getElementById('exportBtn').addEventListener('click', async () => {
  const result = await window.api.exportSettings();
  if (result.ok) setStatus('backupStatus', 'Settings exported.', 'ok');
  else if (result.error) setStatus('backupStatus', 'Export failed: ' + result.error, 'err');
});

document.getElementById('importBtn').addEventListener('click', async () => {
  const result = await window.api.importSettings();
  if (result.ok) {
    setStatus('backupStatus', 'Settings imported. Restart app to apply all changes.', 'ok');
  } else if (result.error) {
    setStatus('backupStatus', 'Import failed: ' + result.error, 'err');
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────

function setStatus(id, msg, type) {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.className = 'status' + (type ? ' ' + type : '');
}

window.api.settingsReady();
