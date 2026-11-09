// Town life: energy, farming, groceries, cooking, jobs, defences, raids and
// cars. Pure data + helpers shared by the browser and the server.

export const ENERGY_MAX = 100;
export const ENERGY_REGEN_MS = 2 * 60e3; // +1 energy every 2 minutes (30/hour)

// Energy cost of activities.
export const ENERGY_COST = { tree: 4, rock: 4, flower: 1, berry: 1, fish: 2, plant: 1, raid: 15 };

// ---------- farming ----------
// Grow time is real time; farmers grow twice as fast and harvest one extra.
export const CROPS = {
  wheat: { name: 'Wheat', icon: '🌾', growMs: 6 * 60e3, yield: 4, color: 0xe6c35c },
  carrot: { name: 'Carrot', icon: '🥕', growMs: 8 * 60e3, yield: 3, color: 0xf08a24 },
  tomato: { name: 'Tomato', icon: '🍅', growMs: 12 * 60e3, yield: 3, color: 0xe03b2f },
  pumpkin: { name: 'Pumpkin', icon: '🎃', growMs: 25 * 60e3, yield: 1, color: 0xf28a1d },
};
export const GARDEN_PLOTS = 3;

// ---------- grocer (plaza) ----------
export const GROCER = {
  wheat_seed: 2, carrot_seed: 3, tomato_seed: 5, pumpkin_seed: 10,
  milk: 4, egg: 3, cheese: 6,
};

// ---------- cooking (your kitchen) ----------
// "fish" means any fish. Meals restore energy when eaten.
export const COOKBOOK = {
  bread: { needs: { wheat: 3 }, energy: 20 },
  salad: { needs: { carrot: 1, tomato: 1 }, energy: 25 },
  omelette: { needs: { egg: 2, cheese: 1, tomato: 1 }, energy: 35 },
  berry_pie: { needs: { berry: 3, wheat: 2, egg: 1 }, energy: 40 },
  fish_stew: { needs: { fish: 1, carrot: 1, milk: 1 }, energy: 50 },
  pumpkin_soup: { needs: { pumpkin: 1, milk: 1 }, energy: 60 },
};
// Raw food can be eaten too, for a little energy.
export const SNACKS = { berry: 2, carrot: 4, tomato: 4 };

// ---------- jobs ----------
export const JOBS = {
  farmer: { name: 'Farmer', icon: '👩‍🌾', perk: 'Crops grow twice as fast and give 1 extra' },
  woodcutter: { name: 'Woodcutter', icon: '🪓', perk: '+1 log from every tree' },
  miner: { name: 'Miner', icon: '⛏️', perk: '+1 stone from every rock' },
  fisher: { name: 'Fisher', icon: '🎣', perk: 'Fishing is free (no energy) and you never catch boots' },
  merchant: { name: 'Merchant', icon: '💰', perk: 'Sell for 25% more, and the stall pays you 100 more per day' },
  guard: { name: 'Guard', icon: '🛡️', perk: '+2 defence for your house against raids' },
  builder: { name: 'Builder', icon: '🔨', perk: 'Upgrades and defences cost 20% fewer logs and stone' },
};

// ---------- defences ----------
export const LOCKS = [
  null,
  { name: 'Sturdy lock', cost: { log: 10, stone: 10, coins: 50 } },
  { name: 'Iron lock', cost: { log: 25, stone: 25, coins: 150 } },
  { name: 'Vault door', cost: { log: 50, stone: 50, coins: 400 } },
];
export const GUARD_DOG = { name: 'Guard dog', cost: { log: 10, coins: 200 } };
export const ALARM = { name: 'Alarm bell', cost: { stone: 15, coins: 80 } };

export function defenceScore(state) {
  const d = state.defence || {};
  return (d.lock || 0) + (d.dog ? 2 : 0) + (d.alarm ? 1 : 0) + (state.job === 'guard' ? 2 : 0);
}

// ---------- raids ----------
export const RAID = {
  cooldownMs: 10 * 60e3, // between your raids
  shieldMs: 6 * 60 * 60e3, // a raided house is safe for 6 hours
  lockInMs: 24 * 60 * 60e3, // raid mode can be switched off 24 h after switching it on
  lootShare: 0.1, // 10% of each stored material
  lootCap: 15, // at most 15 of each
  coinShare: 0.05,
  coinCap: 60,
  fine: 15, // a caught raider pays this to the house owner
};
export const LOOTABLE = ['log', 'stone', 'flower', 'berry', 'wheat', 'carrot', 'tomato', 'pumpkin'];

// Chance a raid succeeds: better with a good lock-pick (skill 0..1), worse
// against defences. Always between 5% and 90%.
export function raidChance(defence, skill) {
  const s = Math.max(0, Math.min(1, Number(skill) || 0));
  return Math.max(0.05, Math.min(0.9, 0.35 + 0.45 * s - 0.07 * defence));
}

// ---------- cars ----------
export const CARS = {
  hatch: { name: 'City hatchback', price: 800, speed: 30, color: 0x3d7cf5 },
  pickup: { name: 'Pickup truck', price: 1600, speed: 32, color: 0xc0504d },
  van: { name: 'Camper van', price: 2400, speed: 28, color: 0xf2c94c },
  sports: { name: 'Sports car', price: 5000, speed: 42, color: 0xe85d24 },
};

// ---------- daily stay -> house points (houses-only mode) ----------
// Every active minute in town counts (the browser sends one "tick" a minute
// while the tab is open and you've moved or tapped recently). 15 minutes in
// a day earns 1 house point; points pay for house upgrades.
export const STAY = { minutesPerPoint: 15, pointsPerDay: 1, tickMs: 60e3 };
// Points needed to reach each tier (index = tier).
export const HOUSE_POINT_COST = [null, null, 2, 5, 10, 20];
