import { db, hasDb } from '../lib/db.js';
import { json, errorJson, readJson, setCookie } from '../lib/http.js';
import { currentResident, SESSION_COOKIE } from '../lib/auth.js';

// GET    /api/me            -> who is signed in (or { resident: null })
// PATCH  /api/me {hidden}   -> change privacy setting
// DELETE /api/me            -> delete house and account immediately

export async function GET(request) {
  if (!hasDb()) return json({ resident: null });
  const resident = await currentResident(request);
  return json({ resident });
}

export async function PATCH(request) {
  if (!hasDb()) return errorJson('Database is not configured', 503);
  const resident = await currentResident(request);
  if (!resident) return errorJson('Not signed in', 401);
  const body = await readJson(request);
  if (typeof body.hidden !== 'boolean') return errorJson('Nothing to change');
  const { data, error } = await db()
    .from('residents')
    .update({ hidden: body.hidden })
    .eq('id', resident.id)
    .select('id, username, hidden, look, created_at')
    .single();
  if (error) return errorJson('Could not save', 500);
  return json({ resident: data });
}

export async function DELETE(request) {
  if (!hasDb()) return errorJson('Database is not configured', 503);
  const resident = await currentResident(request);
  if (!resident) return errorJson('Not signed in', 401);
  // Sessions and keys go with it (ON DELETE CASCADE).
  const { error } = await db().from('residents').delete().eq('id', resident.id);
  if (error) return errorJson('Could not delete', 500);
  return json({ deleted: true }, { headers: { 'set-cookie': setCookie(SESSION_COOKIE, '', { maxAge: 0 }) } });
}
