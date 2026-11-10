// Resource nodes (trees, rocks, flower beds, berry bushes) are derived from
// house numbers, exactly like the houses themselves. No table is needed, and
// the server can check that a node exists just by recomputing it.

import { housePosition } from './layout.js';

export const NODE_KINDS = {
  tree: { item: 'log', qty: 2, hits: 4, cooldownMs: 10 * 60e3, cost: 2.5, cap: 150, skill: 'wood', xp: 10, radius: 1.0 },
  rock: { item: 'stone', qty: 2, hits: 3, cooldownMs: 12 * 60e3, cost: 2.5, cap: 120, skill: 'mine', xp: 10, radius: 1.3 },
  flower: { item: 'flower', qty: 2, hits: 1, cooldownMs: 15 * 60e3, cost: 1, cap: 200, skill: 'forage', xp: 4, radius: 0 },
  berry: { item: 'berry', qty: 3, hits: 1, cooldownMs: 15 * 60e3, cost: 1, cap: 200, skill: 'forage', xp: 4, radius: 1.1 },
};
export const MAX_COOLDOWN_MS = Math.max(...Object.values(NODE_KINDS).map((k) => k.cooldownMs));

function mix(n) {
  let h = Math.imul(n ^ 0x5bd1e995, 2654435761) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

// Front-yard layout of a house, in local coordinates (x across, z toward the
// door side). Shared so decor slots never overlap nodes or the mailbox.
export const YARD_SLOTS = [
  [-4.6, 5.4],
  [5.2, 4.4],
  [-6.6, 2.4],
  [6.6, 2.4],
  [-6.8, -2.0],
  [6.8, -2.0],
];

// Local (x across, z front) -> world, for a house.
export function toWorld(p, lx, lz) {
  const s = Math.sin(p.facing);
  const c = Math.cos(p.facing);
  // Local +z is the door direction (sin f, cos f); local +x is (cos f, -sin f).
  return { x: p.x + lx * c + lz * s, z: p.z - lx * s + lz * c };
}

// Nodes in the back garden of house `id`.
export function plotNodes(id) {
  const p = housePosition(id);
  const h = mix(id);
  const out = [];
  const side = h & 1 ? 3.6 : -3.6;
  if (h % 10 < 7) {
    const w = toWorld(p, side, -6.2);
    out.push({ id: `t:${id}:0`, kind: 'tree', variant: (h >>> 4) % 3 === 0 ? 'pine' : 'oak', ...w, s: 0.85 + ((h >>> 8) % 30) / 100 });
  }
  const second = (h >>> 12) % 8;
  if (second < 2) {
    const w = toWorld(p, -side, -6.2);
    out.push({ id: `b:${id}:1`, kind: 'berry', ...w, s: 1 });
  } else if (second < 3) {
    const w = toWorld(p, -side, -6.2);
    out.push({ id: `r:${id}:1`, kind: 'rock', ...w, s: 0.9 });
  }
  if ((h >>> 16) % 2 === 0) {
    const w = toWorld(p, 0, -6.4);
    out.push({ id: `f:${id}:2`, kind: 'flower', ...w, s: 1 });
  }
  return out;
}

// Nodes around the central plaza: a grove of trees, rocks, flowers, berries.
let plazaCache = null;
export function plazaNodes() {
  if (plazaCache) return plazaCache;
  const out = [];
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2 + 0.08;
    const r = 52 + (i % 3) * 4;
    out.push({ id: `p:${i}`, kind: 'tree', variant: i % 3 === 0 ? 'pine' : 'oak', x: Math.cos(a) * r, z: Math.sin(a) * r, s: 1 + (i % 4) * 0.08 });
  }
  const rocks = [[44, -10], [-46, 8], [12, 46], [-10, -46], [40, 40]];
  rocks.forEach(([x, z], i) => out.push({ id: `p:${20 + i}`, kind: 'rock', x, z, s: 1.1 }));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.4;
    out.push({ id: `p:${30 + i}`, kind: 'flower', x: Math.cos(a) * 20, z: Math.sin(a) * 20, s: 1.1 });
  }
  const berries = [[-40, -20], [38, -26], [-20, 40]];
  berries.forEach(([x, z], i) => out.push({ id: `p:${40 + i}`, kind: 'berry', x, z, s: 1 }));
  plazaCache = out;
  return out;
}

// "t:123:0" -> node, or null if no such node exists.
export function nodeById(nodeId) {
  if (typeof nodeId !== 'string' || nodeId.length > 32) return null;
  const parts = nodeId.split(':');
  if (parts[0] === 'p') return plazaNodes().find((n) => n.id === nodeId) || null;
  const id = Number(parts[1]);
  if (!Number.isInteger(id) || id < 1 || id > 1e8) return null;
  return plotNodes(id).find((n) => n.id === nodeId) || null;
}

// Plaza landmarks (positions used by both rendering and interaction).
export const PLAZA = {
  pond: { x: -30, z: 30, r: 10 },
  workbench: { x: 30, z: -30 },
  stall: { x: 32, z: 26 },
  board: { x: -30, z: -30 },
  grocer: { x: 0, z: -38 },
  showroom: { x: 0, z: 40, hw: 7, hd: 4.5 }, // a building: half width / depth
};

// Houses-only mode: the four game stalls make way for places to hang out.
// Footprints are clear of the plaza trees, rocks and the GPS walkways.
export const VENUES = {
  cafe: { x: -28, z: -28, hw: 6, hd: 5 },
  hall: { x: 28, z: -28, hw: 6, hd: 5 },
  wheel: { x: 33, z: 27, r: 3.4 }, // base footprint; the wheel stands 18 high
  playground: { x: 0, z: -38, hw: 5, hd: 2.5 },
};
