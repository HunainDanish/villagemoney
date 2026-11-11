import { db, hasDb } from '../lib/db.js';
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
    // Bricks for the town's villas (paid with house points above).
    const bricks = [0, 0];
    for (const r of results) for (const e of r.events || []) if (e.type === 'brick') bricks[e.villa]++;
    for (const v of [0, 1]) {
      if (!bricks[v]) continue;
      const { error } = await db().rpc('villa_add', { p_villa: v, p_n: bricks[v] });
      if (error) console.error('villa_add failed (run supabase/005_villas.sql)', error.message);
    }
    return json({ state, results: results.map((r) => ({ ok: r.ok, reason: r.reason })) });
  } catch (e) {
    console.error('actions failed', e);
    return errorJson('Could not save your progress', 500);
  }
}
