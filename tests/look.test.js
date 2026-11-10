import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyBatch, initialState } from '../shared/game.js';
import { defaultAvatar, avatarProblem, encodeAvatar, decodeAvatar, GIFT_POOL, FREE_SHIRTS, FREE_HATS } from '../shared/look.js';

const T0 = Date.parse('2026-11-10T09:00:00Z');
const ctx = (now, rng = () => 0) => ({ now, rng, seed: 'look' });

test('default looks differ by name and are always valid', () => {
  const a = defaultAvatar('hunain_danish');
  const b = defaultAvatar('dravidfc');
  assert.notDeepEqual(a, b);
  for (const n of ['a', 'b', 'someone', 'x.y_z']) assert.equal(avatarProblem(defaultAvatar(n), []), null);
});

test('locked shirts and hats need the daily gift', () => {
  const av = { ...defaultAvatar('x'), hat: FREE_HATS };
  assert.match(avatarProblem(av, []), /locked/);
  assert.equal(avatarProblem(av, [`hat:${FREE_HATS}`]), null);
  assert.match(avatarProblem({ ...defaultAvatar('x'), shirt: FREE_SHIRTS }, []), /locked/);
  assert.match(avatarProblem({ ...defaultAvatar('x'), skin: 99 }, []), /bad skin/);
});

test('setLook saves a valid look and rejects locked items', () => {
  let s = initialState();
  let r;
  ({ state: s, results: r } = applyBatch(s, [{ a: 'setLook', avatar: { ...defaultAvatar('x'), hat: 1 } }, { a: 'setLook', avatar: { ...defaultAvatar('x'), hat: 5 } }], ctx(T0)));
  assert.deepEqual(r.map((x) => x.ok), [true, false]);
  assert.equal(s.avatar.hat, 1);
});

test('the daily gift unlocks one new item a day until everything is unlocked', () => {
  let s = initialState();
  let r;
  ({ state: s, results: r } = applyBatch(s, [{ a: 'dailyGift' }, { a: 'dailyGift' }], ctx(T0)));
  assert.deepEqual(r.map((x) => x.ok), [true, false]);
  assert.equal(s.unlocks.length, 1);
  for (let d = 1; d <= GIFT_POOL.length + 2; d++) s = applyBatch(s, [{ a: 'dailyGift' }], ctx(T0 + d * 864e5)).state;
  assert.equal(new Set(s.unlocks).size, GIFT_POOL.length);
});

test('looks travel to other players compactly and safely', () => {
  const av = defaultAvatar('abc');
  assert.deepEqual(decodeAvatar(encodeAvatar(av)), av);
  assert.equal(decodeAvatar('9.9.9.99.9.9'), null);
  assert.equal(decodeAvatar('<script>'), null);
  assert.equal(decodeAvatar(42), null);
});
