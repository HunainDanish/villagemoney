import { db, hasDb } from '../lib/db.js';
import { json, cdn, errorJson } from '../lib/http.js';
import { firstHouseOfBlock, lastHouseOfBlock } from '../shared/layout.js';

// GET /api/block?b=12 -> the (up to) 64 houses in block 12 (the outer district
// blocks hold fewer: see shared/layout.js).
// A block is a primary-key range scan, and responses are CDN-cached, so the
// cost per visitor stays flat no matter how big the town gets. Yard decor,
// paint, garden, defences, job, car and housemates ride along here, so
// visitors see them without any realtime messages.
export async function GET(request) {
  if (!hasDb()) return errorJson('Database is not configured', 503);
  const b = Number(new URL(request.url).searchParams.get('b'));
  if (!Number.isInteger(b) || b < 0 || b > 1e7) return errorJson('Bad block number');

  const from = firstHouseOfBlock(b);
  const to = lastHouseOfBlock(b) + 1;
  const range = (q) => q.gte('id', from).lt('id', to).order('id');
  let { data, error } = await range(db().from('residents').select('id, username, hidden, look, last_active, home_id'));
  let social = true;
  if (error && /home_id/.test(error.message || '')) {
    // supabase/004_social.sql not run yet: everything except housemates works.
    ({ data, error } = await range(db().from('residents').select('id, username, hidden, look, last_active')));
    social = false;
  }
  if (error) return errorJson('Could not load block', 500);

  // People who moved in with a resident of this block (their own plot is elsewhere).
  const mates = {};
  if (social) {
    const { data: movedIn } = await db().from('residents').select('username, hidden, home_id').gte('home_id', from).lt('home_id', to);
    for (const m of movedIn || []) (mates[m.home_id] ||= []).push(m.hidden ? null : m.username);
  }

  const today = new Date().toISOString().slice(0, 10);
  const houses = data.map((r) => {
    const h = { id: r.id, u: r.hidden ? null : r.username };
    const look = r.look || {};
    if (look.decor?.some(Boolean)) h.d = look.decor;
    if (look.paint && Object.keys(look.paint).length) h.p = look.paint;
    if (Number(look.tier) > 1) h.t = Number(look.tier); // upgraded house
    if (look.garden?.some(Boolean)) h.g = look.garden; // crops growing in the yard
    if (look.def && (look.def.lock || look.def.dog || look.def.alarm)) h.df = look.def;
    if (look.raid) h.r = 1; // raid mode on
    if (look.shield > Date.now()) h.sh = look.shield;
    if (look.job) h.j = look.job;
    if (look.car) h.c = look.car; // parked in the driveway
    if (r.last_active === today) h.lit = 1; // porch light on tonight
    if (r.home_id) h.mv = r.home_id; // moved in elsewhere: this plot stands empty
    if (mates[r.id]) h.m = mates[r.id];
    return h;
  });
  const full = houses.length === to - from;
  return json({ b, houses }, { cache: cdn(full ? 60 : 15) });
}
