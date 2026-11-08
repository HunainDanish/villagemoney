import { db, hasDb } from '../lib/db.js';
import { json, errorJson, readJson, setCookie } from '../lib/http.js';
import { currentResident, SESSION_COOKIE } from '../lib/auth.js';
import { applyForResident } from '../lib/progress.js';

// GET    /api/me            -> who is signed in (or { resident: null })
// PATCH  /api/me {hidden}   -> change privacy setting
// DELETE /api/me            -> delete house and account immediately

const MIGRATION_HINT =
  'Your database needs the game update: run supabase/002_game.sql in Supabase → SQL Editor. Until then progress is not saved.';
const PASSWORD_HINT = 'Passwords need a database update: run supabase/003_passwords.sql in Supabase → SQL Editor.';

export async function GET(request) {
  if (!hasDb()) return json({ resident: null });
  let resident;
  try {
    resident = await currentResident(request);
  } catch (e) {
    console.error('session lookup failed', e);
    return errorJson(`Could not check your sign-in: ${e.message || 'database error'}`, 500);
  }
  if (!resident) return json({ resident: null });
  const { missingMigration, ...publicResident } = resident;
  if (missingMigration === '002_game.sql') {
    return json({ resident: publicResident, state: null, events: [], warning: MIGRATION_HINT });
  }
  const passwordWarning = missingMigration === '003_passwords.sql' ? PASSWORD_HINT : undefined;

  // Porch light: mark today as visited (one small write per resident per day).
  const today = new Date().toISOString().slice(0, 10);
  if (resident.last_active !== today) {
    await db().from('residents').update({ last_active: today }).eq('id', resident.id);
  }
  // Daily check-in runs the rollover (streak, login gift) on the server.
  let state = null;
  let events = [];
  try {
    const r = await applyForResident(resident, [{ a: 'checkin' }]);
    state = r.state;
    events = r.results[0]?.events || []; // e.g. the daily streak gift
  } catch (e) {
    console.error('checkin failed', e); // the town still works without progress
    const missing = /progress|relation|schema cache/i.test(e.message || '');
    return json({ resident: publicResident, state: null, events: [], warning: missing ? MIGRATION_HINT : 'Could not load your progress right now.' });
  }
  return json({ resident: publicResident, state, events, warning: passwordWarning });
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
