import { hasDb } from '../../db.js';
import { json } from '../../http.js';
import { endSession } from '../../auth.js';

export async function POST(request) {
  if (!hasDb()) return json({ ok: true });
  const cookie = await endSession(request);
  return json({ ok: true }, { headers: { 'set-cookie': cookie } });
}
