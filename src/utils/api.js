const BASE = 'https://claude.ai/api/organizations';

function headers(sessionKey) {
  return {
    'accept': '*/*',
    'accept-language': 'en-US,en;q=0.9',
    'content-type': 'application/json',
    'anthropic-client-platform': 'web_claude_ai',
    'anthropic-client-version': '1.0.0',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'origin': 'https://claude.ai',
    'referer': 'https://claude.ai/settings/usage',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    'Cookie': `sessionKey=${sessionKey}`,
  };
}

function parseLimit(raw) {
  if (!raw) return null;
  const { utilization, resets_at } = raw;
  if (!utilization && !resets_at) return null;
  return {
    percentage: parseFloat(utilization) || 0,
    resetsAt: resets_at ? new Date(resets_at) : null,
  };
}

async function checkResponse(res, label) {
  // Check status codes first so auth errors are classified correctly even if
  // the response body happens to be an HTML page (e.g. a login redirect) (M3)
  if (res.status === 401) throw Object.assign(new Error('Session key expired or invalid'), { code: 'AUTH' });
  if (res.status === 403) throw Object.assign(new Error('Access denied (403)'), { code: 'CLOUDFLARE' });
  if (res.status === 429) throw Object.assign(new Error('Rate limited'), { code: 'RATE_LIMIT' });

  const text = await res.text();
  if (text.includes('<!DOCTYPE html>') || text.includes('<html')) {
    throw Object.assign(new Error('Cloudflare blocked the request'), { code: 'CLOUDFLARE' });
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${label}`);
  return JSON.parse(text);
}

async function fetchOrganizations(sessionKey) {
  const res = await fetch('https://claude.ai/api/organizations', { headers: headers(sessionKey) });
  const data = await checkResponse(res, 'organizations');
  return data
    .filter(o => o.uuid || o.id) // L5: skip orgs with no usable identifier
    .map(o => ({ id: o.id, uuid: o.uuid || o.id, name: o.name || o.uuid || o.id }));
}

async function fetchUsage(sessionKey, orgId) {
  const [usageRes, extraRes] = await Promise.allSettled([
    fetch(`${BASE}/${orgId}/usage`, { headers: headers(sessionKey) }),
    fetch(`${BASE}/${orgId}/overage_spend_limit`, { headers: headers(sessionKey) }),
  ]);

  if (usageRes.status === 'rejected') throw new Error('Network error');

  const data = await checkResponse(usageRes.value, 'usage');
  if (data?.error?.type === 'permission_error') {
    throw Object.assign(new Error('Permission denied — session may be expired'), { code: 'AUTH' });
  }

  let extra = null;
  if (extraRes.status === 'fulfilled') {
    const er = extraRes.value;
    if (er.ok) {
      try {
        const ed = JSON.parse(await er.text());
        const limitCents = ed.spend_limit_amount_cents;
        if (limitCents > 0) {
          extra = {
            enabled: true,
            used: (ed.balance_cents || 0) / 100,
            limit: limitCents / 100,
            currency: (ed.spend_limit_currency || 'usd').toUpperCase(),
          };
        } else {
          extra = { enabled: false };
        }
      } catch (parseErr) {
        console.warn('Failed to parse overage response:', parseErr.message); // M2: log, don't silently swallow
      }
    }
  }

  return {
    fiveHour: parseLimit(data.five_hour),
    sevenDay: parseLimit(data.seven_day),
    opus:     parseLimit(data.seven_day_opus),
    sonnet:   parseLimit(data.seven_day_sonnet),
    extra,
    fetchedAt: Date.now(),
  };
}

async function checkForUpdate(repo) {
  if (!repo) return null;
  const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.tag_name?.replace(/^v/, '') || null;
}

module.exports = { fetchOrganizations, fetchUsage, checkForUpdate };
