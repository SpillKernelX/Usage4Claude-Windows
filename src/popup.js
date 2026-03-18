/* Popup renderer — communicates with main process via contextBridge */

const { ipcRenderer } = require('electron');

// ── Limit metadata ────────────────────────────────────────────────────────

const LIMITS = [
  {
    key: 'fiveHour', label: '5-Hour Limit', color: '#4ade80',
    icon: circleIcon('#4ade80'), timeStyle: 'short',
  },
  {
    key: 'sevenDay', label: '7-Day Limit', color: '#a855f7',
    icon: circleIcon('#a855f7'), timeStyle: 'long',
  },
  {
    key: 'extra', label: 'Extra Usage', color: '#ef4444',
    icon: hexIcon('#ef4444'), timeStyle: 'money',
  },
  {
    key: 'opus', label: '7D Opus Limit', color: '#f97316',
    icon: squareIcon('#f97316'), timeStyle: 'long',
  },
  {
    key: 'sonnet', label: '7D Sonnet Limit', color: '#3b82f6',
    icon: squareIcon('#3b82f6'), timeStyle: 'long',
  },
];

// ── SVG icon helpers ──────────────────────────────────────────────────────

function circleIcon(color) {
  return `<svg width="18" height="18" viewBox="0 0 18 18">
    <circle cx="9" cy="9" r="6.5" fill="none" stroke="${color}" stroke-width="2.2"/>
  </svg>`;
}

function hexIcon(color) {
  return `<svg width="18" height="18" viewBox="0 0 18 18">
    <polygon points="9,2 15.5,5.5 15.5,12.5 9,16 2.5,12.5 2.5,5.5" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>
  </svg>`;
}

function squareIcon(color) {
  return `<svg width="18" height="18" viewBox="0 0 18 18">
    <rect x="2.5" y="2.5" width="13" height="13" rx="3.5" fill="none" stroke="${color}" stroke-width="2.2"/>
  </svg>`;
}

// ── Ring chart ────────────────────────────────────────────────────────────

function buildRings(usage) {
  const svg = document.getElementById('ringSvg');
  svg.innerHTML = '';
  const cx = 60, cy = 60;
  const rings = [
    { data: usage.fiveHour, color: '#4ade80', r: 50 },
    { data: usage.sevenDay, color: '#a855f7', r: 40 },
  ].filter(r => r.data);

  rings.forEach(({ data, color, r }) => {
    const circ = 2 * Math.PI * r;
    const offset = circ * (1 - Math.min(data.percentage / 100, 1));
    const track = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    track.setAttribute('cx', cx); track.setAttribute('cy', cy); track.setAttribute('r', r);
    track.setAttribute('fill', 'none');
    track.setAttribute('stroke', 'var(--ring-track)');
    track.setAttribute('stroke-width', '9');
    svg.appendChild(track);

    const arc = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    arc.setAttribute('cx', cx); arc.setAttribute('cy', cy); arc.setAttribute('r', r);
    arc.setAttribute('fill', 'none');
    arc.setAttribute('stroke', color);
    arc.setAttribute('stroke-width', '9');
    arc.setAttribute('stroke-linecap', 'round');
    arc.setAttribute('stroke-dasharray', circ.toFixed(1));
    arc.setAttribute('stroke-dashoffset', offset.toFixed(1));
    svg.appendChild(arc);
  });

  // Primary percentage for center display
  const primary = usage.fiveHour || usage.sevenDay;
  document.getElementById('ringPct').textContent =
    primary ? Math.round(primary.percentage) + '%' : '—';
}

// ── Time formatting ───────────────────────────────────────────────────────

let _timeFormat = 'system';

