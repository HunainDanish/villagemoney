import { db, hasDb } from '../../db.js';
import { json, errorJson, readJson } from '../../http.js';
import { currentResident } from '../../auth.js';
import { hashPassword, passwordProblem } from '../../password.js';

// POST /api/auth/password { password } -> set or change your password.
// Only for someone already signed in (with a house key or their password),
// which is what proves they own the Instagram account.
export async function POST(request) {
  if (!hasDb()) return errorJson('Database is not configured', 503);
  const resident = await currentResident(request);
  if (!resident) return errorJson('Sign in first (open a house key link)', 401);
  if (resident.missingMigration) {
    return errorJson('Passwords need a database update: run supabase/003_passwords.sql in Supabase.', 503);
  }
  const { password } = await readJson(request);
  const problem = passwordProblem(password);
  if (problem) return errorJson(problem);

  const password_hash = await hashPassword(password);
  const { error } = await db()
    .from('residents')
    .update({ password_hash, failed_logins: 0, locked_until: null })
    .eq('id', resident.id);
  if (error) return errorJson('Could not save your password', 500);
  return json({ ok: true });
}
