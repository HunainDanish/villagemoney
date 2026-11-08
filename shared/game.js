// Game rules: one pure reducer used in two places.
//  - In the browser, for instant feedback (and as the only copy for guests).
//  - On the server, as the authority for signed-in residents: it re-runs the
//    same actions with server time and rejects anything that breaks a rule.
// Rewards are deliberately low-stakes and nothing can be traded between
// players, which removes most of the reason to cheat.

import { NODE_KINDS, MAX_COOLDOWN_MS, nodeById, YARD_SLOTS } from './nodes.js';

export const ITEMS = {
  log: { name: 'Log', icon: '🪵', sell: 2 },
  stone: { name: 'Stone', icon: '🪨', sell: 2 },
  flower: { name: 'Flower', icon: '🌸', sell: 1 },
  berry: { name: 'Berry', icon: '🫐', sell: 1 },
  minnow: { name: 'Minnow', icon: '🐟', sell: 3, fish: true },
  perch: { name: 'Perch', icon: '🐠', sell: 6, fish: true },
  trout: { name: 'Trout', icon: '🐟', sell: 9, fish: true },
  koi: { name: 'Koi', icon: '🎏', sell: 25, fish: true },
  goldfish: { name: 'Golden carp', icon: '✨', sell: 60, fish: true },
  boot: { name: 'Old boot', icon: '🥾', sell: 1, fish: true },
  fence: { name: 'Picket fence', icon: '🚧', decor: true },
  planter: { name: 'Planter', icon: '🪴', decor: true },
  bench: { name: 'Garden bench', icon: '🪑', decor: true },
  lantern: { name: 'Lantern', icon: '🏮', decor: true },
  birdhouse: { name: 'Birdhouse', icon: '🐦', decor: true },
  gnome: { name: 'Garden gnome', icon: '🧙', decor: true },
};

export const RECIPES = {
  fence: { log: 4 },
  planter: { log: 3, flower: 2 },
  bench: { log: 3, stone: 2 },
  lantern: { stone: 2, log: 1 },
  birdhouse: { log: 3, berry: 2 },
  gnome: { stone: 4, flower: 1 },
};

const FISH_TABLE = [
  ['boot', 10], ['minnow', 40], ['perch', 26], ['trout', 16], ['koi', 6], ['goldfish', 2],
];
const FISH_COOLDOWN_MS = 6000;
const FISH_CAP = 60;

export const PAINT_PRICE = 40;

// House upgrades: everyone starts with a small home (cottage, cabin or
// bungalow). Each tier is a bigger house that every visitor can see.
export const HOUSE_TIERS = [
  { tier: 1, name: 'Starter home', blurb: 'A cosy cottage, cabin or bungalow.' },
  { tier: 2, name: 'Family home', blurb: 'Wider, with a covered front porch and a dormer window.', cost: { log: 20, stone: 10, coins: 100 } },
  { tier: 3, name: 'Two-storey house', blurb: 'A second floor, more windows and a door canopy.', cost: { log: 40, stone: 25, coins: 250 } },
  { tier: 4, name: 'Manor', blurb: 'Columns, a balcony, a garage wing and two chimneys.', cost: { log: 80, stone: 50, coins: 600 } },
];
export const WALL_PAINTS = [0xf6e7d0, 0xf2c6b4, 0xcfe5f2, 0xfff1a8, 0xd9f0c9, 0xe8d5f5, 0xfad2d2, 0xffffff, 0x9fb7d9, 0xc9a27e];
export const ROOF_PAINTS = [0xc0504d, 0x4f6d9a, 0x5b8c5a, 0x8a5a44, 0x3e3e4a, 0xd98c3f, 0x7b5ea7, 0x2f7f86];

const SELL_COIN_CAP = 300; // per day
const TOKENS_MAX = 30; // action budget (refills 1 per second)
export const SKILLS = { wood: 'Woodcutting', mine: 'Mining', forage: 'Foraging', fish: 'Fishing', craft: 'Crafting' };

export const levelFor = (xp = 0) => Math.floor(Math.sqrt(xp / 20)) + 1;
export const xpForLevel = (lvl) => 20 * (lvl - 1) ** 2;

export function initialState() {
  return {
    v: 1, items: {}, coins: 0, xp: {}, nodes: {}, day: null, counts: {}, visits: [],
    quests: 0, streak: 0, lastDay: null, decor: Array(YARD_SLOTS.length).fill(null), paint: {}, tier: 1,
    tokens: TOKENS_MAX, tokensAt: 0, fishAt: 0,
  };
}

export const dayOf = (now) => new Date(now).toISOString().slice(0, 10);
const prevDay = (day) => dayOf(Date.parse(day + 'T00:00:00Z') - 864e5);

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

