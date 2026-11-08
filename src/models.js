import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Procedural low-poly models. Each model is ONE merged geometry with colors
// baked into vertices, so it can be drawn for thousands of instances in a
// single draw call (InstancedMesh). Per-instance tint comes from instanceColor,
// which multiplies the baked colors: parts baked white take the tint fully.

const WHITE = 0xffffff;

function part(geo, hex = WHITE) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g.attributes.uv) g.deleteAttribute('uv');
  const c = new THREE.Color(hex);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

const merge = (parts) => {
  const g = mergeGeometries(parts);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
};

const box = (w, h, d, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);

// Triangular prism: gable faces +z/-z, ridge runs along z.
function gable(w, h, d) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(w / 2, 0);
  s.lineTo(0, h);
  s.closePath();
  return new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false }).translate(0, 0, -d / 2);
}

// Two sloped roof slabs over a gable (ridge along z), with overhang.
function roofSlabs(halfW, rise, depth, base, thick = 0.4, overhang = 0.7) {
  const slope = Math.hypot(halfW, rise);
  const len = slope + overhang;
  const ang = Math.atan2(halfW, rise); // tilt from vertical
  const parts = [];
  for (const side of [-1, 1]) {
    const g = new THREE.BoxGeometry(thick, len, depth + overhang * 2);
    g.rotateZ(side * ang); // right side tilts its top toward the ridge (-x)
    const nx = Math.cos(ang) * thick * 0.5;
    const ny = Math.sin(ang) * thick * 0.5;
    g.translate(side * (halfW / 2 + nx), base + rise / 2 + ny, 0);
    parts.push(g);
  }
  return parts;
}

const C = {
  door: 0x6b4429,
  frame: 0xf7f3ea,
  brick: 0x9c4f3c,
  stone: 0xb9b2a5,
  knob: 0xe0b84a,
  planter: 0x7a5233,
  leaf: 0x5aa04a,
  petal1: 0xff6f91,
  petal2: 0xffd166,
};

// Shared window helper: frame (baked white) + glass (separate glow mesh).
function windows(list, frames, glass) {
  for (const [x, y, z, w, h, axis = 'z'] of list) {
    if (axis === 'z') {
      frames.push(part(box(w + 0.3, h + 0.3, 0.12, x, y, z), C.frame));
      glass.push(part(box(w, h, 0.14, x, y, z + 0.03)));
    } else {
      frames.push(part(box(0.12, h + 0.3, w + 0.3, x, y, z), C.frame));
      glass.push(part(box(0.14, h, w, x + Math.sign(x) * 0.03, y, z)));
    }
  }
}

function door(x, z, details) {
  details.push(part(box(1.4, 2.4, 0.16, x, 1.2, z), C.door));
  details.push(part(box(1.7, 2.6, 0.1, x, 1.3, z - 0.04), C.frame));
  details.push(part(box(0.16, 0.16, 0.12, x + 0.45, 1.2, z + 0.12), C.knob));
}

