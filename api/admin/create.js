import { getOrCreateResident, hasDb } from '../../lib/db.js';
import { json, errorJson, readJson, siteOrigin } from '../../lib/http.js';
import { createHouseKey, isAdmin, keyLink } from '../../lib/auth.js';
import { normalizeUsername } from '../../shared/layout.js';

// POST /api/admin/create { username }  (header x-admin-secret)
// Builds the house if needed and returns a fresh single-use key link that you
// paste into an Instagram DM by hand. This is the stand-in for the automatic
// Instagram flow until Meta approves your app.
export async function POST(request) {
  if (!isAdmin(request)) return errorJson('Wrong admin secret', 401);
  if (!hasDb()) return errorJson('Database is not configured', 503);
  const username = normalizeUsername((await readJson(request)).username);
  if (!username) return errorJson('That is not a valid Instagram username');

  const resident = await getOrCreateResident(username, 'admin');
  const token = await createHouseKey(resident.id);
  return json({ id: resident.id, username: resident.username, link: keyLink(siteOrigin(request), token) });
}
