import { db, hasDb } from '../lib/db.js';
import { json, cdn, errorJson } from '../lib/http.js';

// Town size. Cached at the CDN for 30s, so even a million visitors a minute
// cost about two database queries a minute.
export async function GET() {
  if (!hasDb()) return errorJson('Database is not configured', 503);
  const [{ count, error: e1 }, { data, error: e2 }] = await Promise.all([
    db().from('residents').select('id', { count: 'estimated', head: true }),
    // Newest residents (for "New neighbours"); hidden names are skipped.
    db().from('residents').select('id, username, hidden').order('id', { ascending: false }).limit(12),
  ]);
  if (e1 || e2) return errorJson('Could not load stats', 500);
  const latest = (data || []).filter((r) => !r.hidden).slice(0, 8).map((r) => ({ id: r.id, u: r.username }));
  return json({ residents: count ?? 0, maxId: data?.[0]?.id ?? 0, latest }, { cache: cdn(30) });
}
