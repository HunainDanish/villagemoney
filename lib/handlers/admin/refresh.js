import { hasDb } from '../../db.js';
import { json, errorJson } from '../../http.js';
import { safeEqual } from '../../auth.js';
import { refreshIgToken } from '../../igtoken.js';

// GET /api/admin/refresh: run weekly by the Vercel cron in vercel.json, which
// sends "Authorization: Bearer $CRON_SECRET".
export async function GET(request) {
  if (!process.env.CRON_SECRET || !safeEqual(request.headers.get('authorization'), `Bearer ${process.env.CRON_SECRET}`)) {
    return errorJson('Forbidden', 403);
  }
  if (!hasDb() || !process.env.IG_ACCESS_TOKEN) return json({ skipped: 'Instagram is not configured' });
  try {
    return json({ ok: true, expires_at: await refreshIgToken() });
  } catch (e) {
    console.error('instagram token refresh', e);
    return errorJson(e.message, 502);
  }
}