// Returns { walls, roof, details, glass } geometries for a house style.
// The door is at +z. Footprint stays within about 8 x 7 units.
export function houseStyle(i) {
  const walls = [];
  const roof = [];
  const details = [];
  const glass = [];
  const frames = details;

  if (i === 0) {
    // Cottage: eaves at the front, chimney, flower boxes.
    walls.push(part(box(7, 3.6, 6, 0, 1.8, 0)));
    walls.push(part(gable(6, 2.6, 7).rotateY(Math.PI / 2).translate(0, 3.6, 0)));
    roof.push(...roofSlabs(3, 2.6, 7, 3.6).map((g) => part(g.rotateY(Math.PI / 2))));
    door(0, 3.06, details);
    windows([[-2.3, 2.1, 3.04, 1.2, 1.1], [2.3, 2.1, 3.04, 1.2, 1.1], [3.54, 2.1, 0, 1.2, 1.1, 'x'], [-3.54, 2.1, 0, 1.2, 1.1, 'x']], frames, glass);
    for (const x of [-2.3, 2.3]) {
      details.push(part(box(1.5, 0.35, 0.45, x, 1.35, 3.25), C.planter));
      details.push(part(new THREE.IcosahedronGeometry(0.28, 0).translate(x - 0.4, 1.65, 3.25), C.petal1));
      details.push(part(new THREE.IcosahedronGeometry(0.28, 0).translate(x + 0.4, 1.65, 3.25), C.petal2));
      details.push(part(new THREE.IcosahedronGeometry(0.3, 0).translate(x, 1.62, 3.3), C.leaf));
    }
    details.push(part(box(0.9, 2.4, 0.9, 2.2, 5.4, -1.2), C.brick));
    details.push(part(box(2.6, 0.3, 1.3, 0, 0.15, 3.65), C.stone));
  } else if (i === 1) {
    // Two-storey townhouse with gable front.
    walls.push(part(box(6, 6.2, 6, 0, 3.1, 0)));
    walls.push(part(gable(6, 2.8, 6).translate(0, 6.2, 0)));
    roof.push(...roofSlabs(3, 2.8, 6, 6.2).map((g) => part(g)));
    door(0, 3.06, details);
    details.push(part(box(2.4, 0.2, 1.2, 0, 2.9, 3.6), C.frame)); // little canopy
    windows([[-1.9, 1.9, 3.04, 1.0, 1.2], [1.9, 1.9, 3.04, 1.0, 1.2], [-1.4, 4.6, 3.04, 1.1, 1.2], [1.4, 4.6, 3.04, 1.1, 1.2], [0, 7.0, 3.04, 0.8, 0.8]], frames, glass);
    details.push(part(box(2.6, 0.3, 1.3, 0, 0.15, 3.65), C.stone));
    details.push(part(box(0.8, 2, 0.8, -1.8, 8.2, -1.5), C.brick));
  } else if (i === 2) {
    // A-frame cabin: steep roof down to the ground, big front window.
    walls.push(part(gable(6.4, 6.4, 7).translate(0, 0, 0)));
    roof.push(...roofSlabs(3.2, 6.4, 7, 0, 0.45, 0.6).map((g) => part(g)));
    door(0, 3.53, details);
    glass.push(part(new THREE.CylinderGeometry(0.75, 0.75, 0.14, 12).rotateX(Math.PI / 2).translate(0, 4.2, 3.56)));
    details.push(part(new THREE.TorusGeometry(0.8, 0.12, 6, 12).translate(0, 4.2, 3.55), C.frame));
    windows([[-1.7, 1.4, 3.52, 0.8, 0.9], [1.7, 1.4, 3.52, 0.8, 0.9]], frames, glass);
    details.push(part(box(4.2, 0.35, 1.6, 0, 0.17, 4.3), C.planter)); // deck
  } else {
    // Modern: flat roof, wide glass, planter.
    walls.push(part(box(7.4, 4.4, 6, 0, 2.2, 0)));
    roof.push(part(box(8.4, 0.5, 7, 0, 4.65, 0)));
    door(-2.3, 3.06, details);
    windows([[1.4, 2.0, 3.04, 3.2, 2.4], [-3.74, 2.2, 0, 1.6, 1.2, 'x'], [3.74, 2.2, 0, 1.6, 1.2, 'x']], frames, glass);
    details.push(part(box(3.4, 0.6, 0.9, 1.4, 0.3, 3.6), C.planter));
    for (const x of [0.2, 1.4, 2.6]) details.push(part(new THREE.IcosahedronGeometry(0.45, 0).translate(x, 0.85, 3.6), C.leaf));
    details.push(part(box(1.2, 0.8, 1.2, -2.6, 5.3, -1.6), C.stone)); // roof unit
  }

  return { walls: merge(walls), roof: merge(roof), details: merge(details), glass: merge(glass) };
}

export const HOUSE_STYLES = 4;

// Front yard in front of the door: stepping-stone path, mailbox, two shrubs.
export function yardGeometry() {
  const p = [];
  for (let i = 0; i < 3; i++) p.push(part(new THREE.CylinderGeometry(0.55, 0.6, 0.12, 7).translate(0, 0.06, 4.9 + i * 1.1), C.stone));
  p.push(part(box(0.16, 1.3, 0.16, 2.6, 0.65, 6.6), C.planter));
  p.push(part(box(0.55, 0.45, 0.8, 2.6, 1.45, 6.6), 0x4f6d9a));
  p.push(part(box(0.05, 0.4, 0.2, 2.9, 1.65, 6.4), 0xd94141));
  for (const x of [-1.7, 1.7]) p.push(part(new THREE.IcosahedronGeometry(0.75, 0).scale(1, 0.8, 1).translate(x, 0.55, 4.0), C.leaf));
  return merge(p);
}

// ---------- resource nodes ----------
export function oakGeometry() {
  return merge([
    part(new THREE.CylinderGeometry(0.35, 0.5, 2.8, 7).translate(0, 1.4, 0), 0x7a5233),
    part(new THREE.IcosahedronGeometry(2.0, 0).translate(0, 3.9, 0), 0x5fae4c),
    part(new THREE.IcosahedronGeometry(1.5, 0).translate(1.0, 3.3, 0.5), 0x4f9a44),
    part(new THREE.IcosahedronGeometry(1.4, 0).translate(-0.9, 3.4, -0.5), 0x6bbb55),
  ]);
}

