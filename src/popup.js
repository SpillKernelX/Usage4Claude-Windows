/* Popup renderer — uses window.api exposed by preload/popup.js */

// ── Limit metadata ────────────────────────────────────────────────────────

const LIMITS = [
  {
    key: 'fiveHour', label: '5-Hour Limit', color: '#4ade80',
    iconFn: circleIcon, timeStyle: 'short',
  },
  {
    key: 'sevenDay', label: '7-Day Limit', color: '#a855f7',
    iconFn: circleIcon, timeStyle: 'long',
  },
  {
    key: 'extra', label: 'Extra Usage', color: '#ef4444',
    iconFn: hexIcon, timeStyle: 'money',
  },
  {
    key: 'opus', label: '7D Opus Limit', color: '#f97316',
    iconFn: squareIcon, timeStyle: 'long',
  },
  {
    key: 'sonnet', label: '7D Sonnet Limit', color: '#3b82f6',
    iconFn: squareIcon, timeStyle: 'long',
  },
];

// ── SVG icon helpers (author-controlled constants — safe for innerHTML) ───

function circleIcon(color, pct) {
  const text = pct != null ? `<text x="9" y="9" text-anchor="middle" dominant-baseline="central" fill="${color}" font-size="${pct >= 100 ? 6 : 7}" font-weight="700" font-family="-apple-system,'Segoe UI',system-ui,sans-serif">${Math.round(pct)}</text>` : '';
  return `<svg width="18" height="18" viewBox="0 0 18 18">
    <circle cx="9" cy="9" r="6.5" fill="none" stroke="${color}" stroke-width="2.2"/>${text}
  </svg>`;
}

function hexIcon(color, pct) {
  const text = pct != null ? `<text x="9" y="9" text-anchor="middle" dominant-baseline="central" fill="${color}" font-size="${pct >= 100 ? 5.5 : 6.5}" font-weight="700" font-family="-apple-system,'Segoe UI',system-ui,sans-serif">${Math.round(pct)}</text>` : '';
  return `<svg width="18" height="18" viewBox="0 0 18 18">
    <polygon points="9,2 15.5,5.5 15.5,12.5 9,16 2.5,12.5 2.5,5.5" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>${text}
  </svg>`;
}

