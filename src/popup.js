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

  // Format date as "24 Mar 26" (day month-short 2-digit-year)
  const dateStr = `${d.getDate()} ${d.toLocaleString([], { month: 'short' })} ${String(d.getFullYear()).slice(-2)}`;

  if (style === 'short') {
    if (isToday) return `Today ${timeStr}`;
    if (isTomorrow) return `Tmrw ${timeStr}`;
    return dateStr;
  }
  const hourStr = d.toLocaleTimeString([], { hour: 'numeric', hour12 });
  if (isToday) return `Today ${hourStr}`;
  if (isTomorrow) return `Tmrw ${hourStr}`;
  return dateStr;
}

function formatRemaining(resetsAt) {
  if (!resetsAt) return '—';
  const diffMs = new Date(resetsAt) - Date.now();
  if (diffMs <= 0) return '—';
  const totalMin = Math.floor(diffMs / 60000);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// ── Overclock / Baseline status ──────────────────────────────────────────
// The 2x usage boost promotion ran March 13–28, 2026 PT.
// Off-peak (overclocked): weekends all day, weekdays outside 5–11 AM PT.
// After the promotion ends, the row is hidden.

let _overclockTimer = null;

// Promotion window (Pacific Time)
const PROMO_END = new Date('2026-03-29T07:59:00Z'); // Mar 28 11:59 PM PT = Mar 29 07:59 UTC

function isPromoActive() {
  return Date.now() < PROMO_END.getTime();
}

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
      targetDayOffset = ptDay === 0 ? 1 : 2;
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
  let transitionMs = Math.max(0, target - pt);

  // Cap countdown to promo end if transition is after promo end
  const msUntilPromoEnd = PROMO_END.getTime() - now.getTime();
  if (isOverclocked && transitionMs > msUntilPromoEnd) {
    transitionMs = Math.max(0, msUntilPromoEnd);
  }

  return {
    isOverclocked,
    label: isOverclocked ? 'OVERCLOCKED' : 'BASELINE',
    transitionMs,
    nextLabel: isOverclocked ? 'Baseline' : 'Overclocked',
  };
}

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

  // Hide row entirely if promotion has ended
  if (!isPromoActive()) {
    row.style.display = 'none';
    if (_overclockTimer) { clearInterval(_overclockTimer); _overclockTimer = null; }
    return;
  }

  const oc = getOverclockStateLocal();
  row.style.display = 'flex';

  const color = oc.isOverclocked ? '#e8a020' : '#8e8e93';
  document.getElementById('overclockIcon').innerHTML =
    oc.isOverclocked ? boltIcon(color) : dashIcon(color);
  document.getElementById('overclockLabel').textContent =
    oc.isOverclocked ? 'Overclocked' : 'Baseline';
  document.getElementById('overclockCountdown').textContent = formatCountdown(oc.transitionMs);
}

// ── Time display toggle (remaining ↔ reset) ─────────────────────────────

let _showRemaining = false;
let _lastState = null; // cached for animated re-render after toggle

// ── Render ────────────────────────────────────────────────────────────────

