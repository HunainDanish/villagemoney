import { hasDb } from '../lib/db.js';
import { json, errorJson } from '../lib/http.js';
import { currentResident } from '../lib/auth.js';
import { applyForResident } from '../lib/progress.js';

// POST /api/actions { actions: [...] } -> { state, results }
// The browser plays instantly and sends its actions in batches (about every
// 20 s, or at once for crafting, fishing, selling, decorating). The server
// re-runs them with its own clock and rules and returns the true state.
export async function POST(request) {
  if (!hasDb()) return errorJson('Database is not configured', 503);
  const resident = await currentResident(request);
  if (!resident) return errorJson('Not signed in', 401);

  let body;
  try {
    // text() rather than json(): navigator.sendBeacon posts text/plain.
    const raw = await request.text();
    if (raw.length > 20000) return errorJson('Too many actions', 413);
    body = JSON.parse(raw);
  } catch {
    return errorJson('Bad JSON');
  }
  const actions = Array.isArray(body?.actions) ? body.actions.slice(0, 60) : [];
  try {
    const { state, results } = await applyForResident(resident, actions);
    return json({ state, results: results.map((r) => ({ ok: r.ok, reason: r.reason })) });
  } catch (e) {
    console.error('actions failed', e);
    return errorJson('Could not save your progress', 500);
  }
}
