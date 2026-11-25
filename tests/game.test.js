import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyBatch, initialState, dailyQuests, levelFor, RECIPES, HOUSE_TIERS } from '../shared/game.js';
import { plotNodes, plazaNodes, nodeById, NODE_KINDS } from '../shared/nodes.js';
import { housePosition } from '../shared/layout.js';

const T0 = Date.parse('2026-11-08T12:00:00Z');
const ctx = (now, rng = () => 0.5) => ({ now, rng, seed: 'test' });
const treeId = () => {
  for (let id = 1; ; id++) {
    const t = plotNodes(id).find((n) => n.kind === 'tree');
    if (t) return t.id;
  }
};

test('nodes are deterministic and verifiable from their id', () => {
  for (let id = 1; id < 3000; id++) {
    for (const n of plotNodes(id)) assert.deepEqual(nodeById(n.id), n);
  }
  for (const n of plazaNodes()) assert.deepEqual(nodeById(n.id), n);
  assert.equal(nodeById('t:5:9'), null);
  assert.equal(nodeById('x'), null);
  assert.equal(nodeById('t:-1:0'), null);
});

test('nodes never sit inside their own house', () => {
  for (let id = 1; id < 3000; id++) {
    const p = housePosition(id);
    for (const n of plotNodes(id)) assert.ok(Math.hypot(n.x - p.x, n.z - p.z) > 5, `node ${n.id} too close`);
  }
});

test('harvesting gives items, then the node is on cooldown', () => {
  const id = treeId();
  let { state, results } = applyBatch(initialState(), [{ a: 'harvest', node: id }], ctx(T0));
  assert.ok(results[0].ok);
  assert.equal(state.items.log, NODE_KINDS.tree.qty);
  ({ state, results } = applyBatch(state, [{ a: 'harvest', node: id }], ctx(T0 + 60e3)));
  assert.equal(results[0].ok, false);
  ({ state, results } = applyBatch(state, [{ a: 'harvest', node: id }], ctx(T0 + NODE_KINDS.tree.cooldownMs + 1)));
  assert.ok(results[0].ok);
});

test('a burst of harvests is rate limited by the action budget', () => {
  const nodes = [];
  for (let id = 1; nodes.length < 40; id++) for (const n of plotNodes(id)) if (n.kind === 'tree') nodes.push(n.id);
  const { results } = applyBatch(initialState(), nodes.map((node) => ({ a: 'harvest', node })), ctx(T0));
  const ok = results.filter((r) => r.ok).length;
  assert.ok(ok >= 10 && ok <= 13, `accepted ${ok}`);
});

test('crafting consumes materials; placing decor moves it into the yard', () => {
  let s = initialState();
  s.items = { log: 10, flower: 5 };
  let r;
  ({ state: s, results: r } = applyBatch(s, [{ a: 'craft', r: 'planter' }, { a: 'place', slot: 0, item: 'planter' }], ctx(T0)));
  assert.ok(r.every((x) => x.ok));
  assert.equal(s.items.log, 10 - RECIPES.planter.log);
  assert.equal(s.decor[0], 'planter');
  assert.equal(s.items.planter, 0);
  ({ state: s, results: r } = applyBatch(s, [{ a: 'place', slot: 0, item: null }], ctx(T0)));
  assert.equal(s.items.planter, 1);
  ({ results: r } = applyBatch(s, [{ a: 'craft', r: 'bench' }], ctx(T0)));
  assert.equal(r[0].ok, false);
});

test('fishing respects the cooldown', () => {
  const { state, results } = applyBatch(initialState(), [{ a: 'fish' }, { a: 'fish' }], ctx(T0));
  assert.equal(results[0].ok, true);
  assert.equal(results[1].ok, false);
  assert.equal(Object.values(state.items).reduce((a, b) => a + b, 0), 1);
});

test('selling and painting use coins', () => {
  let s = initialState();
  s.items = { koi: 3 };
  let r;
  ({ state: s, results: r } = applyBatch(s, [{ a: 'sell', item: 'koi', qty: 3 }, { a: 'paint', part: 'roof', color: 2 }], ctx(T0)));
  assert.ok(r.every((x) => x.ok));
  assert.equal(s.paint.roof, 2);
  ({ results: r } = applyBatch(s, [{ a: 'sell', item: 'fence', qty: 1 }], ctx(T0)));
  assert.equal(r[0].ok, false);
});

