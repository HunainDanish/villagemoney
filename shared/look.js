// Character looks ("My look"): skin, hair colour and style, shirt, trousers,
// hat. Some shirts and hats start locked and come from the daily gift.

export const SKIN = [0xf6d2b5, 0xe8b894, 0xc68a62, 0x9a6440, 0x6f4429];
export const HAIR = [0x2b1d16, 0x5a3a22, 0x8a5a2b, 0xd9b26a, 0x1d1d22, 0xa23b2a, 0xe8e2d6, 0x7b5ea7];
export const HAIR_STYLES = ['Short', 'Long', 'Bun', 'Bald'];
export const SHIRTS = [
  0x3d7cf5, 0xe85d5d, 0x45b36b, 0xf2b134, 0x8e5cd9, 0x2bb3b3, 0xf07ab1, 0x4a4f5c, // free
  0xffffff, 0x1d1d22, 0xd4af37, 0xff8a3d, // gifts
];
export const PANTS = [0x2f3a56, 0x3b3b3b, 0x5a4636, 0x2e5249, 0x6b6f7a, 0xc9b28a];
export const HATS = ['No hat', 'Cap', 'Beanie', 'Flower crown', 'Party hat', 'Crown'];

export const FREE_SHIRTS = 8;
export const FREE_HATS = 2;
// Everything the daily gift can unlock.
export const GIFT_POOL = [
  ...SHIRTS.slice(FREE_SHIRTS).map((_, i) => `shirt:${FREE_SHIRTS + i}`),
  ...HATS.slice(FREE_HATS).map((_, i) => `hat:${FREE_HATS + i}`),
];
export const giftName = (key) => {
  const [kind, i] = key.split(':');
  if (kind === 'hat') return `${HATS[i]} 🎩`;
  return `a new shirt colour 👕`;
};

const PARTS = { skin: SKIN.length, hair: HAIR.length, style: HAIR_STYLES.length, shirt: SHIRTS.length, pants: PANTS.length, hat: HATS.length };

// Default look from a name, so everyone looks different before customising.
export function defaultAvatar(seed = 'me') {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  h >>>= 0;
  return {
    skin: h % SKIN.length,
    hair: (h >>> 4) % HAIR.length,
    style: (h >>> 7) % 3, // no bald by default
    shirt: (h >>> 9) % FREE_SHIRTS,
    pants: (h >>> 13) % PANTS.length,
    hat: 0,
  };
}

// Is this look allowed, given what has been unlocked? Returns a reason or null.
export function avatarProblem(av, unlocks = []) {
  if (!av || typeof av !== 'object') return 'bad look';
  for (const [k, n] of Object.entries(PARTS)) {
    if (!Number.isInteger(av[k]) || av[k] < 0 || av[k] >= n) return `bad ${k}`;
  }
  if (av.shirt >= FREE_SHIRTS && !unlocks.includes(`shirt:${av.shirt}`)) return 'that shirt is locked: open your daily gift';
  if (av.hat >= FREE_HATS && !unlocks.includes(`hat:${av.hat}`)) return 'that hat is locked: open your daily gift';
  return null;
}

// Compact form for live updates: "skin.hair.style.shirt.pants.hat".
export const encodeAvatar = (av) => (av ? [av.skin, av.hair, av.style, av.shirt, av.pants, av.hat].join('.') : null);
export function decodeAvatar(str) {
  if (typeof str !== 'string') return null;
  const [skin, hair, style, shirt, pants, hat] = str.split('.').map(Number);
  const av = { skin, hair, style, shirt, pants, hat };
  return Object.entries(PARTS).every(([k, n]) => Number.isInteger(av[k]) && av[k] >= 0 && av[k] < n) ? av : null;
}
