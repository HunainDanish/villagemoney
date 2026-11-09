// Game rules: one pure reducer used in two places.
//  - In the browser, for instant feedback (and as the only copy for guests).
//  - On the server, as the authority for signed-in residents: it re-runs the
//    same actions with server time and rejects anything that breaks a rule.
// Rewards are deliberately low-stakes and nothing can be traded between
// players, which removes most of the reason to cheat.

import { NODE_KINDS, MAX_COOLDOWN_MS, nodeById, YARD_SLOTS } from './nodes.js';
import {
  ENERGY_MAX, ENERGY_REGEN_MS, ENERGY_COST, CROPS, GARDEN_PLOTS, GROCER, COOKBOOK, SNACKS,
  JOBS, LOCKS, GUARD_DOG, ALARM, RAID, CARS, STAY, HOUSE_POINT_COST,
} from './life.js';
import { customizeProblem } from './style.js';

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
  // Farming and food
  wheat: { name: 'Wheat', icon: '🌾', sell: 1 },
  carrot: { name: 'Carrot', icon: '🥕', sell: 2 },
  tomato: { name: 'Tomato', icon: '🍅', sell: 3 },
  pumpkin: { name: 'Pumpkin', icon: '🎃', sell: 18 },
  wheat_seed: { name: 'Wheat seeds', icon: '🌱', seed: 'wheat' },
  carrot_seed: { name: 'Carrot seeds', icon: '🌱', seed: 'carrot' },
  tomato_seed: { name: 'Tomato seeds', icon: '🌱', seed: 'tomato' },
  pumpkin_seed: { name: 'Pumpkin seeds', icon: '🌱', seed: 'pumpkin' },
  milk: { name: 'Milk', icon: '🥛' },
  egg: { name: 'Egg', icon: '🥚' },
  cheese: { name: 'Cheese', icon: '🧀' },
  bread: { name: 'Bread', icon: '🍞', meal: true },
  salad: { name: 'Salad', icon: '🥗', meal: true },
  omelette: { name: 'Omelette', icon: '🍳', meal: true },
  berry_pie: { name: 'Berry pie', icon: '🥧', meal: true },
  fish_stew: { name: 'Fish stew', icon: '🍲', meal: true },
  pumpkin_soup: { name: 'Pumpkin soup', icon: '🥣', meal: true },
};
const FISH_ITEMS = ['minnow', 'perch', 'trout', 'koi', 'goldfish'];

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
  { tier: 2, name: 'Family home', blurb: 'Wider, with a covered front porch and a dormer window.', cost: { log: 30, stone: 15, coins: 150 } },
  { tier: 3, name: 'Two-storey house', blurb: 'A second floor, more windows and a door canopy.', cost: { log: 90, stone: 60, coins: 600, lantern: 2 } },
  { tier: 4, name: 'Manor', blurb: 'Columns, a balcony, a garage wing and two chimneys.', cost: { log: 200, stone: 150, coins: 1500, bench: 1 } },
  { tier: 5, name: 'Mansion', blurb: 'Three floors, two towers and a grand entrance: the biggest house in town.', cost: { log: 400, stone: 300, coins: 4000, lantern: 4, bench: 2 } },
];
export const WALL_PAINTS = [0xf6e7d0, 0xf2c6b4, 0xcfe5f2, 0xfff1a8, 0xd9f0c9, 0xe8d5f5, 0xfad2d2, 0xffffff, 0x9fb7d9, 0xc9a27e];
export const ROOF_PAINTS = [0xc0504d, 0x4f6d9a, 0x5b8c5a, 0x8a5a44, 0x3e3e4a, 0xd98c3f, 0x7b5ea7, 0x2f7f86];

const SELL_COIN_CAP = 300; // per day
const TOKENS_MAX = 30; // action budget (refills 1 per second)
export const SKILLS = { wood: 'Woodcutting', mine: 'Mining', forage: 'Foraging', fish: 'Fishing', craft: 'Crafting', farm: 'Farming' };

export const levelFor = (xp = 0) => Math.floor(Math.sqrt(xp / 20)) + 1;
export const xpForLevel = (lvl) => 20 * (lvl - 1) ** 2;

