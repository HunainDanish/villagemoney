import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyBatch, initialState, raidProblem, resolveRaid, publicLook, energyNow } from '../shared/game.js';
import { plotNodes } from '../shared/nodes.js';
import { CROPS, ENERGY_MAX, ENERGY_REGEN_MS, RAID, raidChance, defenceScore, CARS } from '../shared/life.js';

const T0 = Date.parse('2026-11-09T12:00:00Z');
const ctx = (now, extra = {}) => ({ now, rng: () => 0.5, seed: 'test', ...extra });
const run = (s, actions, now = T0, extra) => applyBatch(s, actions, ctx(now, extra));
const firstTree = () => {
  for (let id = 1; ; id++) {
    const t = plotNodes(id).find((n) => n.kind === 'tree');
    if (t) return t.id;
  }
};

test('activities use energy, which regenerates over time and from food', () => {
  let s = initialState();
  s.energy = 3;
  let { state, results } = run(s, [{ a: 'harvest', node: firstTree() }]);
  assert.equal(results[0].ok, false);
  assert.match(results[0].reason, /too tired/);
  // 2 minutes later: +1 energy.
  assert.equal(energyNow(state, T0 + ENERGY_REGEN_MS), 4);
  // Eating restores energy.
  state.items.salad = 1;
  ({ state, results } = run(state, [{ a: 'eat', item: 'salad' }]));
  assert.ok(results[0].ok);
  assert.ok(state.energy >= 28);
  ({ results } = run(state, [{ a: 'eat', item: 'log' }]));
  assert.equal(results[0].ok, false);
});

test('farming: buy seeds, plant, wait, harvest; farmers are faster', () => {
  let s = initialState();
  s.coins = 100;
  let r;
  ({ state: s, results: r } = run(s, [{ a: 'buy', item: 'carrot_seed', qty: 2 }, { a: 'plant', plot: 0, crop: 'carrot' }]));
  assert.ok(r.every((x) => x.ok), JSON.stringify(r));
  ({ results: r } = run(s, [{ a: 'reap', plot: 0 }], T0 + 60e3));
  assert.equal(r[0].ok, false, 'not ready after 1 minute');
  ({ state: s, results: r } = run(s, [{ a: 'reap', plot: 0 }], T0 + CROPS.carrot.growMs + 1));
  assert.ok(r[0].ok);
  assert.equal(s.items.carrot, CROPS.carrot.yield);
  // Farmer: half the time, one extra.
  s.job = 'farmer';
  ({ state: s, results: r } = run(s, [{ a: 'plant', plot: 1, crop: 'carrot' }], T0 + 1e6));
  ({ state: s, results: r } = run(s, [{ a: 'reap', plot: 1 }], T0 + 1e6 + CROPS.carrot.growMs / 2 + 1));
  assert.ok(r[0].ok);
  assert.equal(s.items.carrot, CROPS.carrot.yield * 2 + 1);
});

test('cooking turns ingredients into meals ("fish" means any fish)', () => {
  let s = initialState();
  s.items = { trout: 1, carrot: 1, milk: 1 };
  let r;
  ({ state: s, results: r } = run(s, [{ a: 'cook', r: 'fish_stew' }, { a: 'cook', r: 'fish_stew' }]));
  assert.deepEqual(r.map((x) => x.ok), [true, false]);
  assert.equal(s.items.fish_stew, 1);
  assert.equal(s.items.trout, 0);
});

test('jobs change at most once a day and give bonuses', () => {
  let s = initialState();
  let r;
  ({ state: s, results: r } = run(s, [{ a: 'job', job: 'woodcutter' }, { a: 'job', job: 'miner' }]));
  assert.deepEqual(r.map((x) => x.ok), [true, false]);
  ({ state: s, results: r } = run(s, [{ a: 'harvest', node: firstTree() }]));
  assert.equal(s.items.log, 3, 'woodcutter gets +1 log');
  ({ results: r } = run(s, [{ a: 'job', job: 'miner' }], T0 + 864e5));
  assert.ok(r[0].ok, 'can change the next day');
});

test('defences cost materials and raise the defence score', () => {
  let s = initialState();
  s.items = { log: 200, stone: 200 };
  s.coins = 2000;
  let r;
  ({ state: s, results: r } = run(s, [
    { a: 'defend', what: 'lock' }, { a: 'defend', what: 'lock' }, { a: 'defend', what: 'lock' }, { a: 'defend', what: 'lock' },
    { a: 'defend', what: 'dog' }, { a: 'defend', what: 'alarm' },
  ]));
  assert.deepEqual(r.map((x) => x.ok), [true, true, true, false, true, true]);
  assert.equal(defenceScore(s), 3 + 2 + 1);
  s.job = 'guard';
  assert.equal(defenceScore(s), 8);
});

