import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Vercel's free Hobby plan fails the deployment with more than 12
// serverless functions. Every .js file under api/ is one function.
test('api/ stays within the Vercel Hobby limit of 12 functions', () => {
  const count = (dir) =>
    readdirSync(dir).reduce((n, f) => {
      const p = join(dir, f);
      return n + (statSync(p).isDirectory() ? count(p) : f.endsWith('.js') ? 1 : 0);
    }, 0);
  const n = count('api');
  assert.ok(n <= 12, `${n} functions in api/ (max 12 on Vercel Hobby)`);
});
