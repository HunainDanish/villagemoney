import { db, hasDb } from '../lib/db.js';
import { json, cdn, errorJson } from '../lib/http.js';
import { HOUSES_PER_BLOCK, firstHouseOfBlock } from '../shared/layout.js';

// GET /api/block?b=12 -> the (up to) 64 houses in block 12.
// A block is a primary-key range scan, and responses are CDN-cached, so the
// cost per visitor stays flat no matter how big the town gets.
export async function GET(request) {
  if (!hasDb()) return errorJson('Database is not configured', 503);
  const b = Number(new URL(request.url).searchParams.get('b'));
  if (!Number.isInteger(b) || b < 0 || b > 1e7) return errorJson('Bad block number');

  const from = firstHouseOfBlock(b);
  const { data, error } = await db()
    .from('residents')
    .select('id, username, hidden')
    .gte('id', from)
    .lt('id', from + HOUSES_PER_BLOCK)
    .order('id');
  if (error) return errorJson('Could not load block', 500);

  const houses = data.map((r) => ({ id: r.id, u: r.hidden ? null : r.username }));
  // A full block rarely changes (only hides/deletes), so cache it longer.
  const full = houses.length === HOUSES_PER_BLOCK;
  return json({ b, houses }, { cache: cdn(full ? 300 : 20) });
}