// Three quests per day per player, derived from the date (no table).
const QUEST_POOL = [
  { kind: 'gather', item: 'log', n: 6, text: 'Chop wood: collect 6 logs', coins: 20 },
  { kind: 'gather', item: 'flower', n: 6, text: 'Pick 6 flowers', coins: 15 },
  { kind: 'gather', item: 'berry', n: 6, text: 'Gather 6 berries', coins: 15 },
  { kind: 'gather', item: 'stone', n: 4, text: 'Mine 4 stones', coins: 20 },
  { kind: 'fish', n: 3, text: 'Catch 3 fish at the pond', coins: 25 },
  { kind: 'craft', n: 1, text: 'Craft something at the workbench', coins: 25 },
  { kind: 'visit', n: 3, text: "Knock on 3 neighbours' doors", coins: 20 },
];
export function dailyQuests(day, seed) {
  const h = hashStr(`${day}|${seed}`);
  const idx = [];
  let k = h;
  while (idx.length < 3) {
    const i = k % QUEST_POOL.length;
    if (!idx.includes(i)) idx.push(i);
    k = Math.imul(k ^ (k >>> 15), 2246822519) >>> 0;
  }
  return idx.map((i) => QUEST_POOL[i]);
}

export function questProgress(state, q) {
  const c = state.counts || {};
  if (q.kind === 'gather') return Math.min(q.n, c[q.item] || 0);
  if (q.kind === 'fish') return Math.min(q.n, c.fish || 0);
  if (q.kind === 'craft') return Math.min(q.n, c.craft || 0);
  if (q.kind === 'visit') return Math.min(q.n, (state.visits || []).length);
  return 0;
}

const addXp = (s, skill, n) => (s.xp[skill] = (s.xp[skill] || 0) + n);
const addItem = (s, item, n) => (s.items[item] = (s.items[item] || 0) + n);
const count = (s, key, n = 1) => (s.counts[key] = (s.counts[key] || 0) + n);

// New day: reset daily counters, advance the streak, grant a login gift.
function rollover(s, now, events) {
  const day = dayOf(now);
  if (s.day === day) return;
  s.day = day;
  s.counts = {};
  s.visits = [];
  s.quests = 0;
  if (s.lastDay !== day) {
    s.streak = s.lastDay === prevDay(day) ? s.streak + 1 : 1;
    s.lastDay = day;
    const gift = 5 * Math.min(s.streak, 7);
    s.coins += gift;
    events.push({ type: 'daily', streak: s.streak, coins: gift });
  }
}

function refill(s, now) {
  s.tokens = Math.min(TOKENS_MAX, (s.tokens ?? TOKENS_MAX) + Math.max(0, now - (s.tokensAt || now)) / 1000);
  s.tokensAt = now;
}

function pruneNodes(s, now) {
  for (const [k, t] of Object.entries(s.nodes)) if (now - t >= MAX_COOLDOWN_MS) delete s.nodes[k];
}

export function nodeReadyAt(state, node) {
  const t = state.nodes?.[node.id];
  return t ? t + NODE_KINDS[node.kind].cooldownMs : 0;
}

function rollFish(rng) {
  const total = FISH_TABLE.reduce((a, [, w]) => a + w, 0);
  let r = rng() * total;
  for (const [f, w] of FISH_TABLE) if ((r -= w) < 0) return f;
  return 'minnow';
}

