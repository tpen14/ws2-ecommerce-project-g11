const fetch = undefined; // placeholder so linter/IDE knows fetch will be resolved

async function _getFetch() {
  // If global fetch (Node 18+) is available, use it
  if (typeof globalThis.fetch === 'function') return globalThis.fetch;

  // Try CommonJS require (node-fetch v2)
  try {
    // eslint-disable-next-line global-require
    const nf = require('node-fetch');
    return nf;
  } catch (err) {
    // ignore - maybe ESM-only node-fetch
  }

  // Fallback to dynamic import (works for node-fetch v3 ESM)
  try {
    const mod = await import('node-fetch');
    return mod.default || mod;
  } catch (err) {
    throw new Error('No fetch implementation available. Install node-fetch or run on Node 18+');
  }
}

// Function to verify Cloudflare Turnstile response
async function verifyTurnstile(token, ip) {
  const fetchImpl = await _getFetch();

  const secret = process.env.TURNSTILE_SECRET;
  if (!secret) {
    return { success: false, error: 'TURNSTILE_SECRET not configured' };
  }

  const params = new URLSearchParams();
  params.append('secret', secret);
  params.append('response', token);
  if (ip) params.append('remoteip', ip);

  const res = await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { success: false, error: `Turnstile verify HTTP ${res.status}: ${text}` };
  }

  const data = await res.json();
  return data;
}

module.exports = verifyTurnstile;