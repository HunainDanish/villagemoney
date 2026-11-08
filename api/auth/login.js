import { db, hasDb } from '../../lib/db.js';
import { json, errorJson, readJson } from '../../lib/http.js';
import { createSession } from '../../lib/auth.js';
import { verifyPassword, burnTime } from '../../lib/password.js';
import { normalizeUsername } from '../../shared/layout.js';

const MAX_FAILS = 5;
const LOCK_MINUTES = 15;
const WRONG = 'Wrong username or password.';

// POST /api/auth/login { username, password } -> sets the session cookie.
// Residents set a password after their first sign-in with a house key.
export async function POST(request) {
  if (!hasDb()) return errorJson('Database is not configured', 503);
  const body = await readJson(request);
  const username = normalizeUsername(body.username);
  const password = typeof body.password === 'string' ? body.password : '';
  if (!username || !password) return errorJson('Enter your Instagram username and password');
  if (password.length > 200) return errorJson(WRONG, 401);

  const { data: r, error } = await db()
    .from('residents')
    .select('id, password_hash, failed_logins, locked_until')
    .eq('username', username)
    .maybeSingle();
  if (error) {
    if (/password_hash|failed_logins|locked_until/.test(error.message || '')) {
      return errorJson('Password sign-in needs a database update (supabase/003_passwords.sql).', 503);
    }
    return errorJson('Could not sign you in right now', 500);
  }

  // Same work and the same message whether or not the username exists.
  if (!r || !r.password_hash) {
    await burnTime(password);
    return errorJson(WRONG, 401);
  }
  if (r.locked_until && new Date(r.locked_until) > new Date()) {
    const mins = Math.ceil((new Date(r.locked_until) - Date.now()) / 60000);
    return errorJson(`Too many wrong tries. Try again in ${mins} min, or DM us "key" for a sign-in link.`, 429);
  }

  if (!(await verifyPassword(password, r.password_hash))) {
    const fails = (r.failed_logins || 0) + 1;
    const lock = fails >= MAX_FAILS ? new Date(Date.now() + LOCK_MINUTES * 60000).toISOString() : null;
    await db().from('residents').update({ failed_logins: lock ? 0 : fails, locked_until: lock }).eq('id', r.id);
    return errorJson(lock ? `Too many wrong tries. Try again in ${LOCK_MINUTES} min, or DM us "key" for a sign-in link.` : WRONG, lock ? 429 : 401);
  }

  if (r.failed_logins || r.locked_until) {
    await db().from('residents').update({ failed_logins: 0, locked_until: null }).eq('id', r.id);
  }
  const session = await createSession(r.id);
  return json({ ok: true }, { headers: { 'set-cookie': session.cookie } });
}
