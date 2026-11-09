import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { db } from './db.js';
import { getCookie, setCookie } from './http.js';

export const SESSION_COOKIE = 'pl_s';
const SESSION_DAYS = 365;
const KEY_DAYS = 30;

const newToken = () => randomBytes(32).toString('base64url');
export const hashToken = (t) => createHash('sha256').update(t).digest('hex');

export function safeEqual(a, b) {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  return x.length === y.length && timingSafeEqual(x, y);
}

// Create a single-use "house key" link for a resident. Returns the raw token;
// only its hash is stored, so a database leak can't be used to sign in.
export async function createHouseKey(residentId) {
  const token = newToken();
  const expires = new Date(Date.now() + KEY_DAYS * 864e5).toISOString();
  const { error } = await db()
    .from('house_keys')
    .insert({ token_hash: hashToken(token), resident_id: residentId, expires_at: expires });
  if (error) throw error;
  return token;
}

export const keyLink = (origin, token) => `${origin}/key?t=${token}`;

// Exchange a house key for a session. The key is consumed atomically: the
// update only matches an unused, unexpired key, so it can't be used twice.
export async function redeemHouseKey(token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
  const now = new Date().toISOString();
  const { data, error } = await db()
    .from('house_keys')
    .update({ used_at: now })
    .eq('token_hash', hashToken(token))
    .is('used_at', null)
    .gt('expires_at', now)
    .select('resident_id')
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return createSession(data.resident_id);
}

export async function createSession(residentId) {
  const token = newToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  const { error } = await db()
    .from('sessions')
    .insert({ token_hash: hashToken(token), resident_id: residentId, expires_at: expires });
  if (error) throw error;
  return { token, cookie: setCookie(SESSION_COOKIE, token, { maxAge: SESSION_DAYS * 86400 }) };
}

// Resident for the session cookie on this request, or null.
export async function currentResident(request) {
  const token = getCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const lookup = (cols) =>
    db().from('sessions').select(`expires_at, residents(${cols})`).eq('token_hash', hashToken(token)).maybeSingle();
  // Columns added by later migrations are optional: if a migration hasn't
  // been run yet, still sign the person in and say which file is missing.
  const base = 'id, username, hidden, look, created_at';
  let { data, error } = await lookup(`${base}, last_active, password_hash, home_id`);
  let missing = null;
  if (error && /home_id/.test(error.message || '')) {
    ({ data, error } = await lookup(`${base}, last_active, password_hash`));
    missing = '004_social.sql';
  }
  if (error && /password_hash/.test(error.message || '')) {
    ({ data, error } = await lookup(`${base}, last_active`));
    missing = '003_passwords.sql';
  }
  if (error && /last_active/.test(error.message || '')) {
    ({ data, error } = await lookup(base));
    missing = '002_game.sql';
  }
  if (error) throw error;
  if (!data?.residents || new Date(data.expires_at) < new Date()) return null;
  const { password_hash: hash, ...resident } = data.residents; // never hand the hash out
  resident.has_password = Boolean(hash);
  if (missing) resident.missingMigration = missing;
  return resident;
}

export async function endSession(request) {
  const token = getCookie(request, SESSION_COOKIE);
  if (token) await db().from('sessions').delete().eq('token_hash', hashToken(token));
  return setCookie(SESSION_COOKIE, '', { maxAge: 0 });
}

// Why admin access was refused (null = allowed). Spaces/newlines pasted into
// Vercel or the form are ignored. Saying "not set" or "too short" leaks
// nothing useful, and saves a lot of head-scratching.
export function adminProblem(request) {
  const secret = (process.env.ADMIN_SECRET || '').trim();
  if (!secret) return 'ADMIN_SECRET is not set on this deployment. Add it in Vercel → Settings → Environment Variables, then redeploy.';
  if (secret.length < 16) return 'ADMIN_SECRET in Vercel is shorter than 16 characters. Use a longer one, then redeploy.';
  const given = (request.headers.get('x-admin-secret') || '').trim();
  if (!safeEqual(given, secret)) return 'Wrong admin secret.';
  return null;
}

export const isAdmin = (request) => adminProblem(request) === null;