function render(state) {
  const { usage, error, account, lastFetched, timeFormat } = state;

  // Compact mode
  const isCompact = state.compactMode || false;
  document.body.classList.toggle('compact', isCompact);
  document.getElementById('compactBtn').textContent = isCompact ? '▲' : '▼';

  // Pin state
  document.getElementById('pinBtn').classList.toggle('pinned', state.pinPopup || false);

  document.getElementById('accountLabel').textContent =
    state.multiAccount ? (account?.alias || account?.orgName || '') : '';

  const errorRow = document.getElementById('errorRow');
  if (error) {
    errorRow.style.display = 'flex';
    // Better error messages with actionable guidance
    let errorMsg = error;
    if (error === 'Not configured') errorMsg = 'No accounts added. Open Settings to add one.';
    else if (error.includes('401') || error.includes('AUTH') || error.includes('expired'))
      errorMsg = 'Session expired. Open Settings to log in again.';
    else if (error.includes('403') || error.includes('CLOUDFLARE'))
      errorMsg = 'Blocked by Cloudflare. Try again in a few minutes.';
    else if (error.includes('429') || error.includes('RATE_LIMIT'))
      errorMsg = 'Rate limited. Will retry automatically.';
    errorRow.innerHTML = '';
    const msgSpan = document.createElement('span');
    msgSpan.textContent = '\u26A0 ' + errorMsg;
    const copyBtn = document.createElement('button');
    copyBtn.className = 'error-copy';
    copyBtn.textContent = 'Copy';
    copyBtn.title = 'Copy error to clipboard';
    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(errorMsg).then(() => { copyBtn.textContent = 'Copied'; setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500); });
    });
    errorRow.append(msgSpan, copyBtn);
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
      if (!data.enabled) return;
      // Locale-aware currency formatting with cents precision (upstream v2.6.1 fix):
      // - System locale picks symbol position + decimal separator (e.g. $1.50 vs 1,50 €)
      // - 2 fraction digits — previously rounded to whole units
      const fmt = new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: data.currency || 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
      valueStr = `${fmt.format(data.used)} / ${fmt.format(data.limit)}`;
      if (data.outOfCredits) valueStr += ' \u26A0'; // ⚠ out of credits
    } else {
      valueStr = _showRemaining
        ? formatRemaining(data.resetsAt)
        : formatResetTime(data.resetsAt, timeStyle);
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

  // Quota projection — estimate time to 100% based on sparkline trend
  const projRow = document.getElementById('projectionRow');
  const hist = state.history;
  if (hist && hist.length >= 3 && displayUsage) {
    const primary = displayUsage.fiveHour || displayUsage.sevenDay;
    if (primary && primary.percentage < 100 && primary.resetsAt) {
      // Linear regression on last N points to get rate (% per data point)
      const n = hist.length;
      const latest = hist[n - 1];
      const oldest = hist[0];
      const ratePerPoint = (latest - oldest) / (n - 1);
      if (ratePerPoint > 0.5) { // meaningful upward trend
        const remaining = 100 - latest;
        const pointsTo100 = remaining / ratePerPoint;
        // Each point ≈ 1 refresh interval (configured minutes)
        const refreshMin = 3; // approximate
        const minsTo100 = pointsTo100 * refreshMin;
        const resetMs = new Date(primary.resetsAt) - Date.now();
        const resetMin = resetMs / 60000;
        if (minsTo100 < resetMin) {
          // Will hit 100% before reset
          const h = Math.floor(minsTo100 / 60);
          const m = Math.round(minsTo100 % 60);
          const etaStr = h > 0 ? `${h}h ${m}m` : `${m}m`;
          projRow.textContent = `\u26A0 At current rate, 100% in ~${etaStr} (before reset)`;
          projRow.className = 'projection-row warn';
          projRow.style.display = 'block';
        } else {
          projRow.style.display = 'none';
        }
      } else {
        projRow.style.display = 'none';
      }
    } else {
      projRow.style.display = 'none';
    }
  } else {
    projRow.style.display = 'none';
  }

  // Reauth banner
  const reauthBanner = document.getElementById('reauthBanner');
  reauthBanner.style.display = state.needsReauth ? 'block' : 'none';

  // Muted badge + pause button state
  const pausedUntil = state.notificationsPausedUntil || 0;
  const isPaused = pausedUntil && Date.now() < pausedUntil;
  document.getElementById('mutedBadge').style.display = isPaused ? 'inline-block' : 'none';
  document.getElementById('pauseBtn').textContent = isPaused ? '🔕' : '🔔';
  document.getElementById('resumeChip').style.display = isPaused ? 'inline-block' : 'none';
  // Highlight active pause chip
  document.querySelectorAll('#pauseMenu .pause-chip').forEach(c => c.classList.remove('active'));

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

// Start/stop overclock timer based on popup visibility to avoid wasted DOM updates
updateOverclockRow(); // show initial state immediately
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (_overclockTimer) { clearInterval(_overclockTimer); _overclockTimer = null; }
  } else {
    updateOverclockRow();
    if (!_overclockTimer) _overclockTimer = setInterval(updateOverclockRow, 1000);
  }
});
// Start ticking since popup opens visible
_overclockTimer = setInterval(updateOverclockRow, 1000);

const _cachedUsageByAccount = {}; // per-account offline cache

window.api.onState(state => {
  if (state.timeFormat) _timeFormat = state.timeFormat;
  if (state.showRemaining != null) _showRemaining = state.showRemaining;

  // Cache last good usage data per account for offline fallback
  const orgId = state.account?.orgId;
  if (state.usage && orgId) _cachedUsageByAccount[orgId] = state.usage;

  // Inject correct account's cached data when current fetch failed
  if (!state.usage && orgId && _cachedUsageByAccount[orgId]) {
    state._cachedUsage = _cachedUsageByAccount[orgId];
  }

  _lastState = state;
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

// Toggle remaining ↔ reset time on rows click (with slide animation)
document.getElementById('rows').addEventListener('click', () => {
  if (!_lastState) return;
  const valueEls = document.querySelectorAll('#rows .row-value');
  if (!valueEls.length) return;

  // Phase 1: slide out
  valueEls.forEach(el => el.classList.add('slide-out'));

  setTimeout(() => {
    // Toggle mode and persist
    _showRemaining = !_showRemaining;
    window.api.setShowRemaining(_showRemaining);

    // Re-render with new mode (updates text content)
    render(_lastState);

    // Phase 2: slide in
    const newValueEls = document.querySelectorAll('#rows .row-value');
    newValueEls.forEach(el => {
      el.classList.add('slide-in');
      el.addEventListener('animationend', () => el.classList.remove('slide-in'), { once: true });
    });
  }, 180); // match slideOut duration
});

// Compact mode toggle
document.getElementById('compactBtn').addEventListener('click', () => {
  if (!_lastState) return;
  const newVal = !(_lastState.compactMode || false);
  _lastState.compactMode = newVal;
  window.api.setCompactMode(newVal);
  render(_lastState);
});

// Pin popup toggle
document.getElementById('pinBtn').addEventListener('click', () => {
  if (!_lastState) return;
  const newVal = !(_lastState.pinPopup || false);
  _lastState.pinPopup = newVal;
  window.api.setPinPopup(newVal);
  render(_lastState);
});

// Reauth banner opens settings
document.getElementById('reauthBanner').addEventListener('click', () =>
  window.api.openSettings());

// Pause notifications toggle menu
document.getElementById('pauseBtn').addEventListener('click', () => {
  document.getElementById('pauseMenu').classList.toggle('visible');
});

document.querySelectorAll('#pauseMenu .pause-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    const ms = parseInt(chip.dataset.ms);
    window.api.pauseNotifications(ms);
    document.getElementById('pauseMenu').classList.remove('visible');
  });
});

document.getElementById('settingsBtn').addEventListener('click', () =>
  window.api.openSettings());

document.getElementById('menuBtn').addEventListener('click', () =>
  window.api.showContextMenu());

window.api.popupReady();
