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
    await logVisits(resident.id, actions, results);
    return json({ state, results: results.map((r) => ({ ok: r.ok, reason: r.reason })) });
  } catch (e) {
    console.error('actions failed', e);
    return errorJson('Could not save your progress', 500);
  }
}

// Knocks feed each house's visitor log (supabase/006_visits.sql). A missing
// table or a knock on an empty plot must never fail the save itself.
async function logVisits(visitorId, actions, results) {
  const houses = new Set();
  actions.forEach((a, i) => {
    if (a?.a === 'visit' && results[i]?.ok && a.house !== visitorId) houses.add(a.house);
  });
  if (!houses.size) return;
  const rows = [...houses].map((house_id) => ({ house_id, visitor_id: visitorId }));
  const { error } = await db().from('visits').upsert(rows, { onConflict: 'house_id,visitor_id,day', ignoreDuplicates: true });
  if (error) console.error('visit log failed (run supabase/006_visits.sql)', error.message);
}