export function initialState() {
  return {
    v: 1, items: {}, coins: 0, xp: {}, nodes: {}, day: null, counts: {}, visits: [],
    quests: 0, streak: 0, lastDay: null, decor: Array(YARD_SLOTS.length).fill(null), paint: {}, tier: 1,
    tokens: TOKENS_MAX, tokensAt: 0, fishAt: 0,
    energy: ENERGY_MAX, energyAt: 0, garden: Array(GARDEN_PLOTS).fill(null), job: null, jobDay: null,
    defence: { lock: 0, dog: false, alarm: false }, raid: { on: false, since: 0, at: 0, shield: 0 },
    cars: [], car: null,
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
  // Energy: +1 every ENERGY_REGEN_MS. Older saves start full.
  if (s.energy === undefined) s.energy = ENERGY_MAX;
  if (s.energy < ENERGY_MAX) {
    const gained = Math.floor(Math.max(0, now - (s.energyAt || now)) / ENERGY_REGEN_MS);
    if (gained > 0) {
      s.energy = Math.min(ENERGY_MAX, s.energy + gained);
      s.energyAt = (s.energyAt || now) + gained * ENERGY_REGEN_MS;
    }
  }
  if (s.energy >= ENERGY_MAX || !s.energyAt) s.energyAt = now;
}

// Fill in fields added after a save was created.
function upgradeSave(s) {
  s.garden ||= Array(GARDEN_PLOTS).fill(null);
  s.defence ||= { lock: 0, dog: false, alarm: false };
  s.raid ||= { on: false, since: 0, at: 0, shield: 0 };
  s.cars ||= [];
  if (s.car === undefined) s.car = null;
  if (s.job === undefined) s.job = null;
}

function spendEnergy(s, n) {
  if ((s.energy ?? ENERGY_MAX) < n) return false;
  if (s.energy >= ENERGY_MAX) s.energyAt = s.energyAt || 0;
  s.energy -= n;
  return true;
}

export function energyNow(s, now) {
  if (s.energy === undefined) return ENERGY_MAX;
  const gained = Math.floor(Math.max(0, now - (s.energyAt || now)) / ENERGY_REGEN_MS);
  return Math.min(ENERGY_MAX, s.energy + gained);
}

export const cropReadyAt = (s, plot) => {
  const g = s.garden?.[plot];
  if (!g) return null;
  return g.at + CROPS[g.c].growMs / (s.job === 'farmer' ? 2 : 1);
};

// Builder job: 20% fewer logs and stone on upgrades and defences.
function discounted(s, cost) {
  const out = { ...cost };
  if (s.job === 'builder') for (const k of ['log', 'stone']) if (out[k]) out[k] = Math.ceil(out[k] * 0.8);
  return out;
}

function pay(s, cost) {
  const { coins = 0, ...mats } = cost;
  for (const [item, n] of Object.entries(mats)) {
    if ((s.items[item] || 0) < n) return `you need ${n} × ${ITEMS[item].name.toLowerCase()}`;
  }
  if (s.coins < coins) return `you need ${coins} coins`;
  for (const [item, n] of Object.entries(mats)) s.items[item] -= n;
  s.coins -= coins;
  return null;
}

// Actions only the server may run (they move things between two players).
export const TRUSTED_ACTIONS = new Set(['receive', 'giftOut', 'raidResult', 'raided']);

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
  upgradeSave(s);
  rollover(s, now, events);
  refill(s, now);
  pruneNodes(s, now);
  const fail = (reason) => ({ ok: false, reason, events });
  if (TRUSTED_ACTIONS.has(action.a) && !ctx.trusted) return fail('not allowed');

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
      if (!spendEnergy(s, ENERGY_COST[node.kind])) return fail('too tired: eat something to get energy back');
      s.tokens -= k.cost;
      s.nodes[node.id] = now;
      const bonus = (node.kind === 'tree' && s.job === 'woodcutter') || (node.kind === 'rock' && s.job === 'miner') ? 1 : 0;
      const qty = k.qty + bonus;
      addItem(s, k.item, qty);
      count(s, k.item, qty);
      const before = levelFor(s.xp[k.skill]);
      addXp(s, k.skill, k.xp);
      events.push({ type: 'gain', item: k.item, qty, skill: k.skill });
      if (levelFor(s.xp[k.skill]) > before) events.push({ type: 'level', skill: k.skill, level: levelFor(s.xp[k.skill]) });
      return { ok: true, events };
    }

    case 'fish': {
      if (now - (s.fishAt || 0) < FISH_COOLDOWN_MS) return fail('too fast');
      if ((s.counts.fish || 0) >= FISH_CAP) return fail('daily limit reached');
      if (s.job !== 'fisher' && !spendEnergy(s, ENERGY_COST.fish)) return fail('too tired: eat something to get energy back');
      s.fishAt = now;
      let f = rollFish(ctx.rng);
      if (f === 'boot' && s.job === 'fisher') f = 'minnow';
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
      const merchant = s.job === 'merchant';
      const price = merchant ? Math.ceil(def.sell * 1.25) : def.sell;
      const left = SELL_COIN_CAP + (merchant ? 100 : 0) - (s.counts.sold || 0);
      if (left <= 0) return fail('the stall is out of coins for today');
      const n = Math.min(qty, Math.floor(left / price)) || 0;
      if (n < 1) return fail('the stall is out of coins for today');
      s.items[action.item] -= n;
      s.coins += n * price;
      count(s, 'sold', n * price);
      events.push({ type: 'coins', coins: n * price });
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
      const problem = pay(s, discounted(s, next.cost));
      if (problem) return fail(problem);
      s.tier = next.tier;
      events.push({ type: 'decor' }, { type: 'upgrade', tier: next.tier, name: next.name });
      return { ok: true, events };
    }

    // ---------- groceries, farming, cooking, energy ----------
    case 'buy': {
      const price = GROCER[action.item];
      const qty = action.qty ?? 1;
      if (!price || !Number.isInteger(qty) || qty < 1 || qty > 50) return fail('the grocer does not sell that');
      if (s.coins < price * qty) return fail(`that costs ${price * qty} coins`);
      s.coins -= price * qty;
      addItem(s, action.item, qty);
      events.push({ type: 'gain', item: action.item, qty });
      return { ok: true, events };
    }

    case 'plant': {
      const plot = action.plot;
      const crop = CROPS[action.crop];
      if (!Number.isInteger(plot) || plot < 0 || plot >= GARDEN_PLOTS || !crop) return fail('bad plot');
      if (s.garden[plot]) return fail('something is already growing there');
      if ((s.items[`${action.crop}_seed`] || 0) < 1) return fail(`buy ${crop.name.toLowerCase()} seeds at the grocer first`);
      if (!spendEnergy(s, ENERGY_COST.plant)) return fail('too tired: eat something to get energy back');
      s.items[`${action.crop}_seed`] -= 1;
      s.garden[plot] = { c: action.crop, at: now };
      events.push({ type: 'decor' });
      return { ok: true, events };
    }

    case 'reap': {
      const plot = action.plot;
      const g = s.garden?.[plot];
      if (!g) return fail('nothing is growing there');
      if (cropReadyAt(s, plot) > now) return fail('not ready yet');
      const qty = CROPS[g.c].yield + (s.job === 'farmer' ? 1 : 0);
      s.garden[plot] = null;
      addItem(s, g.c, qty);
      count(s, g.c, qty);
      const before = levelFor(s.xp.farm);
      addXp(s, 'farm', 6);
      events.push({ type: 'gain', item: g.c, qty, skill: 'farm' }, { type: 'decor' });
      if (levelFor(s.xp.farm) > before) events.push({ type: 'level', skill: 'farm', level: levelFor(s.xp.farm) });
      return { ok: true, events };
    }

    case 'cook': {
      const r = COOKBOOK[action.r];
      if (!r) return fail('unknown recipe');
      const fish = FISH_ITEMS.find((f) => (s.items[f] || 0) > 0);
      for (const [item, n] of Object.entries(r.needs)) {
        if (item === 'fish' ? !fish : (s.items[item] || 0) < n) return fail('missing ingredients');
      }
      for (const [item, n] of Object.entries(r.needs)) s.items[item === 'fish' ? fish : item] -= n;
      addItem(s, action.r, 1);
      count(s, 'cook');
      events.push({ type: 'gain', item: action.r, qty: 1, skill: 'cook' });
      return { ok: true, events };
    }

    case 'eat': {
      const energy = COOKBOOK[action.item]?.energy ?? SNACKS[action.item];
      if (!energy) return fail('you cannot eat that');
      if ((s.items[action.item] || 0) < 1) return fail('you do not have that');
      if ((s.energy ?? ENERGY_MAX) >= ENERGY_MAX) return fail('you are full of energy already');
      s.items[action.item] -= 1;
      s.energy = Math.min(ENERGY_MAX, (s.energy ?? ENERGY_MAX) + energy);
      events.push({ type: 'energy', energy });
      return { ok: true, events };
    }

    // ---------- jobs ----------
    case 'job': {
      if (action.job !== null && !JOBS[action.job]) return fail('unknown job');
      if (s.job === action.job) return { ok: true, events };
      if (s.job && s.jobDay === s.day) return fail('you can change jobs once a day');
      s.job = action.job;
      s.jobDay = s.day;
      events.push({ type: 'decor' });
      return { ok: true, events };
    }

    // ---------- defences and raid mode ----------
    case 'defend': {
      const d = s.defence;
      let cost;
      if (action.what === 'lock') {
        const next = LOCKS[(d.lock || 0) + 1];
        if (!next) return fail('your lock is already the best');
        cost = next.cost;
      } else if (action.what === 'dog') {
        if (d.dog) return fail('you already have a guard dog');
        cost = GUARD_DOG.cost;
      } else if (action.what === 'alarm') {
        if (d.alarm) return fail('you already have an alarm bell');
        cost = ALARM.cost;
      } else return fail('unknown defence');
      const problem = pay(s, discounted(s, cost));
      if (problem) return fail(problem);
      if (action.what === 'lock') d.lock = (d.lock || 0) + 1;
      else d[action.what] = true;
      events.push({ type: 'decor' });
      return { ok: true, events };
    }

    case 'raidMode': {
      const on = Boolean(action.on);
      if (on === s.raid.on) return { ok: true, events };
      if (!on && now - s.raid.since < RAID.lockInMs) {
        const h = Math.ceil((RAID.lockInMs - (now - s.raid.since)) / 3600e3);
        return fail(`raid mode stays on for 24 hours once switched on (${h} h left)`);
      }
      s.raid.on = on;
      s.raid.since = now;
      events.push({ type: 'decor' });
      return { ok: true, events };
    }

    // ---------- cars ----------
    case 'buyCar': {
      const car = CARS[action.model];
      if (!car) return fail('unknown car');
      if (s.cars.includes(action.model)) return fail('you already own this car');
      if (s.coins < car.price) return fail(`this car costs ${car.price} coins`);
      s.coins -= car.price;
      s.cars.push(action.model);
      s.car = action.model;
      events.push({ type: 'decor' }, { type: 'car', model: action.model });
      return { ok: true, events };
    }

    case 'pickCar': {
      if (action.model !== null && !s.cars.includes(action.model)) return fail('you do not own that car');
      s.car = action.model;
      events.push({ type: 'decor' });
      return { ok: true, events };
    }

    // ---------- server-only (two players involved) ----------
    case 'giftOut': {
      const qty = action.qty;
      if (!ITEMS[action.item] || !Number.isInteger(qty) || qty < 1 || qty > 99) return fail('cannot gift that');
      if ((s.items[action.item] || 0) < qty) return fail('you do not have that many');
      if ((s.counts.gifts || 0) >= 10) return fail('you can send 10 gifts a day');
      s.items[action.item] -= qty;
      count(s, 'gifts');
      return { ok: true, events };
    }

    case 'receive': {
      for (const [item, n] of Object.entries(action.items || {})) if (ITEMS[item] && n > 0) addItem(s, item, n);
      if (action.coins > 0) s.coins += action.coins;
      events.push({ type: 'received', from: action.from, items: action.items, coins: action.coins, note: action.note });
      return { ok: true, events };
    }

    case 'raidResult': {
      // Raider side. action = { ok, loot: {item: n}, coins, fine, target }
      s.raid.at = now;
      s.raid.shield = 0; // raiding drops your own shield
      s.energy = Math.max(0, (s.energy ?? ENERGY_MAX) - ENERGY_COST.raid);
      if (action.ok) {
        for (const [item, n] of Object.entries(action.loot || {})) addItem(s, item, n);
        s.coins += action.coins || 0;
      } else {
        s.coins = Math.max(0, s.coins - (action.fine || 0));
      }
      count(s, 'raids');
      return { ok: true, events };
    }

    case 'raided': {
      // Target side. action = { ok, loot, coins, fine }
      s.raid.shield = now + RAID.shieldMs;
      if (action.ok) {
        for (const [item, n] of Object.entries(action.loot || {})) s.items[item] = Math.max(0, (s.items[item] || 0) - n);
        s.coins = Math.max(0, s.coins - (action.coins || 0));
      } else {
        s.coins += action.fine || 0;
      }
      return { ok: true, events };
    }

    // ---------- daily stay -> house points ----------
    case 'tick': {
      // One active minute. The server's clock decides: at most one per ~minute.
      if (now - (s.lastTick || 0) < STAY.tickMs - 10e3) return fail('too soon');
      s.lastTick = now;
      const cap = STAY.minutesPerPoint * STAY.pointsPerDay;
      const m = s.counts.minutes || 0;
      if (m >= cap) return { ok: true, events };
      s.counts.minutes = m + 1;
      if ((m + 1) % STAY.minutesPerPoint === 0) {
        s.points = (s.points || 0) + 1;
        events.push({ type: 'point', points: s.points });
      }
      return { ok: true, events };
    }

    // Free customisation; upgrades unlock more parts (see shared/style.js).
    case 'customize': {
      const problem = customizeProblem(s.tier || 1, action.part, action.index);
      if (problem) return fail(problem);
      s.paint = { ...s.paint, [action.part]: action.index };
      events.push({ type: 'decor' });
      return { ok: true, events };
    }

    case 'pointUpgrade': {
      const next = (s.tier || 1) + 1;
      const cost = HOUSE_POINT_COST[next];
      if (!cost) return fail('your house is fully upgraded');
      if ((s.points || 0) < cost) return fail(`you need ${cost} house points (you have ${s.points || 0})`);
      s.points -= cost;
      s.tier = next;
      events.push({ type: 'decor' }, { type: 'upgrade', tier: next, name: HOUSE_TIERS[next - 1].name });
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
// Garden, defences, raid status, job and car are public so visitors see them.
export const publicLook = (s) => ({
  decor: s.decor,
  paint: s.paint,
  tier: s.tier || 1,
  garden: s.garden || [],
  def: s.defence ? { lock: s.defence.lock || 0, dog: Boolean(s.defence.dog), alarm: Boolean(s.defence.alarm) } : undefined,
  raid: s.raid?.on ? 1 : 0,
  shield: s.raid?.shield || 0,
  job: s.job || null,
  car: s.car || null,
});

// Is a raid allowed right now? Pure check used by the server (and the UI).
export function raidProblem(raider, target, now) {
  if (!raider.raid?.on) return 'switch on raid mode first (My house)';
  if (!target.raid?.on) return 'this house is not in raid mode';
  if ((target.raid.shield || 0) > now) return 'this house is shielded after a recent raid';
  if (now - (raider.raid.at || 0) < RAID.cooldownMs) return 'you need to rest before another raid';
  if ((raider.energy ?? ENERGY_MAX) < ENERGY_COST.raid) return 'too tired: eat something to get energy back';
  return null;
}

// Work out a raid: who wins and what moves. Pure; the server applies it to
// both players with the raidResult / raided actions.
export function resolveRaid(target, defence, skill, rng, chanceFn) {
  const win = rng() < chanceFn(defence, skill);
  if (!win) return { ok: false, fine: RAID.fine, loot: {}, coins: 0 };
  const loot = {};
  for (const item of ['log', 'stone', 'flower', 'berry', 'wheat', 'carrot', 'tomato', 'pumpkin']) {
    const n = Math.min(RAID.lootCap, Math.floor((target.items?.[item] || 0) * RAID.lootShare));
    if (n > 0) loot[item] = n;
  }
  const coins = Math.min(RAID.coinCap, Math.floor((target.coins || 0) * RAID.coinShare));
  return { ok: true, loot, coins, fine: 0 };
}
