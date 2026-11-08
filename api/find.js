import { db, hasDb } from '../lib/db.js';
import { json, cdn, errorJson } from '../lib/http.js';
import { normalizeUsername } from '../shared/layout.js';

// GET /api/find?u=username -> { id } so the client can fly to the house.
export async function GET(request) {
  if (!hasDb()) return errorJson('Database is not configured', 503);
  const u = normalizeUsername(new URL(request.url).searchParams.get('u'));
  if (!u) return errorJson('That is not a valid Instagram username');

  const { data, error } = await db().from('residents').select('id, hidden').eq('username', u).maybeSingle();
  if (error) return errorJson('Search failed', 500);
  // Hidden residents can't be found by name.
  if (!data || data.hidden) return json({ found: false }, { status: 404, cache: cdn(15) });
  return json({ found: true, id: data.id }, { cache: cdn(60) });
}
