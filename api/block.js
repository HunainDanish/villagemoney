import { db, hasDb } from '../lib/db.js';
import { json, cdn, errorJson } from '../lib/http.js';
import { HOUSES_PER_BLOCK, firstHouseOfBlock } from '../shared/layout.js';

// GET /api/block?b=12 -> the (up to) 64 houses in block 12.
// A block is a primary-key range scan, and responses are CDN-cached, so the
// cost per visitor stays flat no matter how big the town gets. Yard decor and
// paint ride along here, so visitors see them without any realtime messages.
export async function GET(request) {
  if (!hasDb()) return errorJson('Database is not configured', 503);
  const b = Number(new URL(request.url).searchParams.get('b'));
  if (!Number.isInteger(b) || b < 0 || b > 1e7) return errorJson('Bad block number');

  const from = firstHouseOfBlock(b);
  const { data, error } = await db()
    .from('residents')
    .select('id, username, hidden, look, last_active')
    .gte('id', from)
    .lt('id', from + HOUSES_PER_BLOCK)
    .order('id');
  if (error) return errorJson('Could not load block', 500);

  const today = new Date().toISOString().slice(0, 10);
  const houses = data.map((r) => {
    const h = { id: r.id, u: r.hidden ? null : r.username };
    if (r.look?.decor?.some(Boolean)) h.d = r.look.decor;
    if (r.look?.paint && Object.keys(r.look.paint).length) h.p = r.look.paint;
    if (r.look?.tier > 1) h.t = r.look.tier; // upgraded house
    if (r.last_active === today) h.lit = 1; // porch light on tonight
    return h;
  });
  // Shorter cache than before: decor and porch lights change during the day.
  const full = houses.length === HOUSES_PER_BLOCK;
  return json({ b, houses }, { cache: cdn(full ? 120 : 20) });
}