test('streak grows on consecutive days and resets after a gap', () => {
  let s = initialState();
  ({ state: s } = applyBatch(s, [{ a: 'checkin' }], ctx(T0)));
  ({ state: s } = applyBatch(s, [{ a: 'checkin' }], ctx(T0 + 864e5)));
  assert.equal(s.streak, 2);
  ({ state: s } = applyBatch(s, [{ a: 'checkin' }], ctx(T0 + 4 * 864e5)));
  assert.equal(s.streak, 1);
});

test('quests can be claimed once when finished', () => {
  let s = initialState();
  ({ state: s } = applyBatch(s, [{ a: 'checkin' }], ctx(T0)));
  const qs = dailyQuests(s.day, 'test');
  assert.equal(qs.length, 3);
  s.counts = { log: 99, flower: 99, berry: 99, stone: 99, fish: 99, craft: 9 };
  s.visits = [1, 2, 3];
  const coins = s.coins;
  let r;
  ({ state: s, results: r } = applyBatch(s, [{ a: 'claim', q: 0 }, { a: 'claim', q: 0 }, { a: 'claim', q: 1 }, { a: 'claim', q: 2 }], ctx(T0)));
  assert.deepEqual(r.map((x) => x.ok), [true, false, true, true]);
  assert.equal(s.coins, coins + qs.reduce((a, q) => a + q.coins, 0) + 30);
});

test('levels grow with xp', () => {
  assert.equal(levelFor(0), 1);
  assert.equal(levelFor(20), 2);
  assert.ok(levelFor(5000) > 10);
});

test('house upgrades cost materials and coins, one tier at a time', () => {
  let s = initialState();
  let r;
  ({ results: r } = applyBatch(s, [{ a: 'upgrade' }], ctx(T0)));
  assert.equal(r[0].ok, false);
  s.items = { log: 2000, stone: 2000, lantern: 6, bench: 3 };
  s.coins = 20000;
  ({ state: s, results: r } = applyBatch(s, [{ a: 'upgrade' }, { a: 'upgrade' }, { a: 'upgrade' }, { a: 'upgrade' }, { a: 'upgrade' }], ctx(T0)));
  assert.deepEqual(r.map((x) => x.ok), [true, true, true, true, false]);
  assert.equal(s.tier, 5);
  const spent = HOUSE_TIERS.slice(1).reduce((a, t) => a + t.cost.log, 0);
  assert.equal(s.items.log, 2000 - spent);
  assert.equal(s.items.bench, 0);
});

test('houses-only yard decor is free and unlocks with the house tier', async () => {
  const { DECOR_TIER } = await import('../shared/game.js');
  let s = initialState();
  let r;
  ({ state: s, results: r } = applyBatch(s, [{ a: 'yard', slot: 0, item: 'fence' }], ctx(T0)));
  assert.ok(r[0].ok);
  assert.equal(s.decor[0], 'fence');
  assert.equal(s.items.fence, undefined, 'nothing is taken from the bag');
  ({ results: r } = applyBatch(s, [{ a: 'yard', slot: 1, item: 'gnome' }], ctx(T0)));
  assert.equal(r[0].ok, false, 'gnome needs a bigger house');
  ({ state: s, results: r } = applyBatch({ ...s, tier: DECOR_TIER.gnome }, [{ a: 'yard', slot: 1, item: 'gnome' }], ctx(T0)));
  assert.ok(r[0].ok);
  for (const bad of [{ slot: 99, item: 'fence' }, { slot: 0, item: 'wheat' }, { slot: -1, item: null }]) {
    ({ results: r } = applyBatch(s, [{ a: 'yard', ...bad }], ctx(T0)));
    assert.equal(r[0].ok, false, JSON.stringify(bad));
  }
  ({ state: s, results: r } = applyBatch(s, [{ a: 'yard', slot: 0, item: null }], ctx(T0)));
  assert.ok(r[0].ok);
  assert.equal(s.decor[0], null);
});
