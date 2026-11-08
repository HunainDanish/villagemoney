import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, passwordProblem } from '../lib/password.js';

Object.assign(process.env, { SUPABASE_URL: 'https://example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'x' });
const auth = await import('../api/auth/[action].js');
const at = (name) => ({ POST: (r) => auth.POST(new Request(r.url.replace('http://x', 'http://x/api/auth/' + name), r)) });
const login = at('login');
const setpw = at('password');

test('passwords are hashed with a salt and verify correctly', async () => {
  const a = await hashPassword('correct horse battery');
  const b = await hashPassword('correct horse battery');
  assert.match(a, /^scrypt\$16384\$8\$1\$/);
  assert.notEqual(a, b, 'same password must give different hashes (salt)');
  assert.ok(!a.includes('correct horse'), 'hash must not contain the password');
  assert.equal(await verifyPassword('correct horse battery', a), true);
  assert.equal(await verifyPassword('correct horse batterY', a), false);
  assert.equal(await verifyPassword('anything', 'garbage'), false);
  assert.equal(await verifyPassword(undefined, a), false);
});

test('password rules', () => {
  assert.equal(passwordProblem('12345678'), null);
  assert.match(passwordProblem('short'), /at least 8/);
  assert.match(passwordProblem('x'.repeat(201)), /too long/);
  assert.match(passwordProblem(42), /Enter a password/);
});

test('login validates input before touching the database', async () => {
  const post = (body) => login.POST(new Request('http://x', { method: 'POST', body: JSON.stringify(body) }));
  assert.equal((await post({})).status, 400);
  assert.equal((await post({ username: 'not valid!', password: 'whatever1' })).status, 400);
  assert.equal((await post({ username: 'someone', password: '' })).status, 400);
});

test('setting a password requires being signed in', async () => {
  const res = await setpw.POST(new Request('http://x', { method: 'POST', body: '{"password":"long enough"}' }));
  assert.equal(res.status, 401);
});