function squareIcon(color, pct) {
  const text = pct != null ? `<text x="9" y="9" text-anchor="middle" dominant-baseline="central" fill="${color}" font-size="${pct >= 100 ? 6 : 7}" font-weight="700" font-family="-apple-system,'Segoe UI',system-ui,sans-serif">${Math.round(pct)}</text>` : '';
  return `<svg width="18" height="18" viewBox="0 0 18 18">
    <rect x="2.5" y="2.5" width="13" height="13" rx="3.5" fill="none" stroke="${color}" stroke-width="2.2"/>${text}
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

  const primary = usage.fiveHour || usage.sevenDay;
  const ringPctEl = document.getElementById('ringPct');
  const pctVal = primary ? Math.round(primary.percentage) : null;
  ringPctEl.textContent = pctVal != null ? pctVal + '%' : '—';
  ringPctEl.classList.toggle('pct-100', pctVal != null && pctVal >= 100);
}

// ── Sparkline ────────────────────────────────────────────────────────────

function drawSparkline(history) {
  const wrap = document.getElementById('sparklineWrap');
  if (!history || history.length < 2) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';
  const canvas = document.getElementById('sparklineCanvas');
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * window.devicePixelRatio;
  canvas.height = 32 * window.devicePixelRatio;
  const ctx = canvas.getContext('2d');
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
  const w = rect.width, h = 32;
  ctx.clearRect(0, 0, w, h);

  const pts = history.slice(-30); // last 30 data points
  const step = w / (pts.length - 1);

  // gradient fill
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, 'rgba(74,222,128,0.25)');
  grad.addColorStop(1, 'rgba(74,222,128,0)');

  ctx.beginPath();
  ctx.moveTo(0, h - (pts[0] / 100) * h);
  for (let i = 1; i < pts.length; i++) {
    ctx.lineTo(i * step, h - (pts[i] / 100) * h);
  }
  // fill area
  const linePath = new Path2D();
  linePath.moveTo(0, h - (pts[0] / 100) * h);
  for (let i = 1; i < pts.length; i++) {
    linePath.lineTo(i * step, h - (pts[i] / 100) * h);
  }
  ctx.strokeStyle = '#4ade80';
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.stroke(linePath);

  // fill under line
  ctx.lineTo((pts.length - 1) * step, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();
}

// ── Time formatting ───────────────────────────────────────────────────────

let _timeFormat = 'system';

function formatResetTime(resetsAt, style) {
  if (!resetsAt) return '—';
  const d = new Date(resetsAt);
  const now = new Date();
  const diffMs = d - now;
  const isToday = d.toDateString() === now.toDateString();
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  const isTomorrow = d.toDateString() === tomorrow.toDateString();

  const hour12 = _timeFormat === 'system' ? undefined : _timeFormat === '12h';
  const timeStr = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12 });

  // Build countdown suffix for positive remaining time
  let countdown = '';
  if (diffMs > 0) {
    const totalMin = Math.floor(diffMs / 60000);
    const hrs = Math.floor(totalMin / 60);
    const mins = totalMin % 60;
    countdown = hrs > 0 ? ` (${hrs}h ${mins}m)` : ` (${mins}m)`;
  }

  // Format date as "24 Mar 26" (day month-short 2-digit-year)
  const dateStr = `${d.getDate()} ${d.toLocaleString([], { month: 'short' })} ${String(d.getFullYear()).slice(-2)}`;

  if (style === 'short') {
    if (isToday) return `Today ${timeStr}${countdown}`;
    if (isTomorrow) return `Tmrw ${timeStr}${countdown}`;
    return dateStr;
  }
  const hourStr = d.toLocaleTimeString([], { hour: 'numeric', hour12 });
  if (isToday) return `Today ${hourStr}${countdown}`;
  if (isTomorrow) return `Tmrw ${hourStr}${countdown}`;
  return dateStr;
}

// ── Overclock / Baseline status ──────────────────────────────────────────

let _overclockTimer = null;

function getOverclockStateLocal() {
  const now = new Date();
  const ptStr = now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });
  const pt = new Date(ptStr);
  const ptHour = pt.getHours();
  const ptDay  = pt.getDay();

  const isWeekend = (ptDay === 0 || ptDay === 6);
  const isStandardWindow = (ptHour >= 5 && ptHour < 11);
  const isOverclocked = isWeekend || !isStandardWindow;

  let targetHour, targetDayOffset;
  if (isOverclocked) {
    if (isWeekend) {
      targetDayOffset = ptDay === 0 ? 1 : 2; // Sun→Mon=1 day, Sat→Mon=2 days
    } else {
      targetDayOffset = (ptHour >= 11) ? 1 : 0;
    }
    targetHour = 5;
  } else {
    targetDayOffset = 0;
    targetHour = 11;
  }

  const target = new Date(pt);
  target.setDate(target.getDate() + targetDayOffset);
  target.setHours(targetHour, 0, 0, 0);
  const transitionMs = Math.max(0, target - pt);

  return {
    isOverclocked,
    label: isOverclocked ? 'OVERCLOCKED' : 'BASELINE',
    transitionMs,
    nextLabel: isOverclocked ? 'Baseline' : 'Overclocked',
  };
}

// Bolt icon for overclocked, dash icon for baseline (matches row-icon 18×18 style)
function boltIcon(color) {
  return `<svg width="18" height="18" viewBox="0 0 18 18">
    <path d="M10 2L4 10h4.5l-1 6 6.5-8H9.5L10 2z" fill="none" stroke="${color}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>
  </svg>`;
}

function dashIcon(color) {
  return `<svg width="18" height="18" viewBox="0 0 18 18">
    <line x1="4" y1="9" x2="14" y2="9" stroke="${color}" stroke-width="2.2" stroke-linecap="round"/>
  </svg>`;
}

function formatCountdown(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

function updateOverclockRow() {
  const row = document.getElementById('overclockRow');
  const oc = getOverclockStateLocal();

  row.style.display = 'flex';

  const color = oc.isOverclocked ? '#e8a020' : '#8e8e93';
  // icon and label are author-controlled constants — safe for innerHTML
  document.getElementById('overclockIcon').innerHTML =
    oc.isOverclocked ? boltIcon(color) : dashIcon(color);
  document.getElementById('overclockLabel').textContent =
    oc.isOverclocked ? 'Overclocked' : 'Baseline';
  document.getElementById('overclockCountdown').textContent = formatCountdown(oc.transitionMs);
}

function startOverclockTimer() {
  if (_overclockTimer) clearInterval(_overclockTimer);
  updateOverclockRow();
  _overclockTimer = setInterval(updateOverclockRow, 1000);
}

// ── Render ────────────────────────────────────────────────────────────────

function render(state) {
  const { usage, error, account, lastFetched, timeFormat } = state;

  document.getElementById('accountLabel').textContent =
    state.multiAccount ? (account?.alias || account?.orgName || '') : '';

  const errorRow = document.getElementById('errorRow');
  if (error) {
    errorRow.style.display = 'block';
    // Better error messages with actionable guidance
    let errorMsg = error;
    if (error === 'Not configured') errorMsg = 'No accounts added. Open Settings to add one.';
    else if (error.includes('401') || error.includes('AUTH') || error.includes('expired'))
      errorMsg = 'Session expired. Open Settings to log in again.';
    else if (error.includes('403') || error.includes('CLOUDFLARE'))
      errorMsg = 'Blocked by Cloudflare. Try again in a few minutes.';
    else if (error.includes('429') || error.includes('RATE_LIMIT'))
      errorMsg = 'Rate limited. Will retry automatically.';
    errorRow.textContent = errorMsg;
  } else {
    errorRow.style.display = 'none';
  }

  const rows = document.getElementById('rows');
  const ringSection = document.getElementById('ringSection');

  // Use cached data fallback when network fails
  const displayUsage = usage || state._cachedUsage;

  if (!displayUsage) {
    ringSection.style.display = 'none';
    document.getElementById('sparklineWrap').style.display = 'none';
    if (error) {
      rows.innerHTML = '';
      const wrap = document.createElement('div');
      wrap.className = 'empty-state';
      const msg = document.createElement('div');
      msg.style.cssText = 'color:#ef4444;margin-bottom:8px';
      msg.textContent = errorRow.textContent;
      const settingsBtn = document.createElement('button');
      settingsBtn.className = 'setup-btn';
      settingsBtn.textContent = 'Open Settings';
      settingsBtn.addEventListener('click', () => window.api.openSettings());
      const diagBtn = document.createElement('button');
      diagBtn.className = 'setup-btn';
      diagBtn.style.cssText = 'background:var(--row-bg);color:var(--text);margin-top:6px';
      diagBtn.textContent = 'Run Diagnostics';
      diagBtn.addEventListener('click', () => window.api.openLogs());
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

  ringSection.style.display = 'flex';
  buildRings(displayUsage);

  // Sparkline from history
  if (state.history) drawSparkline(state.history);

  rows.innerHTML = '';
  LIMITS.forEach(({ key, label, color, iconFn, timeStyle }) => {
    const data = displayUsage[key];
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

    // Generate icon with percentage inside (upstream v2.6.0 feature)
    const pct = (timeStyle === 'money') ? null : data.percentage;
    const icon = iconFn(color, pct);

    const row = document.createElement('div');
    row.className = 'row';
    // icon, label, valueStr are all author-controlled constants
    row.innerHTML = `
      <div class="row-icon">${icon}</div>
      <span class="row-name">${label}</span>
      <span class="row-value">${valueStr}</span>
    `;
    rows.appendChild(row);
  });

  // Show "Updated" timestamp with offline badge if using cached data
  const updatedEl = document.getElementById('lastUpdated');
  const ts = lastFetched || displayUsage?.fetchedAt;
  if (ts) {
    const d = new Date(ts);
    const timeText = 'Updated ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (!usage && state._cachedUsage) {
      updatedEl.innerHTML = timeText + '<span class="offline-badge">CACHED</span>';
    } else {
      updatedEl.textContent = timeText;
    }
  }
}

// ── IPC ───────────────────────────────────────────────────────────────────

// Start overclock countdown once — it reads wall-clock time independently of IPC
startOverclockTimer();

let _lastCachedUsage = null;

window.api.onState(state => {
  if (state.timeFormat) _timeFormat = state.timeFormat;

  // Cache last good usage data for offline fallback
  if (state.usage) _lastCachedUsage = state.usage;

  // Inject cached data when current fetch failed
  if (!state.usage && _lastCachedUsage) {
    state._cachedUsage = _lastCachedUsage;
  }

  render(state);

  // Stop refresh spinner when state arrives
  document.getElementById('refreshBtn').classList.remove('spinning');
});

// Refresh — start spinner immediately, stops when state arrives
document.getElementById('refreshBtn').addEventListener('click', () => {
  document.getElementById('refreshBtn').classList.add('spinning');
  window.api.refresh();
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.api.hidePopup();
  if ((e.ctrlKey || e.metaKey) && e.key === 'r') {
    e.preventDefault();
    document.getElementById('refreshBtn').classList.add('spinning');
    window.api.refresh();
  }
});

document.getElementById('settingsBtn').addEventListener('click', () =>
  window.api.openSettings());

document.getElementById('menuBtn').addEventListener('click', () =>
  window.api.showContextMenu());

window.api.popupReady();