function formatResetTime(resetsAt, style) {
  if (!resetsAt) return '—';
  const d = new Date(resetsAt);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  const isTomorrow = d.toDateString() === tomorrow.toDateString();

  const hour12 = _timeFormat === 'system' ? undefined : _timeFormat === '12h';
  const timeStr = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12 });

  if (style === 'short') {
    if (isToday) return `Today ${timeStr}`;
    if (isTomorrow) return `Tomorrow ${timeStr}`;
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + timeStr;
  }
  const hourStr = d.toLocaleTimeString([], { hour: 'numeric', hour12 });
  if (isToday) return `Today ${hourStr}`;
  if (isTomorrow) return `Tomorrow ${hourStr}`;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + hourStr;
}

// ── Render ────────────────────────────────────────────────────────────────

function render(state) {
  const { usage, error, account, lastFetched, timeFormat } = state;

  // Account label (only if multiple accounts)
  document.getElementById('accountLabel').textContent =
    state.multiAccount ? (account?.alias || account?.orgName || '') : '';

  // Error banner
  const errorRow = document.getElementById('errorRow');
  if (error) {
    errorRow.style.display = 'block';
    errorRow.textContent = error;
  } else {
    errorRow.style.display = 'none';
  }

  const rows = document.getElementById('rows');
  const ringSection = document.getElementById('ringSection');

  if (!usage) {
    ringSection.style.display = 'none';
    if (error) {
      rows.innerHTML = '';
      // Use textContent for error to avoid XSS (M6)
      const wrap = document.createElement('div');
      wrap.className = 'empty-state';
      const msg = document.createElement('div');
      msg.style.cssText = 'color:#ef4444;margin-bottom:8px';
      msg.textContent = '⚠ ' + error;
      const settingsBtn = document.createElement('button');
      settingsBtn.className = 'setup-btn';
      settingsBtn.textContent = 'Open Settings';
      settingsBtn.addEventListener('click', () => ipcRenderer.send('open-settings'));
      const diagBtn = document.createElement('button');
      diagBtn.className = 'setup-btn';
      diagBtn.style.cssText = 'background:var(--row-bg);color:var(--text);margin-top:6px';
      diagBtn.textContent = 'Run Diagnostics';
      diagBtn.addEventListener('click', () => ipcRenderer.send('open-logs'));
      wrap.append(msg, settingsBtn, diagBtn);
      rows.appendChild(wrap);
    } else {
      rows.innerHTML = `<div class="empty-state">
        <div class="spinner"></div>
        <div>Loading usage data…</div>
      </div>`;
    }
    return;
  }

  // Ring chart
  ringSection.style.display = 'flex';
  buildRings(usage);

  // Rows
  rows.innerHTML = '';
  LIMITS.forEach(({ key, label, color, icon, timeStyle }) => {
    const data = usage[key];
    if (!data) return;

    let valueStr;
    if (timeStyle === 'money') {
      valueStr = data.enabled
        ? `$${data.used.toFixed(0)}/$${data.limit.toFixed(0)}`
        : null;
      if (!valueStr) return;
    } else {
      valueStr = formatResetTime(data.resetsAt, timeStyle);
    }

    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `
      <div class="row-icon">${icon}</div>
      <span class="row-name">${label}</span>
      <span class="row-value">${valueStr}</span>
    `;
    rows.appendChild(row);
  });

  // Last updated
  if (lastFetched) {
    const d = new Date(lastFetched);
    document.getElementById('lastUpdated').textContent =
      'Updated ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
}

// ── IPC ───────────────────────────────────────────────────────────────────

ipcRenderer.on('state', (_e, state) => {
  if (state.timeFormat) _timeFormat = state.timeFormat;
  render(state);
});

document.getElementById('refreshBtn').addEventListener('click', () => {
  const btn = document.getElementById('refreshBtn');
  btn.classList.add('spinning');
  ipcRenderer.send('refresh');
  setTimeout(() => btn.classList.remove('spinning'), 1500);
});

document.getElementById('settingsBtn').addEventListener('click', () =>
  ipcRenderer.send('open-settings'));

document.getElementById('menuBtn').addEventListener('click', () =>
  ipcRenderer.send('show-context-menu'));

// Request initial state
ipcRenderer.send('popup-ready');
