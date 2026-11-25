import { createHmac } from 'node:crypto';
import { getOrCreateResident, hasDb } from '../lib/db.js';
import { createHouseKey, keyLink, safeEqual } from '../lib/auth.js';
import { siteOrigin } from '../lib/http.js';
import { normalizeUsername } from '../shared/layout.js';
import { igToken } from '../lib/igtoken.js';

// Instagram webhook: dormant until the IG_* environment variables are set.
//
//   DM "key"          -> build house if needed, DM back a single-use key link
//   comment with 🏠   -> build the commenter's house and reply with its number
//
// Setup (after Meta approves your app): in the Meta developer dashboard set the
// callback URL to https://YOUR-SITE/api/instagram, the verify token to
// IG_VERIFY_TOKEN, and subscribe to the `messages` and `comments` fields.
// Check field names against Meta's current Instagram API docs when you set it up.

const API = () => `https://graph.instagram.com/${process.env.IG_API_VERSION || 'v21.0'}`;
const enabled = () =>
  Boolean(process.env.IG_APP_SECRET && process.env.IG_ACCESS_TOKEN && process.env.IG_VERIFY_TOKEN && hasDb());

// Meta calls this once to confirm you own the URL.
export function GET(request) {
  const p = new URL(request.url).searchParams;
  if (
    process.env.IG_VERIFY_TOKEN &&
    p.get('hub.mode') === 'subscribe' &&
    safeEqual(p.get('hub.verify_token'), process.env.IG_VERIFY_TOKEN)
  ) {
    return new Response(p.get('hub.challenge') ?? '', { status: 200 });
  }
  return new Response('Forbidden', { status: 403 });
}

export async function POST(request) {
  if (!enabled()) return new Response('Instagram is not configured', { status: 503 });

  // Reject anything not signed by Meta with your app secret.
  const raw = await request.text();
  const expected = 'sha256=' + createHmac('sha256', process.env.IG_APP_SECRET).update(raw).digest('hex');
  if (!safeEqual(request.headers.get('x-hub-signature-256'), expected)) {
    return new Response('Bad signature', { status: 401 });
  }

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response('Bad JSON', { status: 400 });
  }

  const origin = siteOrigin(request);
  const jobs = [];
  for (const entry of body.entry ?? []) {
    for (const m of entry.messaging ?? []) jobs.push(handleMessage(m, origin));
    for (const c of entry.changes ?? []) if (c.field === 'comments') jobs.push(handleComment(c.value, origin));
  }
  // Always answer 200 once the signature is valid, or Meta retries and
  // eventually disables the webhook. Failures are logged instead.
  const results = await Promise.allSettled(jobs);
  for (const r of results) if (r.status === 'rejected') console.error('instagram webhook job failed', r.reason);
  return new Response('ok', { status: 200 });
}

async function handleMessage(m, origin) {
  if (m.message?.is_echo) return; // our own replies come back as echoes
  const text = (m.message?.text || '').trim().toLowerCase();
  if (text !== 'key') return;
  const senderId = m.sender?.id;
  if (!senderId) return;

  // The DM itself proves the sender owns this account: Instagram only lets
  // you message from an account you are logged into.
  const username = normalizeUsername(await lookupUsername(senderId));
  if (!username) return;
  const resident = await getOrCreateResident(username, 'dm', senderId);
  const token = await createHouseKey(resident.id);
  await sendDm(
    senderId,
    `Here is your house key 🔑 ${keyLink(origin, token)}\nIt works once and expires in 30 days. Don't share it. Send "key" again any time for a new one.`,
  );
}

async function handleComment(value, origin) {
  if (!value?.text?.includes('🏠')) return;
  const username = normalizeUsername(value.from?.username);
  if (!username) return;
  const resident = await getOrCreateResident(username, 'comment', value.from?.id ?? null);
  // Reply only when this comment built the house, so repeat 🏠s stay quiet.
  if (!value.id || Date.now() - new Date(resident.created_at).getTime() > 60e3) return;
  await graph(`${value.id}/replies`, {
    message: `House #${resident.id} is yours 🏠 ${origin}/?h=${username} · DM me "key" to move in`,
  });
}

async function lookupUsername(igsid) {
  const res = await fetch(`${API()}/${igsid}?fields=username`, {
    headers: { authorization: `Bearer ${await igToken()}` },
  });
  if (!res.ok) throw new Error(`username lookup failed: ${res.status}`);
  return (await res.json()).username;
}

function sendDm(recipientId, text) {
  return graph('me/messages', { recipient: { id: recipientId }, message: { text } });
}

async function graph(path, body) {
  const res = await fetch(`${API()}/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${await igToken()}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} failed: ${res.status} ${await res.text()}`);
}
