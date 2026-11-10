import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyBatch, initialState } from '../shared/game.js';
import { STAY, HOUSE_POINT_COST } from '../shared/life.js';

const T0 = Date.parse('2026-11-09T09:00:00Z');
const ctx = (now) => ({ now, rng: () => 0.5, seed: 'stay' });
const MIN = 60e3;

// Send one tick per minute for `n` minutes starting at `start`.
function stay(s, start, n) {
  let state = s;
  for (let i = 0; i < n; i++) state = applyBatch(state, [{ a: 'tick' }], ctx(start + i * MIN)).state;
  return state;
}

test('15 active minutes in a day earn 1 house point', () => {
  let s = stay(initialState(), T0, 14);
  assert.equal(s.points || 0, 0);
  assert.equal(s.counts.minutes, 14);
  s = stay(s, T0 + 14 * MIN, 1);
  assert.equal(s.points, 1);
});

test('only 1 point per day, however long you stay', () => {
  const s = stay(initialState(), T0, 90);
  assert.equal(s.points, STAY.pointsPerDay);
  assert.equal(s.counts.minutes, STAY.minutesPerPoint * STAY.pointsPerDay);
});

test('ticks faster than once a minute are rejected (no faking time)', () => {
  const { state, results } = applyBatch(initialState(), [{ a: 'tick' }, { a: 'tick' }, { a: 'tick' }], ctx(T0));
  assert.deepEqual(results.map((r) => r.ok), [true, false, false]);
  assert.equal(state.counts.minutes, 1);
});

test('minutes reset each day, so a new point can be earned tomorrow', () => {
  let s = stay(initialState(), T0, 15);
  s = stay(s, T0 + 864e5, 15);
  assert.equal(s.points, 2);
});

test('house points pay for upgrades, one tier at a time', () => {
  let s = initialState();
  s.points = 1;
  let r;
  ({ state: s, results: r } = applyBatch(s, [{ a: 'pointUpgrade' }], ctx(T0)));
  assert.equal(r[0].ok, false);
  assert.match(r[0].reason, /need 2 house points/);
  s.points = HOUSE_POINT_COST.reduce((a, c) => a + (c || 0), 0);
  ({ state: s, results: r } = applyBatch(s, Array(5).fill({ a: 'pointUpgrade' }), ctx(T0)));
  assert.deepEqual(r.map((x) => x.ok), [true, true, true, true, false]);
  assert.equal(s.tier, 5);
  assert.equal(s.points, 0);
});

test('cars unlock with house level in houses-only mode', async () => {
  const { CAR_TIER } = await import('../shared/life.js');
  let s = initialState();
  let r;
  ({ state: s, results: r } = applyBatch(s, [{ a: 'claimCar', model: 'hatch' }, { a: 'claimCar', model: 'pickup' }], ctx(T0)));
  assert.deepEqual(r.map((x) => x.ok), [true, false]);
  assert.equal(s.car, 'hatch');
  s.tier = CAR_TIER.sports;
  ({ state: s, results: r } = applyBatch(s, [{ a: 'claimCar', model: 'sports' }], ctx(T0)));
  assert.ok(r[0].ok);
  assert.deepEqual(s.cars, ['hatch', 'sports']);
});
