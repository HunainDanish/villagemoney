// House styling: colour palettes, what each upgrade unlocks, and a unique
// default look for every house.
//
// Every house gets a different combination of starter style + wall + roof +
// door + trim + shutter colours. The combination for house N comes from a
// bijection over all combinations (multiply by a number coprime with the
// total, then decode), so the first 1.3 million houses never repeat.
// Residents can then customise; upgrades unlock more parts.

export const PALETTES = {
  wall: [
    0xf4ead8, 0xefe3cf, 0xe8dcc8, 0xf6f1e7, 0xe9d8c4, 0xdcc9b0, // creams & sand
    0xd9e4dd, 0xc9d8c5, 0xb7c9a8, 0xa9bfa0, // sage greens
    0xcfdde8, 0xb9cfe0, 0x9fb7d9, 0x6f8fb5, // blues
    0xf2d0c4, 0xe8b9a8, 0xd99a86, 0xc9a27e, // terracotta & clay
    0xfff1a8, 0xf3dc8a, // butter yellows
    0xe5d5f2, 0xd2c1e6, // lavender
    0xc8c8c8, 0x8f9499, // greys
  ],
  roof: [
    0x6e5a4e, 0x5d6168, 0x7a4e3f, 0x55604f, 0x6b5f57, 0x3e3e4a, 0x2f3a4a, 0x4a3a33,
    0xc0504d, 0xa34a3c, 0x4f6d9a, 0x5b8c5a, 0x2f7f86, 0x7b5ea7, 0xd98c3f, 0x8a5a44,
  ],
  door: [
    0x7a4b2a, 0x3f5d7a, 0x3f6b4f, 0x8a2b2b, 0x2f3a56, 0xd9a441,
    0x1f1f24, 0xf2f0eb, 0xc0504d, 0x5b8c5a, 0x7b5ea7, 0xe08a3c,
  ],
  trim: [0xf7f3ea, 0xffffff, 0xe9dcc4, 0x2b2b30, 0x5a4636, 0x2f3a56, 0x2e5249, 0x8a2b2b],
  shutter: [
    0x4a5a6b, 0x2f3a56, 0x3f6b4f, 0x8a2b2b, 0x5a4636, 0x1f1f24,
    0xf2f0eb, 0x6f8fb5, 0x9fb7a0, 0xd9a441, 0x7b5ea7, 0xc0504d,
  ],
  // Porch light bulb and its glow at night. Not part of the unique defaults:
  // every house starts with the classic warm light.
  light: [0xffd27a, 0xfff1c9, 0xff9f45, 0xff6b5a, 0xff9ec7, 0xc7a2ff, 0x9fd8ff, 0x9cf0b8],
};

// Mansion-only colours, added to the end of every palette.
export const PREMIUM = [0xd4af37, 0xb76e79, 0x0f5e4a, 0x5b2a86];
export const PREMIUM_TIER = 5;

export const STARTER_STYLES = ['Cottage', 'Log cabin', 'Bungalow'];

// Which house tier unlocks customising each part.
export const PART_UNLOCK = { style: 1, wall: 1, roof: 1, light: 1, door: 2, trim: 3, shutter: 4 };
export const PART_NAMES = {
  style: 'Starter style', wall: 'Walls', roof: 'Roof', door: 'Front door', trim: 'Trim & window frames', shutter: 'Shutters', light: 'Porch light',
};

// Dark royal colours make no sense as a light, so the bulb has no premium set.
export const paletteFor = (part) => (part === 'light' ? PALETTES.light : [...PALETTES[part], ...PREMIUM]);
export const colorOf = (part, index) => paletteFor(part)[index] ?? PALETTES[part][0];

// ---------- unique defaults ----------
const RADIX = [
  ['style', STARTER_STYLES.length],
  ['wall', PALETTES.wall.length],
  ['roof', PALETTES.roof.length],
  ['door', PALETTES.door.length],
  ['trim', PALETTES.trim.length],
  ['shutter', PALETTES.shutter.length],
];
export const COMBINATIONS = RADIX.reduce((a, [, n]) => a * n, 1); // 1,327,104

function gcd(a, b) {
  while (b) [a, b] = [b, a % b];
  return a;
}
// A multiplier coprime with COMBINATIONS makes id -> combination one-to-one.
const MULT = (() => {
  let m = 982451; // a large prime, stepped until coprime
  while (gcd(m, COMBINATIONS) !== 1) m += 2;
  return m;
})();

export function defaultLook(id) {
  let k = Number((BigInt(id) * BigInt(MULT) + 7919n) % BigInt(COMBINATIONS));
  const out = {};
  for (const [part, n] of RADIX) {
    out[part] = k % n;
    k = Math.floor(k / n);
  }
  return out;
}

// A house's full look: its unique default, overridden by what the resident chose.
export function lookFor(id, paint = {}) {
  const base = { ...defaultLook(id), light: 0 };
  const out = { ...base };
  for (const part of Object.keys(base)) {
    const v = paint?.[part];
    if (Number.isInteger(v) && v >= 0 && v < (part === 'style' ? STARTER_STYLES.length : paletteFor(part).length)) out[part] = v;
  }
  return out;
}

// Can a resident at `tier` set `part` to option `index`? Returns a reason or null.
export function customizeProblem(tier, part, index) {
  if (!(part in PART_UNLOCK)) return 'unknown part';
  if ((tier || 1) < PART_UNLOCK[part]) return `upgrade your house to unlock ${PART_NAMES[part].toLowerCase()}`;
  const max = part === 'style' ? STARTER_STYLES.length : paletteFor(part).length;
  if (!Number.isInteger(index) || index < 0 || index >= max) return 'unknown option';
  if (part !== 'style' && index >= PALETTES[part].length && (tier || 1) < PREMIUM_TIER) return 'gold and royal colours unlock with the Mansion';
  return null;
}
