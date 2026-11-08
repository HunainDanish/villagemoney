import { db, hasDb } from '../lib/db.js';
import { json, cdn, errorJson } from '../lib/http.js';

// Town size. Cached at the CDN for 30s, so even a million visitors a minute
// cost about two database queries a minute.
export async function GET() {
  if (!hasDb()) return errorJson('Database is not configured', 503);
  const [{ count, error: e1 }, { data, error: e2 }] = await Promise.all([
    db().from('residents').select('id', { count: 'estimated', head: true }),
    db().from('residents').select('id').order('id', { ascending: false }).limit(1),
  ]);
  if (e1 || e2) return errorJson('Could not load stats', 500);
  return json({ residents: count ?? 0, maxId: data?.[0]?.id ?? 0 }, { cache: cdn(30) });
}
