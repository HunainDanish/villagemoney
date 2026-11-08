import { hasDb } from '../../lib/db.js';
import { json } from '../../lib/http.js';
import { endSession } from '../../lib/auth.js';

export async function POST(request) {
  if (!hasDb()) return json({ ok: true });
  const cookie = await endSession(request);
  return json({ ok: true }, { headers: { 'set-cookie': cookie } });
}
