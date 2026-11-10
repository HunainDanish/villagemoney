import * as THREE from 'three';

// House interiors ("Visit inside"). Every room is built at the same far-away
// spot; the live channel is per house, so you only meet people in the same
// house. Bigger houses get bigger rooms and more furniture. The front wall is
// low (dollhouse style) so the camera can look in.

export const INTERIOR_ORIGIN = { x: 0, z: -20000 };

const lam = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra });
function add(group, geo, color, x, y, z, ry = 0) {
  const m = new THREE.Mesh(geo, lam(color));
  m.position.set(x, y, z);
  m.rotation.y = ry;
  m.castShadow = true;
  m.receiveShadow = true;
  group.add(m);
  return m;
}
const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);

function rng(seed) {
  let h = (seed * 2654435761) >>> 0;
  return () => ((h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0) / 4294967296);
}

// tier 1..5, wall colour (hex), seed (house id)
export function buildInterior(tier, wallColor, seed) {
  const r = rng(seed);
  const W = 12 + tier * 2; // width (x)
  const D = 9 + tier * 1.5; // depth (z)
  const H = 4.2;
  const g = new THREE.Group();
  g.position.set(INTERIOR_ORIGIN.x, 0, INTERIOR_ORIGIN.z);
  const seats = [];

  // A garden around the room (the town is far away while you're inside).
  const lawn = new THREE.Mesh(new THREE.CircleGeometry(160, 48).rotateX(-Math.PI / 2), lam(0x8fcf6a));
  lawn.position.y = -0.12;
  lawn.receiveShadow = true;
  g.add(lawn);
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + r();
    const d = 22 + r() * 18;
    add(g, new THREE.CylinderGeometry(0.35, 0.5, 2.6, 7), 0x7a5233, Math.cos(a) * d, 1.3, Math.sin(a) * d);
    add(g, new THREE.IcosahedronGeometry(2 + r(), 0), 0x5fae4c, Math.cos(a) * d, 3.8, Math.sin(a) * d);
  }
  const floorCols = [0xb07d4f, 0x9a6b42, 0xc9a27e, 0x7a5233];
  add(g, B(W, 0.2, D), floorCols[seed % floorCols.length], 0, -0.1, 0);
  add(g, B(W, H, 0.3), wallColor, 0, H / 2, -D / 2); // back wall
  add(g, B(0.3, H, D), wallColor, -W / 2, H / 2, 0); // side walls
  add(g, B(0.3, H, D), wallColor, W / 2, H / 2, 0);
  add(g, B(W / 2 - 1.2, 1.1, 0.3), wallColor, -(W / 4 + 0.6), 0.55, D / 2); // low front wall, door gap
  add(g, B(W / 2 - 1.2, 1.1, 0.3), wallColor, W / 4 + 0.6, 0.55, D / 2);
  add(g, B(2.4, 0.06, 1.2), 0x7a4b2a, 0, 0.02, D / 2 - 0.3); // doormat
  // Windows on the back wall that glow softly.
  for (const x of [-W / 4, W / 4]) {
    add(g, B(2.2, 1.6, 0.1), 0xf7f3ea, x, 2.4, -D / 2 + 0.2);
    const glass = new THREE.Mesh(B(1.9, 1.3, 0.05), new THREE.MeshBasicMaterial({ color: 0xbfe3ff }));
    glass.position.set(x, 2.4, -D / 2 + 0.26);
    g.add(glass);
  }
  // Rug, sofa (two seats), coffee table, plant, lamp.
  const rugCols = [0xd94141, 0x3f5d7a, 0x5b8c5a, 0xd9a441, 0x7b5ea7];
  add(g, B(5, 0.04, 3.4), rugCols[Math.floor(r() * rugCols.length)], 0, 0.03, 0.4);
  const sofaCol = [0x4f6d9a, 0x8a5a44, 0x5b8c5a, 0x7b5ea7, 0xc0504d][Math.floor(r() * 5)];
  const sofa = add(g, B(3.6, 0.6, 1.2), sofaCol, 0, 0.5, -1.6);
  add(g, B(3.6, 1.0, 0.35), sofaCol, 0, 1.0, -2.1);
  for (const x of [-1.95, 1.95]) add(g, B(0.3, 0.8, 1.2), sofaCol, x, 0.6, -1.6);
  for (const x of [-0.85, 0.85]) {
    const s = { x: INTERIOR_ORIGIN.x + x, z: INTERIOR_ORIGIN.z - 1.45, h: 0, kind: 'sofa' };
    seats.push(s);
  }
  sofa.userData.seat = seats[0];
  add(g, B(1.8, 0.45, 0.9), 0x7a5233, 0, 0.45, 0.8);
  add(g, new THREE.CylinderGeometry(0.35, 0.28, 0.6, 10), 0xa8774a, -W / 2 + 1, 0.3, -D / 2 + 1);
  add(g, new THREE.IcosahedronGeometry(0.7, 0), 0x4f9a44, -W / 2 + 1, 1.2, -D / 2 + 1);
  add(g, new THREE.CylinderGeometry(0.06, 0.06, 2.2, 8), 0x3a3f4a, W / 2 - 1, 1.1, -D / 2 + 1);
  add(g, new THREE.ConeGeometry(0.5, 0.6, 12, 1, true), 0xf2d0a0, W / 2 - 1, 2.4, -D / 2 + 1);
  const light = new THREE.PointLight(0xffd9a0, 30, 18, 1.6);
  light.position.set(0, 3.6, 0);
  g.add(light);
  // Bookshelf.
  add(g, B(2.2, 2.6, 0.5), 0x5a4636, -W / 2 + 1.6, 1.3, D / 4);
  for (let i = 0; i < 3; i++) add(g, B(1.9, 0.5, 0.35), [0xc0504d, 0x3f5d7a, 0xd9a441][i], -W / 2 + 1.6, 0.6 + i * 0.8, D / 4 + 0.05);
  // Upgrades bring more: a bed, a dining table, a TV and fireplace, a piano,
  // and for the mansion a chandelier.
  if (tier >= 2) {
    add(g, B(2.4, 0.5, 3.2), 0xf2efe8, W / 2 - 1.8, 0.45, D / 4);
    add(g, B(2.4, 0.3, 0.9), 0xd94141, W / 2 - 1.8, 0.75, D / 4 + 1);
    add(g, B(2.4, 1.1, 0.25), 0x7a5233, W / 2 - 1.8, 0.75, D / 4 - 1.6);
  }
  if (tier >= 3) {
    add(g, B(2.6, 0.12, 1.4), 0x9a6b42, -W / 2 + 2.6, 1.1, -D / 2 + 3);
    for (const dx of [-0.8, 0.8]) add(g, B(0.6, 0.8, 0.6), 0x5a4636, -W / 2 + 2.6 + dx, 0.4, -D / 2 + 4);
    add(g, B(3, 1.7, 0.15), 0x1d1d22, 0, 2.2, -D / 2 + 0.25); // TV
    add(g, B(2.4, 1.6, 0.8), 0xa45a44, W / 2 - 3.2, 0.8, -D / 2 + 0.6); // fireplace
    add(g, B(1.2, 0.7, 0.4), 0xff9a3c, W / 2 - 3.2, 0.5, -D / 2 + 0.95);
  }
  if (tier >= 4) {
    add(g, B(2.2, 1.1, 1.0), 0x1d1d22, -W / 2 + 2.4, 0.55, D / 2 - 1.6); // piano
    add(g, B(2.2, 0.08, 0.4), 0xf7f3ea, -W / 2 + 2.4, 1.13, D / 2 - 1.2);
  }
  if (tier >= 5) {
    add(g, new THREE.TorusGeometry(1, 0.08, 8, 24), 0xd4af37, 0, 3.8, 0).rotation.x = Math.PI / 2;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), new THREE.MeshBasicMaterial({ color: 0xfff1c9 }));
      b.position.set(Math.cos(a), 3.9, Math.sin(a));
      g.add(b);
    }
  }

  return {
    group: g,
    seats,
    // Walkable area (inside the walls) and the doorway.
    bounds: { minX: -W / 2 + 0.6, maxX: W / 2 - 0.6, minZ: -D / 2 + 0.6, maxZ: D / 2 - 0.2 },
    door: { x: INTERIOR_ORIGIN.x, z: INTERIOR_ORIGIN.z + D / 2 - 1.2 },
    exitZ: INTERIOR_ORIGIN.z + D / 2 - 0.3,
    furniture: [
      { x: 0, z: -1.6, hw: 2.1, hd: 0.8 }, // sofa
      { x: 0, z: 0.8, hw: 0.95, hd: 0.5 }, // coffee table
      { x: -W / 2 + 1.6, z: D / 4, hw: 1.15, hd: 0.3 }, // bookshelf
      ...(tier >= 2 ? [{ x: W / 2 - 1.8, z: D / 4, hw: 1.25, hd: 1.7 }] : []),
      ...(tier >= 4 ? [{ x: -W / 2 + 2.4, z: D / 2 - 1.6, hw: 1.15, hd: 0.55 }] : []),
    ],
  };
}
