const { ipcRenderer } = require('electron');

let settings = {};
let accounts = [];
let fetchedOrgs = [];

// ── Init ──────────────────────────────────────────────────────────────────

ipcRenderer.on('init', (_e, data) => {
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
    const div = document.createElement('div');
    div.className = 'account-item';
    div.innerHTML = `
      <div class="account-dot ${isActive ? '' : 'inactive'}"></div>
      <div class="account-info">
        <div class="account-name">${acc.alias || acc.orgName || 'Account ' + (i+1)}</div>
        <div class="account-org">${acc.orgName}</div>
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
      accounts.splice(idx, 1);
      if (settings.activeAccountIndex >= accounts.length)
        settings.activeAccountIndex = Math.max(0, accounts.length - 1);
      renderAccountList();
    });
  });
}

// ── Browser login ─────────────────────────────────────────────────────────

document.getElementById('browserLoginBtn').addEventListener('click', () => {
  const btn = document.getElementById('browserLoginBtn');
  btn.disabled = true;
  btn.textContent = 'Opening browser…';
  setStatus('browserStatus', 'Log in to Claude in the window that opens.', '');
  ipcRenderer.send('browser-login');
});

ipcRenderer.on('browser-login-result', (_e, result) => {
  const btn = document.getElementById('browserLoginBtn');
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

document.getElementById('fetchOrgsBtn').addEventListener('click', () => {
  const sk = document.getElementById('skInput').value.trim();
  if (!sk) { setStatus('fetchStatus', 'Enter a session key first.', 'err'); return; }
  setStatus('fetchStatus', 'Fetching…', '');
  document.getElementById('fetchOrgsBtn').disabled = true;
  ipcRenderer.send('fetch-orgs', sk);
});

ipcRenderer.on('fetch-orgs-result', (_e, result) => {
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
    launchAtLogin: document.getElementById('launchAtLoginToggle').checked,
    checkUpdates: document.getElementById('checkUpdatesToggle').checked,
    updateRepo: document.getElementById('updateRepoInput').value.trim(),
    activeAccountIndex: settings.activeAccountIndex || 0,
  };
  ipcRenderer.send('save-settings', { settings: newSettings, accounts });
});

document.getElementById('cancelBtn').addEventListener('click', () =>
  ipcRenderer.send('close-settings'));

document.getElementById('resetBtn').addEventListener('click', () => {
  if (confirm('Remove all accounts and reset settings?')) {
    ipcRenderer.send('reset-all');
  }
});

document.getElementById('openLogsBtn').addEventListener('click', () =>
  ipcRenderer.send('open-logs'));

// ── Helpers ───────────────────────────────────────────────────────────────

function setStatus(id, msg, type) {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.className = 'status' + (type ? ' ' + type : '');
}

ipcRenderer.send('settings-ready');