// Apply one action. Mutates `s`. Returns { ok, reason?, events[] }.
// ctx = { now, rng, seed } (seed = resident id or guest id, for quests).
export function applyAction(s, action, ctx) {
  const events = [];
  const { now } = ctx;
  if (!action || typeof action !== 'object') return { ok: false, reason: 'bad action', events };
  rollover(s, now, events);
  refill(s, now);
  pruneNodes(s, now);
  const fail = (reason) => ({ ok: false, reason, events });

  switch (action.a) {
    case 'checkin':
      return { ok: true, events };

    case 'harvest': {
      const node = nodeById(action.node);
      if (!node) return fail('no such node');
      const k = NODE_KINDS[node.kind];
      if (nodeReadyAt(s, node) > now) return fail('not grown back yet');
      if ((s.counts[k.item] || 0) >= k.cap) return fail('daily limit reached');
      if (s.tokens < k.cost) return fail('too fast');
      s.tokens -= k.cost;
      s.nodes[node.id] = now;
      addItem(s, k.item, k.qty);
      count(s, k.item, k.qty);
      const before = levelFor(s.xp[k.skill]);
      addXp(s, k.skill, k.xp);
      events.push({ type: 'gain', item: k.item, qty: k.qty, skill: k.skill });
      if (levelFor(s.xp[k.skill]) > before) events.push({ type: 'level', skill: k.skill, level: levelFor(s.xp[k.skill]) });
      return { ok: true, events };
    }

    case 'fish': {
      if (now - (s.fishAt || 0) < FISH_COOLDOWN_MS) return fail('too fast');
      if ((s.counts.fish || 0) >= FISH_CAP) return fail('daily limit reached');
      s.fishAt = now;
      const f = rollFish(ctx.rng);
      addItem(s, f, 1);
      if (f !== 'boot') count(s, 'fish');
      const before = levelFor(s.xp.fish);
      addXp(s, 'fish', f === 'boot' ? 2 : 8 + ITEMS[f].sell);
      events.push({ type: 'gain', item: f, qty: 1, skill: 'fish' });
      if (levelFor(s.xp.fish) > before) events.push({ type: 'level', skill: 'fish', level: levelFor(s.xp.fish) });
      return { ok: true, events };
    }

    case 'craft': {
      const r = RECIPES[action.r];
      if (!r) return fail('unknown recipe');
      for (const [item, n] of Object.entries(r)) if ((s.items[item] || 0) < n) return fail('not enough materials');
      for (const [item, n] of Object.entries(r)) s.items[item] -= n;
      addItem(s, action.r, 1);
      count(s, 'craft');
      const before = levelFor(s.xp.craft);
      addXp(s, 'craft', 15);
      events.push({ type: 'gain', item: action.r, qty: 1, skill: 'craft' });
      if (levelFor(s.xp.craft) > before) events.push({ type: 'level', skill: 'craft', level: levelFor(s.xp.craft) });
      return { ok: true, events };
    }

    case 'place': {
      const slot = action.slot;
      if (!Number.isInteger(slot) || slot < 0 || slot >= YARD_SLOTS.length) return fail('bad slot');
      const item = action.item ?? null;
      if (item !== null && (!ITEMS[item]?.decor || (s.items[item] || 0) < 1)) return fail('you do not have that');
      const prev = s.decor[slot];
      if (prev) addItem(s, prev, 1);
      if (item) s.items[item] -= 1;
      s.decor[slot] = item;
      events.push({ type: 'decor' });
      return { ok: true, events };
    }

    case 'sell': {
      const def = ITEMS[action.item];
      const qty = action.qty;
      if (!def?.sell || !Number.isInteger(qty) || qty < 1 || qty > 999) return fail('cannot sell that');
      if ((s.items[action.item] || 0) < qty) return fail('not enough');
      const left = SELL_COIN_CAP - (s.counts.sold || 0);
      if (left <= 0) return fail('the stall is out of coins for today');
      const n = Math.min(qty, Math.floor(left / def.sell)) || 0;
      if (n < 1) return fail('the stall is out of coins for today');
      s.items[action.item] -= n;
      s.coins += n * def.sell;
      count(s, 'sold', n * def.sell);
      events.push({ type: 'coins', coins: n * def.sell });
      return { ok: true, events };
    }

    case 'paint': {
      const list = action.part === 'wall' ? WALL_PAINTS : action.part === 'roof' ? ROOF_PAINTS : null;
      if (!list || !Number.isInteger(action.color) || action.color < 0 || action.color >= list.length) return fail('bad paint');
      if (s.coins < PAINT_PRICE) return fail(`paint costs ${PAINT_PRICE} coins`);
      s.coins -= PAINT_PRICE;
      s.paint = { ...s.paint, [action.part]: action.color };
      events.push({ type: 'decor' });
      return { ok: true, events };
    }

    case 'upgrade': {
      const next = HOUSE_TIERS[s.tier || 1]; // tiers are 1-based
      if (!next) return fail('your house is fully upgraded');
      const { coins = 0, ...mats } = next.cost;
      for (const [item, n] of Object.entries(mats)) if ((s.items[item] || 0) < n) return fail(`you need ${n} ${ITEMS[item].name.toLowerCase()}s`);
      if (s.coins < coins) return fail(`you need ${coins} coins`);
      for (const [item, n] of Object.entries(mats)) s.items[item] -= n;
      s.coins -= coins;
      s.tier = next.tier;
      events.push({ type: 'decor' }, { type: 'upgrade', tier: next.tier, name: next.name });
      return { ok: true, events };
    }

    case 'visit': {
      const house = action.house;
      if (!Number.isInteger(house) || house < 1) return fail('bad house');
      if (!s.visits.includes(house) && s.visits.length < 20) s.visits.push(house);
      return { ok: true, events };
    }

    case 'claim': {
      const i = action.q;
      if (!Number.isInteger(i) || i < 0 || i > 2) return fail('bad quest');
      if (s.quests & (1 << i)) return fail('already claimed');
      const q = dailyQuests(s.day, ctx.seed)[i];
      if (questProgress(s, q) < q.n) return fail('not finished yet');
      s.quests |= 1 << i;
      s.coins += q.coins;
      events.push({ type: 'coins', coins: q.coins });
      if (s.quests === 7) {
        s.coins += 30;
        events.push({ type: 'coins', coins: 30, bonus: true });
      }
      return { ok: true, events };
    }

    default:
      return fail('unknown action');
  }
}

// Apply a batch; returns { state, results }. Does not mutate the input.
export function applyBatch(state, actions, ctx) {
  const s = structuredClone(state && state.v ? state : initialState());
  const results = actions.slice(0, 60).map((a) => applyAction(s, a, ctx));
  return { state: s, results };
}

// Public bits of a resident's yard, mirrored into residents.look for /api/block.
export const publicLook = (s) => ({ decor: s.decor, paint: s.paint, tier: s.tier || 1 });
