import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultLook, lookFor, customizeProblem, COMBINATIONS, PALETTES, PREMIUM } from '../shared/style.js';
import { applyBatch, initialState } from '../shared/game.js';

const key = (l) => `${l.style}|${l.wall}|${l.roof}|${l.door}|${l.trim}|${l.shutter}`;

test('no two houses share a default look (first 200,000 houses)', () => {
  const seen = new Set();
  for (let id = 1; id <= 200000; id++) {
    const k = key(defaultLook(id));
    assert.ok(!seen.has(k), `house ${id} repeats a look`);
    seen.add(k);
  }
  assert.ok(COMBINATIONS > 1_000_000);
});

test('neighbouring houses differ in walls or roof most of the time', () => {
  let same = 0;
  for (let id = 1; id < 5000; id++) {
    const a = defaultLook(id);
    const b = defaultLook(id + 1);
    if (a.wall === b.wall && a.roof === b.roof) same++;
  }
  assert.ok(same < 50, `${same} neighbours share wall+roof`);
});

test('chosen options override the default; invalid ones are ignored', () => {
  const l = lookFor(42, { wall: 3, roof: 999, door: -1 });
  assert.equal(l.wall, 3);
  assert.equal(l.roof, defaultLook(42).roof);
  assert.equal(l.door, defaultLook(42).door);
});

test('upgrades unlock more parts; premium colours need the mansion', () => {
  assert.equal(customizeProblem(1, 'wall', 0), null);
  assert.equal(customizeProblem(1, 'style', 2), null);
  assert.match(customizeProblem(1, 'door', 0), /upgrade/);
  assert.equal(customizeProblem(2, 'door', 0), null);
  assert.match(customizeProblem(3, 'shutter', 0), /upgrade/);
  const gold = PALETTES.wall.length; // first premium colour
  assert.match(customizeProblem(4, 'wall', gold), /Mansion/);
  assert.equal(customizeProblem(5, 'wall', gold + PREMIUM.length - 1), null);
  assert.match(customizeProblem(5, 'wall', gold + PREMIUM.length), /unknown/);
});

test('customising is free and saved in the house look', () => {
  let s = initialState();
  let r;
  ({ state: s, results: r } = applyBatch(s, [{ a: 'customize', part: 'wall', index: 5 }, { a: 'customize', part: 'door', index: 1 }], { now: Date.now(), rng: Math.random, seed: 'x' }));
  assert.deepEqual(r.map((x) => x.ok), [true, false]);
  assert.equal(s.paint.wall, 5);
  assert.equal(s.coins, initialState().coins + 5, 'only the daily gift changed coins');
});
