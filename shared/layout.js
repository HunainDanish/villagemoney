// Town layout: pure math, shared by the browser and the API.
//
// Every resident has a house number (their database id, 1, 2, 3, ...).
// Houses are grouped into blocks of HOUSES_PER_BLOCK. Blocks are laid out in a
// square spiral around the central plaza (spiral index 0). Because the position
// of house N is computed from N alone, the town never needs a layout table and
// the client only ever downloads the few blocks around the player.

export const BLOCK_SIDE = 8; // houses per block side
export const HOUSES_PER_BLOCK = BLOCK_SIDE * BLOCK_SIDE; // 64
export const PLOT = 16; // world units between houses (house is 6 wide)
export const ROAD = 18; // road width between blocks
export const LOT = BLOCK_SIDE * PLOT; // 128: grassy part of a block
export const PITCH = LOT + ROAD; // 146: block-to-block distance

// Spiral index (0 = centre) -> integer grid coordinate [x, z].
export function spiralCoord(n) {
  if (n === 0) return [0, 0];
  const p = n + 1; // classic formula is 1-based
  const k = Math.ceil((Math.sqrt(p) - 1) / 2);
  const t = 2 * k;
  let m = (t + 1) * (t + 1);
  if (p >= m - t) return [k - (m - p), -k];
  m -= t;
  if (p >= m - t) return [-k, -k + (m - p)];
  m -= t;
  if (p >= m - t) return [-k + (m - p), k];
  return [k, k - (m - p - t)];
}

// Integer grid coordinate -> spiral index (inverse of spiralCoord).
export function spiralIndex(x, z) {
  const k = Math.max(Math.abs(x), Math.abs(z));
  if (k === 0) return 0;
  const t = 2 * k;
  const m = (t + 1) * (t + 1);
  let p;
  if (z === -k) p = m - k + x;
  else if (x === -k) p = m - t - (z + k);
  else if (z === k) p = m - 2 * t - (x + k);
  else p = m - 3 * t - (k - z);
  return p - 1;
}

// Block number (0-based, houses 1..64 are block 0) -> block grid coordinate.
// Spiral index 0 is the plaza, so block b sits at spiral index b + 1.
export const blockGrid = (b) => spiralCoord(b + 1);
export const gridToBlock = (gx, gz) => spiralIndex(gx, gz) - 1; // -1 = plaza

export const blockOfHouse = (id) => Math.floor((id - 1) / HOUSES_PER_BLOCK);
export const firstHouseOfBlock = (b) => b * HOUSES_PER_BLOCK + 1;

// House number -> world position {x, z, facing} (facing in radians).
export function housePosition(id) {
  const i = id - 1;
  const b = Math.floor(i / HOUSES_PER_BLOCK);
  const slot = i % HOUSES_PER_BLOCK;
  const [gx, gz] = blockGrid(b);
  const sx = slot % BLOCK_SIDE;
  const sz = Math.floor(slot / BLOCK_SIDE);
  const x = gx * PITCH + (sx - (BLOCK_SIDE - 1) / 2) * PLOT;
  const z = gz * PITCH + (sz - (BLOCK_SIDE - 1) / 2) * PLOT;
  // Rows alternate: rows 0+1, 2+3, ... sit back-to-back around a shared back
  // garden (where trees grow), and rows 1+2, 3+4, ... face each other across a
  // front lane. The outer rows (0 and 7) face the road.
  const facing = sz % 2 === 0 ? Math.PI : 0;
  return { x, z, facing };
}

// World position -> block grid coordinate.
export const worldToGrid = (x, z) => [Math.round(x / PITCH), Math.round(z / PITCH)];

// Blocks within `radius` grid cells of a world position that already have houses.
export function blocksNear(x, z, radius, totalHouses) {
  const [cx, cz] = worldToGrid(x, z);
  const maxBlock = Math.ceil(totalHouses / HOUSES_PER_BLOCK) - 1;
  const out = [];
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dz = -radius; dz <= radius; dz++) {
      const b = gridToBlock(cx + dx, cz + dz);
      if (b >= 0 && b <= maxBlock) out.push(b);
    }
  }
  return out;
}

// Usernames follow Instagram's rules: letters, numbers, dots and underscores.
export function normalizeUsername(raw) {
  if (typeof raw !== 'string') return null;
  const u = raw.trim().replace(/^@/, '').toLowerCase();
  return /^[a-z0-9._]{1,30}$/.test(u) ? u : null;
}