export function pineGeometry() {
  return merge([
    part(new THREE.CylinderGeometry(0.3, 0.45, 2, 7).translate(0, 1, 0), 0x6b4429),
    part(new THREE.ConeGeometry(2.1, 2.6, 7).translate(0, 2.8, 0), 0x2f7a4a),
    part(new THREE.ConeGeometry(1.7, 2.3, 7).translate(0, 4.1, 0), 0x3a8a52),
    part(new THREE.ConeGeometry(1.2, 2.0, 7).translate(0, 5.3, 0), 0x46995c),
  ]);
}

export function stumpGeometry() {
  return merge([
    part(new THREE.CylinderGeometry(0.5, 0.6, 0.7, 8).translate(0, 0.35, 0), 0x7a5233),
    part(new THREE.CylinderGeometry(0.42, 0.42, 0.04, 8).translate(0, 0.71, 0), 0xd9b98a),
  ]);
}

export function rockGeometry() {
  return merge([
    part(new THREE.DodecahedronGeometry(1.15, 0).scale(1.1, 0.75, 1).translate(0, 0.6, 0), 0x9c9a94),
    part(new THREE.DodecahedronGeometry(0.6, 0).translate(0.95, 0.35, 0.5), 0x8a8882),
    part(new THREE.DodecahedronGeometry(0.25, 0).translate(0.4, 1.25, -0.2), 0x9fd6ff), // glint of ore
  ]);
}

export function rubbleGeometry() {
  return merge([
    part(new THREE.DodecahedronGeometry(0.4, 0).translate(-0.3, 0.2, 0.1), 0x9c9a94),
    part(new THREE.DodecahedronGeometry(0.3, 0).translate(0.4, 0.15, -0.2), 0x8a8882),
  ]);
}

export function flowerGeometry() {
  const p = [];
  const cols = [0xff6f91, 0xffd166, 0xc77dff, 0xffffff, 0xff9e5e];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const r = 0.45 + (i % 2) * 0.3;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    p.push(part(new THREE.CylinderGeometry(0.04, 0.04, 0.7, 4).translate(x, 0.35, z), 0x3f8a3a));
    p.push(part(new THREE.IcosahedronGeometry(0.2, 0).translate(x, 0.75, z), cols[i % cols.length]));
  }
  p.push(part(new THREE.IcosahedronGeometry(0.45, 0).scale(1.4, 0.4, 1.4).translate(0, 0.15, 0), 0x4f9a4a));
  return merge(p);
}

export function berryGeometry() {
  const p = [part(new THREE.IcosahedronGeometry(1.1, 0).scale(1.2, 0.85, 1.2).translate(0, 0.9, 0), 0x3f8a3a)];
  for (let i = 0; i < 9; i++) {
    const a = i * 2.4;
    p.push(part(new THREE.SphereGeometry(0.16, 6, 4).translate(Math.cos(a) * 1.05, 0.7 + (i % 3) * 0.3, Math.sin(a) * 1.05), 0xd7263d));
  }
  return merge(p);
}

export function bushGeometry() {
  return merge([part(new THREE.IcosahedronGeometry(1.1, 0).scale(1.2, 0.85, 1.2).translate(0, 0.9, 0), 0x3f8a3a)]);
}

// ---------- street furniture ----------
export function lampGeometry() {
  return merge([
    part(new THREE.CylinderGeometry(0.14, 0.2, 5.5, 6).translate(0, 2.75, 0), 0x3a3f4a),
    part(box(0.9, 0.12, 0.9, 0, 5.55, 0), 0x3a3f4a),
  ]);
}
export const lampBulbGeometry = () => new THREE.SphereGeometry(0.42, 10, 8).translate(0, 5.2, 0);

export function benchGeometry() {
  return merge([
    part(box(3, 0.2, 0.9, 0, 0.9, 0), 0x9a6b42),
    part(box(3, 0.8, 0.15, 0, 1.4, -0.4), 0x9a6b42),
    part(box(0.15, 0.9, 0.8, -1.3, 0.45, 0), 0x3a3f4a),
    part(box(0.15, 0.9, 0.8, 1.3, 0.45, 0), 0x3a3f4a),
  ]);
}

export function grassTuftGeometry() {
  const p = [];
  for (let i = 0; i < 3; i++) p.push(part(new THREE.ConeGeometry(0.12, 0.7, 3).rotateZ((i - 1) * 0.35).translate((i - 1) * 0.15, 0.3, 0), 0x6fbf55));
  return merge(p);
}

// Grassy lot with subtle color noise so it doesn't look like flat paint.
export function lotGeometry(size) {
  const g = new THREE.PlaneGeometry(size, size, 24, 24).rotateX(-Math.PI / 2);
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const a = new THREE.Color(0x8fcf6a);
  const b = new THREE.Color(0x76b856);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const n = Math.sin(x * 0.21) * Math.cos(z * 0.17) * 0.5 + Math.sin((x + z) * 0.07) * 0.5;
    c.copy(a).lerp(b, (n + 1) / 2);
    col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
