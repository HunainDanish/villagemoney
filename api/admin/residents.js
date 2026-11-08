import { db, hasDb } from '../../lib/db.js';
import { json, errorJson } from '../../lib/http.js';
import { adminProblem } from '../../lib/auth.js';
import { normalizeUsername } from '../../shared/layout.js';

// GET    /api/admin/residents            -> latest 50 residents
// DELETE /api/admin/residents?u=name     -> remove a house (moderation)
export async function GET(request) {
  const problem = adminProblem(request);
  if (problem) return errorJson(problem, 401);
  if (!hasDb()) return errorJson('Database is not configured', 503);
  const { data, error } = await db()
    .from('residents')
    .select('id, username, hidden, source, created_at')
    .order('id', { ascending: false })
    .limit(50);
  if (error) return errorJson('Could not load', 500);
  return json({ residents: data });
}

export async function DELETE(request) {
  const problem = adminProblem(request);
  if (problem) return errorJson(problem, 401);
  if (!hasDb()) return errorJson('Database is not configured', 503);
  const u = normalizeUsername(new URL(request.url).searchParams.get('u'));
  if (!u) return errorJson('Bad username');
  const { error } = await db().from('residents').delete().eq('username', u);
  if (error) return errorJson('Could not delete', 500);
  return json({ deleted: u });
}
