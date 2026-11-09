import { db } from './db.js';
import { applyBatch, initialState, publicLook } from '../shared/game.js';

// Load a resident's game state (creating the row on first use).
export async function loadProgress(residentId) {
  const { data, error } = await db().from('progress').select('state, updated_at').eq('resident_id', residentId).maybeSingle();
  if (error) throw error;
  if (data) return data;
  const fresh = { resident_id: residentId, state: initialState() };
  const ins = await db().from('progress').upsert(fresh, { onConflict: 'resident_id', ignoreDuplicates: true }).select('state, updated_at');
  if (ins.error) throw ins.error;
  if (ins.data?.[0]) return ins.data[0];
  return loadProgress(residentId);
}

// Apply actions with SERVER time and the shared rules, then save with
// compare-and-swap on updated_at. If another request saved in between,
// reload and retry, so actions are never applied twice or lost.
// trusted = server-only actions allowed (gifts, raid outcomes). Never pass
// true for actions that came straight from a browser.
export async function applyForResident(resident, actions, { trusted = false } = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await loadProgress(resident.id);
    const before = JSON.stringify(publicLook(row.state?.v ? row.state : initialState()));
    const { state, results } = applyBatch(row.state, actions, {
      now: Date.now(),
      rng: Math.random,
      trusted,
      seed: String(resident.id),
    });
    const { data, error } = await db()
      .from('progress')
      .update({ state, updated_at: new Date().toISOString() })
      .eq('resident_id', resident.id)
      .eq('updated_at', row.updated_at)
      .select('resident_id');
    if (error) throw error;
    if (!data?.length) continue; // lost the race, retry with fresh state

    // Mirror the public parts (yard decor, paint) for /api/block.
    const look = publicLook(state);
    if (JSON.stringify(look) !== before) {
      const up = await db().from('residents').update({ look }).eq('id', resident.id);
      if (up.error) throw up.error;
    }
    return { state, results };
  }
  throw new Error('Too many simultaneous updates, try again');
}
