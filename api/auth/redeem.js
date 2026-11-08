import { hasDb } from '../../lib/db.js';
import { json, errorJson, readJson } from '../../lib/http.js';
import { redeemHouseKey } from '../../lib/auth.js';

// POST /api/auth/redeem { token } -> sets the session cookie.
// It is a POST fired by a button on /key, never a plain GET, because Instagram
// (and other apps) open links to build previews, which would burn a GET key.
export async function POST(request) {
  if (!hasDb()) return errorJson('Database is not configured', 503);
  const { token } = await readJson(request);
  const session = await redeemHouseKey(token);
  if (!session) return errorJson('This key has expired or was already used. Ask for a new one.', 410);
  return json({ ok: true }, { headers: { 'set-cookie': session.cookie } });
}