test('raid mode is opt-in and stays on for 24 hours', () => {
  let s = initialState();
  let r;
  ({ state: s, results: r } = run(s, [{ a: 'raidMode', on: true }]));
  assert.ok(r[0].ok);
  ({ results: r } = run(s, [{ a: 'raidMode', on: false }], T0 + 3600e3));
  assert.equal(r[0].ok, false);
  ({ results: r } = run(s, [{ a: 'raidMode', on: false }], T0 + RAID.lockInMs + 1));
  assert.ok(r[0].ok);
});

test('raids: only between raid-mode houses, shields and cooldowns apply', () => {
  const raider = { ...initialState(), raid: { on: true, since: 0, at: 0, shield: 0 }, energy: 100 };
  const target = { ...initialState(), raid: { on: false, since: 0, at: 0, shield: 0 } };
  assert.match(raidProblem(raider, target, T0), /not in raid mode/);
  target.raid.on = true;
  assert.equal(raidProblem(raider, target, T0), null);
  target.raid.shield = T0 + 1000;
  assert.match(raidProblem(raider, target, T0), /shielded/);
  target.raid.shield = 0;
  raider.raid.at = T0 - 1000;
  assert.match(raidProblem(raider, target, T0), /rest/);
  raider.raid.at = 0;
  raider.raid.on = false;
  assert.match(raidProblem(raider, target, T0), /switch on raid mode/);
});

test('raid loot is capped at 10% of each material (max 15) and 5% of coins (max 60)', () => {
  const target = { items: { log: 500, stone: 40, berry: 5 }, coins: 2000 };
  const win = resolveRaid(target, 0, 1, () => 0, raidChance);
  assert.equal(win.ok, true);
  assert.deepEqual(win.loot, { log: 15, stone: 4 });
  assert.equal(win.coins, 60);
  const lose = resolveRaid(target, 8, 0, () => 0.99, raidChance);
  assert.equal(lose.ok, false);
  assert.equal(lose.fine, RAID.fine);
  assert.ok(raidChance(8, 0) <= 0.05 + 1e-9 && raidChance(0, 1) <= 0.9);
});

test('players cannot run server-only actions (no free gifts or loot)', () => {
  const { results } = run(initialState(), [
    { a: 'receive', items: { log: 999 }, coins: 999 },
    { a: 'raided', ok: false, fine: 999 },
    { a: 'raidResult', ok: true, loot: { log: 999 } },
    { a: 'giftOut', item: 'log', qty: 1 },
  ]);
  assert.ok(results.every((r) => !r.ok && r.reason === 'not allowed'));
  const trusted = run(initialState(), [{ a: 'receive', items: { log: 3 }, coins: 5 }], T0, { trusted: true });
  assert.equal(trusted.state.items.log, 3);
});

test('cars: buy from the showroom, then choose which one to drive', () => {
  let s = run(initialState(), [{ a: 'checkin' }]).state; // daily gift first
  s.coins = CARS.hatch.price;
  let r;
  ({ state: s, results: r } = run(s, [{ a: 'buyCar', model: 'hatch' }, { a: 'buyCar', model: 'sports' }]));
  assert.deepEqual(r.map((x) => x.ok), [true, false]);
  assert.equal(s.car, 'hatch');
  assert.equal(s.coins, 0);
  ({ state: s, results: r } = run(s, [{ a: 'pickCar', model: null }, { a: 'pickCar', model: 'sports' }]));
  assert.deepEqual(r.map((x) => x.ok), [true, false]);
  assert.equal(publicLook(s).car, null);
});

test('old saves without the new fields still work', () => {
  const old = { v: 1, items: { log: 5 }, coins: 10, xp: {}, nodes: {}, counts: {}, visits: [], decor: [null, null, null, null, null, null], paint: {}, tier: 2 };
  const { state, results } = run(old, [{ a: 'job', job: 'farmer' }, { a: 'raidMode', on: true }]);
  assert.ok(results.every((r) => r.ok));
  assert.equal(state.energy, ENERGY_MAX);
  assert.equal(state.garden.length, 3);
});
