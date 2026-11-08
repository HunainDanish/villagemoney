import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

// Fake config so routes take their "configured" paths. Nothing here reaches
// the network: each test stops before the first database call.
Object.assign(process.env, {
  SUPABASE_URL: 'https://example.invalid',
  SUPABASE_SERVICE_ROLE_KEY: 'x',
  IG_APP_SECRET: 'app-secret',
  IG_ACCESS_TOKEN: 'token',
  IG_VERIFY_TOKEN: 'verify-me',
  ADMIN_SECRET: 'a-long-admin-secret-123',
});
const ig = await import('../api/instagram.js');
const admin = await import('../api/admin/[action].js');
const create = { POST: (r) => admin.POST(new Request(r.url.replace('http://x', 'http://x/api/admin/create'), r)) };
const block = await import('../api/block.js');
const find = await import('../api/find.js');
const auth = await import('../api/auth/[action].js');
const redeem = { POST: (r) => auth.POST(new Request(r.url.replace('http://x', 'http://x/api/auth/redeem'), r)) };
const actions = await import('../api/actions.js');

test('webhook verification echoes the challenge only with the right token', async () => {
  const ok = await ig.GET(new Request('http://x/api/instagram?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=42'));
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), '42');
  const bad = await ig.GET(new Request('http://x/api/instagram?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=42'));
  assert.equal(bad.status, 403);
});

test('webhook rejects unsigned or wrongly signed events', async () => {
  const body = JSON.stringify({ entry: [] });
  const none = await ig.POST(new Request('http://x', { method: 'POST', body }));
  assert.equal(none.status, 401);
  const wrong = await ig.POST(new Request('http://x', { method: 'POST', body, headers: { 'x-hub-signature-256': 'sha256=00' } }));
  assert.equal(wrong.status, 401);
});

test('webhook accepts a correctly signed event', async () => {
  const body = JSON.stringify({ entry: [{ messaging: [{ message: { text: 'hello' }, sender: { id: '1' } }] }] });
  const sig = 'sha256=' + createHmac('sha256', 'app-secret').update(body).digest('hex');
  const res = await ig.POST(new Request('http://x', { method: 'POST', body, headers: { 'x-hub-signature-256': sig } }));
  assert.equal(res.status, 200); // "hello" is ignored, so no DB call
});

test('admin routes need the secret', async () => {
  const res = await create.POST(new Request('http://x', { method: 'POST', body: '{"username":"a"}', headers: { 'x-admin-secret': 'wrong' } }));
  assert.equal(res.status, 401);
});

test('inputs are validated before touching the database', async () => {
  assert.equal((await block.GET(new Request('http://x/api/block?b=-1'))).status, 400);
  assert.equal((await block.GET(new Request('http://x/api/block?b=abc'))).status, 400);
  assert.equal((await find.GET(new Request('http://x/api/find?u=not%20valid'))).status, 400);
  const r = await redeem.POST(new Request('http://x', { method: 'POST', body: '{"token":"short"}' }));
  assert.equal(r.status, 410);
});

test('game actions require a signed-in resident', async () => {
  const res = await actions.POST(new Request('http://x', { method: 'POST', body: '{"actions":[]}' }));
  assert.equal(res.status, 401);
});

test('IG_HANDLE is cleaned up whatever format it was entered in', async () => {
  const { cleanHandle } = await import('../api/config.js');
  for (const raw of ['porch.town', '@porch.town', '  @Porch.Town ', 'https://www.instagram.com/porch.town/', 'instagram.com/porch.town?igsh=abc']) {
    assert.equal(cleanHandle(raw), 'porch.town', raw);
  }
  assert.equal(cleanHandle(''), '');
  assert.equal(cleanHandle(undefined), '');
});

test('admin errors say what is wrong, and ignore stray spaces', async () => {
  const req = (secret) => new Request('http://x', { method: 'POST', body: '{}', headers: { 'x-admin-secret': secret } });
  const msg = async (res) => (await res.json()).error;
  const saved = process.env.ADMIN_SECRET;
  try {
    delete process.env.ADMIN_SECRET;
    assert.match(await msg(await create.POST(req('x'))), /not set/);
    process.env.ADMIN_SECRET = 'short';
    assert.match(await msg(await create.POST(req('short'))), /shorter than 16/);
    process.env.ADMIN_SECRET = '  a-long-admin-secret-123\n';
    assert.match(await msg(await create.POST(req('nope'))), /Wrong admin secret/);
    const ok = await create.POST(req(' a-long-admin-secret-123 '));
    assert.notEqual(ok.status, 401); // got past the secret check
  } finally {
    process.env.ADMIN_SECRET = saved;
  }
});

test('auth and admin routes dispatch by URL', async () => {
  const unknown = await auth.POST(new Request('http://x/api/auth/nope', { method: 'POST', body: '{}' }));
  assert.equal(unknown.status, 404);
  const wrongMethod = await auth.GET(new Request('http://x/api/auth/login'));
  assert.equal(wrongMethod.status, 405);
  const residents = await admin.GET(new Request('http://x/api/admin/residents', { headers: { 'x-admin-secret': 'wrong' } }));
  assert.equal(residents.status, 401);
});
