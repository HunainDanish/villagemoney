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

// ---------- the town centre: two districts around a middle strip ----------
//
//        x = -1         x = 0           x = 1
// z=-1   West           North Park      East
// z= 0   West           Plaza           East
//        ======= Main Boulevard (straight, z = PITCH/2) =======
// z= 1   West           Two villas      East
// z= 2   West           South Park      East
//
// Houses 1-250 live in the West District, 251-500 in the East District (four
// blocks each; the outer block holds 58). From house 501 the spiral carries on
// around this centre, skipping its cells.
export const DISTRICT_HOMES = 250;
export const DISTRICTS = [
  { name: 'West District', x: -1, first: 1 },
  { name: 'East District', x: 1, first: DISTRICT_HOMES + 1 },
];
const DISTRICT_ROWS = [0, 1, -1, 2]; // fill order: nearest the boulevard first
const BLOCKS_PER_DISTRICT = DISTRICT_ROWS.length; // 4 x 64 = 256 plots, 250 used
const CENTRE_BLOCKS = DISTRICTS.length * BLOCKS_PER_DISTRICT; // 8
const CENTRE_HOMES = DISTRICTS.length * DISTRICT_HOMES; // 500
export const BOULEVARD_Z = PITCH / 2;
export const SPECIAL_CELLS = { '0,0': 'plaza', '0,1': 'villas', '0,-1': 'park', '0,2': 'park' };
const SPECIAL_CODE = { plaza: -1, villas: -2, park: -3 };
// Every centre cell, as spiral indices (the spiral skips these).
const RESERVED = [];
for (const x of [-1, 0, 1]) for (const z of DISTRICT_ROWS) RESERVED.push(spiralIndex(x, z));
RESERVED.sort((a, b) => a - b);
const reservedBelow = (n) => RESERVED.filter((r) => r < n).length;

// Block number (0-based) -> block grid coordinate.
export function blockGrid(b) {
  if (b < CENTRE_BLOCKS) {
    const d = DISTRICTS[Math.floor(b / BLOCKS_PER_DISTRICT)];
    return [d.x, DISTRICT_ROWS[b % BLOCKS_PER_DISTRICT]];
  }
  const rank = b - CENTRE_BLOCKS;
  for (let n = rank; n <= rank + RESERVED.length + 1; n++) {
    if (!RESERVED.includes(n) && n - reservedBelow(n) === rank) return spiralCoord(n);
  }
  throw new Error('bad block');
}

// Grid coordinate -> block number, or a negative code for the centre's
// special cells (-1 plaza, -2 villas, -3 park).
export function gridToBlock(gx, gz) {
  const special = SPECIAL_CELLS[`${gx},${gz}`];
  if (special) return SPECIAL_CODE[special];
  const d = DISTRICTS.findIndex((dd) => dd.x === gx);
  const row = DISTRICT_ROWS.indexOf(gz);
  if (d >= 0 && row >= 0) return d * BLOCKS_PER_DISTRICT + row;
  const n = spiralIndex(gx, gz);
  return CENTRE_BLOCKS + n - reservedBelow(n);
}
export const cellKind = (gx, gz) => SPECIAL_CELLS[`${gx},${gz}`] || 'block';

export function blockOfHouse(id) {
  if (id <= CENTRE_HOMES) {
    const d = Math.floor((id - 1) / DISTRICT_HOMES);
    return d * BLOCKS_PER_DISTRICT + Math.floor((id - 1 - d * DISTRICT_HOMES) / HOUSES_PER_BLOCK);
  }
  return CENTRE_BLOCKS + Math.floor((id - CENTRE_HOMES - 1) / HOUSES_PER_BLOCK);
}
export function firstHouseOfBlock(b) {
  if (b < CENTRE_BLOCKS) {
    const d = Math.floor(b / BLOCKS_PER_DISTRICT);
    return d * DISTRICT_HOMES + (b % BLOCKS_PER_DISTRICT) * HOUSES_PER_BLOCK + 1;
  }
  return CENTRE_HOMES + (b - CENTRE_BLOCKS) * HOUSES_PER_BLOCK + 1;
}
// Last house number in a block (the outer district blocks are not full).
export function lastHouseOfBlock(b) {
  const last = firstHouseOfBlock(b) + HOUSES_PER_BLOCK - 1;
  if (b < CENTRE_BLOCKS) return Math.min(last, (Math.floor(b / BLOCKS_PER_DISTRICT) + 1) * DISTRICT_HOMES);
  return last;
}
// Plot `slot` (0-63) of block b -> house number, or null for an unused plot.
export function houseAt(b, slot) {
  const id = firstHouseOfBlock(b) + slot;
  return id <= lastHouseOfBlock(b) ? id : null;
}
// Which district a house is in (index into DISTRICTS), or -1 outside the centre.
export const districtOf = (id) => (id >= 1 && id <= CENTRE_HOMES ? Math.floor((id - 1) / DISTRICT_HOMES) : -1);

// House number -> world position {x, z, facing} (facing in radians).
export function housePosition(id) {
  const b = blockOfHouse(id);
  const slot = id - firstHouseOfBlock(b);
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
  if (totalHouses < 1) return [];
  const maxBlock = blockOfHouse(totalHouses);
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
