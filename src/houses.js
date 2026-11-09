import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Procedural houses that read as real homes: foundations, siding trim,
// corner boards, roofs with thickness and overhang, fascia boards, framed
// windows with mullions, sills and shutters, doors with frames and steps,
// porches with columns, chimneys. Ambient occlusion is baked into vertex
// colours (darker near the ground), which is what makes them feel solid.
//
// Each model returns four merged geometries for instanced drawing:
//   walls  (baked white x AO, tinted per house = wall paint)
//   roof   (baked white, tinted per house = roof paint)
//   details (fixed colours: trim, doors, frames, stone, brick, plants)
//   glass  (window panes, coloured per house for day / night glow)
// plus metadata: chimney top, porch light, label height, collision size.

const COL = {
  trim: 0xf7f3ea,
  dark: 0x3b3430,
  door: 0x7a4b2a,
  doorBlue: 0x3f5d7a,
  doorGreen: 0x3f6b4f,
  stone: 0xb7b0a3,
  stoneDark: 0x98917f,
  brick: 0xa45a44,
  wood: 0x9a6b42,
  shutter: 0x4a5a6b,
  leaf: 0x5aa04a,
  leafDark: 0x3f8a3a,
  petal1: 0xff6f91,
  petal2: 0xffd166,
  metal: 0x5a5f6a,
};

// Bake a colour (and optional ground AO) into a geometry's vertices.
function paint(geo, hex = 0xffffff, ao = false) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g.attributes.uv) g.deleteAttribute('uv');
  if (g.attributes.uv1) g.deleteAttribute('uv1');
  const c = new THREE.Color(hex);
  const pos = g.attributes.position;
  const arr = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const k = ao ? 0.82 + 0.18 * Math.min(1, Math.max(0, pos.getY(i) / 2.2)) : 1;
    arr.set([c.r * k, c.g * k, c.b * k], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

const box = (w, h, d, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);

function merge(parts) {
  if (!parts.length) return new THREE.BufferGeometry();
  const g = mergeGeometries(parts);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

// Triangle (gable end) in the x/y plane, extruded `d` along z.
function gableWall(w, h, d) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(w / 2, 0);
  s.lineTo(0, h);
  s.closePath();
  return new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false }).translate(0, 0, -d / 2);
}

// Gable roof with ridge along z: two thick slabs + fascia boards + ridge cap.
function gableRoof(halfW, rise, depth, base, { overhang = 0.7, thick = 0.35 } = {}) {
  const roof = [];
  const trim = [];
  const len = Math.hypot(halfW, rise) + overhang; // ridge to eave, plus overhang
  const ang = Math.atan2(halfW, rise); // slope angle from vertical
  const sin = Math.sin(ang);
  const cos = Math.cos(ang);
  for (const side of [-1, 1]) {
    const g = new THREE.BoxGeometry(thick, len, depth + overhang * 2);
    g.rotateZ(side * ang);
    // Centre: middle of the slope, shifted down-slope by half the overhang
    // and outward by half the thickness.
    const x = halfW / 2 + (sin * overhang) / 2 + (cos * thick) / 2;
    const y = base + rise / 2 - (cos * overhang) / 2 + (sin * thick) / 2;
    g.translate(side * x, y, 0);
    roof.push(g);
    // Fascia board along the eave.
    trim.push(box(0.16, 0.32, depth + overhang * 2 + 0.1, side * (halfW + sin * overhang), base - cos * overhang + 0.12, 0));
  }
  roof.push(box(0.45, 0.3, depth + overhang * 2 + 0.05, 0, base + rise + 0.12, 0)); // ridge cap
  return { roof, trim };
}

// Hip roof: a 4-sided pyramid stretched over a rectangle, plus fascia.
function hipRoof(w, d, rise, base, overhang = 0.7) {
  const g = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1).rotateY(Math.PI / 4);
  g.scale(w + overhang * 2, rise, d + overhang * 2).translate(0, base + rise / 2, 0);
  const trim = [
    box(w + overhang * 2 + 0.1, 0.28, 0.14, 0, base - 0.05, d / 2 + overhang),
    box(w + overhang * 2 + 0.1, 0.28, 0.14, 0, base - 0.05, -d / 2 - overhang),
    box(0.14, 0.28, d + overhang * 2, w / 2 + overhang, base - 0.05, 0),
    box(0.14, 0.28, d + overhang * 2, -w / 2 - overhang, base - 0.05, 0),
  ];
  return { roof: [g], trim };
}

// A framed window on the front (+z) or a side (+-x) face.
function windowOn(out, { x, y, z, w = 1.3, h = 1.5, face = 'z', shutters = true, box: planter = false }) {
  const { details, glass } = out;
  const d = 0.16;
  const add = (geo, col) => details.push(paint(geo, col));
  if (face === 'z') {
    add(box(w + 0.32, h + 0.32, d, x, y, z), COL.trim); // frame
    glass.push(paint(box(w, h, 0.06, x, y, z + 0.02)));
    add(box(0.08, h, d + 0.04, x, y, z + 0.06), COL.trim); // mullions
    add(box(w, 0.08, d + 0.04, x, y, z + 0.06), COL.trim);
    add(box(w + 0.6, 0.14, 0.4, x, y - h / 2 - 0.2, z + 0.12), COL.trim); // sill
    if (shutters) {
      add(box(0.45, h + 0.2, 0.1, x - w / 2 - 0.39, y, z + 0.02), COL.shutter);
      add(box(0.45, h + 0.2, 0.1, x + w / 2 + 0.39, y, z + 0.02), COL.shutter);
    }
    if (planter) {
      add(box(w + 0.3, 0.35, 0.45, x, y - h / 2 - 0.45, z + 0.3), COL.wood);
      add(new THREE.IcosahedronGeometry(0.26, 0).translate(x - w / 3, y - h / 2 - 0.18, z + 0.3), COL.petal1);
      add(new THREE.IcosahedronGeometry(0.26, 0).translate(x + w / 3, y - h / 2 - 0.18, z + 0.3), COL.petal2);
      add(new THREE.IcosahedronGeometry(0.3, 0).translate(x, y - h / 2 - 0.15, z + 0.35), COL.leaf);
    }
  } else {
    const s = Math.sign(x);
    add(box(d, h + 0.32, w + 0.32, x, y, z), COL.trim);
    glass.push(paint(box(0.06, h, w, x + s * 0.02, y, z)));
    add(box(d + 0.04, h, 0.08, x + s * 0.06, y, z), COL.trim);
    add(box(d + 0.04, 0.08, w, x + s * 0.06, y, z), COL.trim);
    add(box(0.4, 0.14, w + 0.6, x + s * 0.12, y - h / 2 - 0.2, z), COL.trim);
  }
}

// Doors sit on top of the 0.5 foundation, 3.4 tall (characters are ~2.9).
function door(out, { x, z, color = COL.door, h = 3.4, w = 1.5 }) {
  const { details } = out;
  const b = 0.5;
  details.push(paint(box(w + 0.4, h + 0.25, 0.14, x, b + h / 2 + 0.05, z), COL.trim)); // frame
  details.push(paint(box(w, h, 0.18, x, b + h / 2, z + 0.03), color));
  details.push(paint(box(w * 0.6, h * 0.3, 0.05, x, b + h * 0.68, z + 0.13), 0xf6e2b0)); // glass light
  details.push(paint(box(0.16, 0.16, 0.12, x + w * 0.33, b + h * 0.45, z + 0.16), 0xe0b84a)); // knob
}

// Wall lamp bracket; the glowing bulb itself is drawn by world.js.
function lampBracket(out, x, y, wallZ) {
  out.details.push(paint(box(0.12, 0.12, 0.34, x, y + 0.25, wallZ + 0.17), COL.dark));
  out.details.push(paint(box(0.34, 0.08, 0.34, x, y + 0.36, wallZ + 0.34), COL.dark));
}

function steps(out, { x, z, w = 2.4 }) {
  out.details.push(paint(box(w, 0.25, 0.8, x, 0.12, z + 0.4), COL.stone, true));
  out.details.push(paint(box(w - 0.4, 0.25, 0.6, x, 0.37, z + 0.3), COL.stone, true));
}

// Stepping-stone path from the door out to the lane.
function path(out, x, from) {
  for (let z = from + 0.7; z < 7.6; z += 1.15) {
    out.details.push(paint(new THREE.CylinderGeometry(0.55, 0.6, 0.12, 7).translate(x + Math.sin(z * 3) * 0.12, 0.06, z), COL.stone));
  }
}

function chimney(out, x, z, top) {
  out.details.push(paint(box(1.0, top, 1.0, x, top / 2, z), COL.brick, true));
  out.details.push(paint(box(1.2, 0.25, 1.2, x, top + 0.1, z), COL.dark));
  (out.meta.chimneys ||= []).push([x, top + 0.4, z]);
}

// Walls: a body box with foundation, corner boards and a top band.
function body(out, w, h, d, { x = 0, z = 0, y = 0, foundation = 0.5, corners = true } = {}) {
  out.walls.push(paint(box(w, h, d, x, y + foundation + h / 2, z), 0xffffff, true));
  out.details.push(paint(box(w + 0.3, foundation, d + 0.3, x, y + foundation / 2, z), COL.stoneDark, true));
  out.details.push(paint(box(w + 0.12, 0.22, d + 0.12, x, y + foundation + h - 0.11, z), COL.trim));
  if (corners) {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      out.details.push(paint(box(0.28, h, 0.28, x + sx * (w / 2), y + foundation + h / 2, z + sz * (d / 2)), COL.trim));
    }
  }
  return y + foundation + h; // top of the wall
}

function porchRoof(out, { x = 0, z, w, d, y, columns = 2 }) {
  out.details.push(paint(box(w, 0.35, 0.18, x, y, z + d), COL.trim));
  // Sloped slab: high at the wall, low at the front beam.
  out.roof.push(new THREE.BoxGeometry(w + 0.4, 0.3, d + 0.5).rotateX(0.22).translate(x, y + 0.45, z + d / 2));
  for (let i = 0; i < columns; i++) {
    const cx = x - w / 2 + 0.25 + i * ((w - 0.5) / (columns - 1 || 1));
    out.details.push(paint(new THREE.CylinderGeometry(0.17, 0.2, y, 8).translate(cx, y / 2, z + d - 0.2), COL.trim));
  }
  out.details.push(paint(box(w, 0.3, d + 0.2, x, 0.3, z + d / 2), COL.wood, true)); // deck
}

function shrubs(out, list) {
  for (const [x, z, s = 0.7] of list) {
    out.details.push(paint(new THREE.IcosahedronGeometry(s, 0).scale(1.1, 0.8, 1.1).translate(x, s * 0.75, z), COL.leafDark, true));
  }
}

// ---------------------------------------------------------------------------
// Models. Footprints stay within x -5.5..5.5 and z -4..5 so yards still fit.
// Collision (hx/hz/cx/cz) covers the solid walls + foundation only. Porches,
// steps and columns stay walkable, so there are never invisible walls.

function cottage() {
  const out = { walls: [], roof: [], details: [], glass: [], meta: {} };
  const top = body(out, 7.2, 4.2, 6.2);
  out.walls.push(paint(gableWall(6.2, 2.9, 7.2).rotateY(Math.PI / 2).translate(0, top, 0)));
  const r = gableRoof(3.1, 2.9, 7.2, top);
  out.roof.push(...r.roof.map((g) => g.rotateY(Math.PI / 2)));
  out.details.push(...r.trim.map((g) => paint(g.rotateY(Math.PI / 2), COL.trim)));
  door(out, { x: 0, z: 3.12, color: COL.doorGreen });
  steps(out, { x: 0, z: 3.25 });
  path(out, 0, 4.1);
  windowOn(out, { x: -2.2, y: 3.0, z: 3.1, w: 1.1, planter: true });
  windowOn(out, { x: 2.2, y: 3.0, z: 3.1, w: 1.1, planter: true });
  windowOn(out, { x: 3.62, y: 3.0, z: 0, face: 'x' });
  windowOn(out, { x: -3.62, y: 3.0, z: 0, face: 'x' });
  lampBracket(out, 0, 4.15, 3.1);
  chimney(out, 2.3, -1.3, top + 3.2);
  shrubs(out, [[-3.2, 3.9], [3.2, 3.9]]);
  Object.assign(out.meta, { porch: [0, 4.3, 3.45], height: top + 4.2, hx: 3.75, hz: 3.25 });
  return out;
}

function cabin() {
  const out = { walls: [], roof: [], details: [], glass: [], meta: {} };
  const top = body(out, 6.4, 4.0, 7, { corners: false });
  // Log courses: dark grooves across the walls.
  for (let i = 1; i < 7; i++) {
    const y = 0.5 + i * 0.6;
    out.details.push(paint(box(6.5, 0.07, 7.1, 0, y, 0), 0x6b4429));
  }
  out.walls.push(paint(gableWall(6.4, 3.8, 7).translate(0, top, 0)));
  const r = gableRoof(3.2, 3.8, 7, top, { overhang: 0.8 });
  out.roof.push(...r.roof);
  out.details.push(...r.trim.map((g) => paint(g, COL.wood)));
  door(out, { x: 0, z: 3.55, color: COL.door });
  windowOn(out, { x: -2.0, y: 2.7, z: 3.53, w: 1.1, h: 1.2, shutters: false });
  windowOn(out, { x: 2.0, y: 2.7, z: 3.53, w: 1.1, h: 1.2, shutters: false });
  windowOn(out, { x: 0, y: top + 1.4, z: 3.53, w: 1.0, h: 1.0, shutters: false });
  porchRoof(out, { z: 3.5, w: 6.4, d: 1.8, y: 4.2, columns: 2 });
  out.details.push(paint(box(0.06, 0.45, 0.06, 1.3, 4.25, 4.55), COL.dark)); // lantern chain
  path(out, 0, 5.3);
  chimney(out, -2.0, -1.8, top + 3.4);
  Object.assign(out.meta, { porch: [1.3, 3.9, 4.55], height: top + 5, hx: 3.35, hz: 3.65 });
  return out;
}

function bungalow() {
  const out = { walls: [], roof: [], details: [], glass: [], meta: {} };
  const top = body(out, 8.4, 4.0, 6.4);
  const r = hipRoof(8.4, 6.4, 3.2, top);
  out.roof.push(...r.roof);
  out.details.push(...r.trim.map((g) => paint(g, COL.trim)));
  door(out, { x: -2.4, z: 3.22, color: COL.doorBlue });
  steps(out, { x: -2.4, z: 3.35, w: 2.0 });
  path(out, -2.4, 4.2);
  windowOn(out, { x: 1.2, y: 2.6, z: 3.2, w: 3.0, h: 1.6, shutters: false, planter: true });
  windowOn(out, { x: 4.22, y: 2.6, z: 0, face: 'x' });
  windowOn(out, { x: -4.22, y: 2.6, z: 0, face: 'x' });
  chimney(out, -2.6, -1.4, top + 3.0);
  shrubs(out, [[3.8, 3.9, 0.6], [-4.2, 3.8, 0.6]]);
  lampBracket(out, -1.0, 3.4, 3.2);
  Object.assign(out.meta, { porch: [-1.0, 3.55, 3.55], height: top + 3.6, hx: 4.35, hz: 3.35 });
  return out;
}

function familyHome() {
  const out = { walls: [], roof: [], details: [], glass: [], meta: {} };
  const top = body(out, 8.6, 4.4, 6.6);
  out.walls.push(paint(gableWall(6.6, 3.0, 8.6).rotateY(Math.PI / 2).translate(0, top, 0)));
  const r = gableRoof(3.3, 3.0, 8.6, top);
  out.roof.push(...r.roof.map((g) => g.rotateY(Math.PI / 2)));
  out.details.push(...r.trim.map((g) => paint(g.rotateY(Math.PI / 2), COL.trim)));
  // Dormer window in the roof.
  out.walls.push(paint(box(1.8, 1.9, 1.6, 0, top + 1.15, 2.2), 0xffffff, false));
  out.roof.push(box(2.3, 0.25, 2.1, 0, top + 2.2, 2.2));
  windowOn(out, { x: 0, y: top + 1.35, z: 3.02, w: 1.0, h: 0.8, shutters: false });
  porchRoof(out, { z: 3.3, w: 8.6, d: 1.6, y: 4.3, columns: 4 });
  door(out, { x: 0, z: 3.32, color: 0x8a2b2b });
  path(out, 0, 5.1);
  windowOn(out, { x: -2.8, y: 2.6, z: 3.3, h: 1.3 });
  windowOn(out, { x: 2.8, y: 2.6, z: 3.3, h: 1.3 });
  out.details.push(paint(box(0.06, 0.4, 0.06, 0, 4.25, 4.3), COL.dark)); // lamp chain
  windowOn(out, { x: 4.32, y: 2.8, z: -0.5, face: 'x' });
  windowOn(out, { x: -4.32, y: 2.8, z: -0.5, face: 'x' });
  chimney(out, -2.8, -1.6, top + 3.4);
  Object.assign(out.meta, {
    porch: [0, 3.95, 4.3], height: top + 4.4, hx: 4.45, hz: 3.45,
    slots: [[-5.6, 6.4], [5.4, 6.3], [-6.3, 2.4], [6.3, 2.4], [-6.6, -2.0], [6.6, -2.0]],
  });
  return out;
}

function twoStorey() {
  const out = { walls: [], roof: [], details: [], glass: [], meta: {} };
  const top = body(out, 7.6, 7.6, 6.6);
  // Floor band between storeys.
  out.details.push(paint(box(7.75, 0.22, 6.75, 0, 4.3, 0), COL.trim));
  out.walls.push(paint(gableWall(7.6, 3.2, 6.6).translate(0, top, 0)));
  const r = gableRoof(3.8, 3.2, 6.6, top);
  out.roof.push(...r.roof);
  out.details.push(...r.trim.map((g) => paint(g, COL.trim)));
  door(out, { x: 0, z: 3.32, color: COL.doorBlue });
  steps(out, { x: 0, z: 3.45 });
  path(out, 0, 4.3);
  out.details.push(paint(box(2.6, 0.2, 1.3, 0, 4.15, 3.95), COL.trim)); // door canopy
  out.details.push(paint(box(0.12, 0.6, 0.5, -1.2, 3.8, 3.55), COL.trim)); // canopy brackets
  out.details.push(paint(box(0.12, 0.6, 0.5, 1.2, 3.8, 3.55), COL.trim));
  windowOn(out, { x: -2.4, y: 2.6, z: 3.3, w: 1.2, shutters: false, planter: true });
  windowOn(out, { x: 2.4, y: 2.6, z: 3.3, w: 1.2, shutters: false, planter: true });
  windowOn(out, { x: -2.3, y: 6.0, z: 3.3 });
  windowOn(out, { x: 0, y: 6.0, z: 3.3, w: 1.0, shutters: false });
  windowOn(out, { x: 2.3, y: 6.0, z: 3.3 });
  lampBracket(out, 1.35, 3.0, 3.3);
  windowOn(out, { x: 0, y: top + 1.2, z: 3.3, w: 0.9, h: 0.9, shutters: false });
  for (const s of [-1, 1]) {
    windowOn(out, { x: s * 3.82, y: 2.5, z: 0, face: 'x' });
    windowOn(out, { x: s * 3.82, y: 6.0, z: 0, face: 'x' });
  }
  chimney(out, 2.6, -1.5, top + 3.6);
  shrubs(out, [[-3.6, 4.0], [3.6, 4.0]]);
  Object.assign(out.meta, { porch: [1.35, 3.15, 3.65], height: top + 4.6, hx: 3.95, hz: 3.45 });
  return out;
}

function manor() {
  const out = { walls: [], roof: [], details: [], glass: [], meta: {} };
  // Main two-storey block.
  const top = body(out, 7.4, 7.8, 7, { x: -1.0 });
  out.details.push(paint(box(7.55, 0.22, 7.15, -1.0, 4.4, 0), COL.trim));
  const r = hipRoof(7.4, 7, 3.6, top);
  out.roof.push(...r.roof.map((g) => g.translate(-1.0, 0, 0)));
  out.details.push(...r.trim.map((g) => paint(g.translate(-1.0, 0, 0), COL.trim)));
  // One-storey side wing (garden room / garage).
  const wtop = body(out, 3.8, 4.0, 6.2, { x: 4.6, z: -0.4 });
  const wr = hipRoof(3.8, 6.2, 1.6, wtop, 0.5);
  out.roof.push(...wr.roof.map((g) => g.translate(4.6, 0, -0.4)));
  out.details.push(...wr.trim.map((g) => paint(g.translate(4.6, 0, -0.4), COL.trim)));
  // Garage door with panels.
  out.details.push(paint(box(2.8, 3.0, 0.14, 4.6, 2.0, 2.72), COL.trim));
  for (let i = 0; i < 4; i++) out.details.push(paint(box(2.5, 0.6, 0.08, 4.6, 0.95 + i * 0.68, 2.82), 0xe9e4da));
  // Portico with columns and a balcony over the door.
  door(out, { x: -1.0, z: 3.52, color: 0x2f3a56, w: 1.8, h: 3.6 });
  steps(out, { x: -1.0, z: 3.6, w: 3.6 });
  path(out, -1.0, 5.6);
  // Driveway in front of the garage.
  out.details.push(paint(box(3.0, 0.08, 4.6, 4.6, 0.04, 5.2), 0xa7a29a));
  out.details.push(paint(box(4.0, 0.3, 1.8, -1.0, 4.4, 4.4), COL.trim)); // balcony floor
  for (let i = 0; i < 6; i++) out.details.push(paint(box(0.1, 0.8, 0.1, -2.8 + i * 0.72, 4.95, 5.2), COL.trim));
  out.details.push(paint(box(4.0, 0.12, 0.12, -1.0, 5.38, 5.2), COL.trim));
  for (const x of [-2.7, 0.7]) out.details.push(paint(new THREE.CylinderGeometry(0.22, 0.26, 4.25, 10).translate(x, 2.3, 5.0), COL.trim));
  windowOn(out, { x: -3.3, y: 2.8, z: 3.52, w: 1.1 });
  windowOn(out, { x: 1.6, y: 2.8, z: 3.52, w: 1.0, shutters: false });
  windowOn(out, { x: -1.0, y: 6.3, z: 3.52, w: 1.4, h: 1.8, shutters: false });
  windowOn(out, { x: -3.3, y: 6.3, z: 3.52, w: 1.1 });
  windowOn(out, { x: 1.6, y: 6.3, z: 3.52, w: 1.0, shutters: false });
  lampBracket(out, 0.45, 3.2, 3.52);
  windowOn(out, { x: -4.72, y: 2.6, z: 0, face: 'x' });
  windowOn(out, { x: -4.72, y: 6.3, z: 0, face: 'x' });
  chimney(out, -3.6, -2.0, top + 3.6);
  chimney(out, 1.6, -2.0, top + 3.6);
  shrubs(out, [[-5.0, 4.2, 0.65], [2.4, 4.3, 0.55], [6.6, 3.2, 0.55]]);
  Object.assign(out.meta, {
    porch: [0.45, 3.35, 3.9], height: top + 4.2, hx: 5.75, hz: 3.65, cx: 0.9,
    // The garage wing and driveway take the right side, so decor shifts.
    slots: [[-4.8, 5.6], [2.0, 6.1], [-6.6, 2.4], [6.3, 6.0], [-6.8, -2.0], [6.9, -4.6]],
  });
  return out;
}

// Tier 5: three floors, two corner towers with cone roofs, a columned portico
// with a pediment, grand double door. The biggest house in town.
function mansion() {
  const out = { walls: [], roof: [], details: [], glass: [], meta: {} };
  const top = body(out, 8.0, 10.6, 7.0);
  for (const y of [4.1, 7.6]) out.details.push(paint(box(8.15, 0.24, 7.15, 0, y, 0), COL.trim)); // floor bands
  const r = hipRoof(8.0, 7.0, 3.4, top);
  out.roof.push(...r.roof);
  out.details.push(...r.trim.map((g) => paint(g, COL.trim)));
  // Corner towers.
  const th = 12.4;
  for (const x of [-4.6, 4.6]) {
    out.walls.push(paint(new THREE.CylinderGeometry(1.3, 1.3, th, 14).translate(x, 0.5 + th / 2, 2.6), 0xffffff, true));
    out.details.push(paint(new THREE.CylinderGeometry(1.45, 1.45, 0.5, 14).translate(x, 0.25, 2.6), COL.stoneDark, true));
    out.details.push(paint(new THREE.CylinderGeometry(1.42, 1.42, 0.22, 14).translate(x, 0.5 + th, 2.6), COL.trim));
    out.roof.push(new THREE.ConeGeometry(1.75, 3.2, 14).translate(x, 0.5 + th + 1.6, 2.6));
    for (const y of [2.8, 6.3, 9.8]) {
      out.details.push(paint(box(0.9, 1.3, 0.16, x, y, 3.88), COL.trim));
      out.glass.push(paint(box(0.62, 1.0, 0.06, x, y, 3.92)));
    }
  }
  // Portico: four columns, entablature and pediment.
  for (const x of [-2.4, -0.8, 0.8, 2.4]) out.details.push(paint(new THREE.CylinderGeometry(0.24, 0.28, 4.4, 12).translate(x, 2.7, 5.2), COL.trim));
  out.details.push(paint(box(5.6, 0.45, 2.3, 0, 5.1, 4.45), COL.trim));
  out.details.push(paint(gableWall(5.8, 1.4, 0.4).translate(0, 5.32, 5.5), COL.trim));
  out.details.push(paint(box(5.6, 0.3, 2.4, 0, 0.15, 4.6), COL.stone, true)); // portico floor
  door(out, { x: -0.6, z: 3.52, color: 0x2f3a56, w: 1.1, h: 3.8 });
  door(out, { x: 0.6, z: 3.52, color: 0x2f3a56, w: 1.1, h: 3.8 });
  steps(out, { x: 0, z: 5.6, w: 4.4 });
  path(out, 0, 6.6);
  for (const y of [2.8, 6.0, 9.3]) {
    for (const x of [-2.6, 2.6]) windowOn(out, { x, y, z: 3.52, w: 1.1, h: 1.5, shutters: false });
  }
  windowOn(out, { x: 0, y: 6.3, z: 3.52, w: 1.4, h: 1.8, shutters: false });
  windowOn(out, { x: 0, y: 9.3, z: 3.52, w: 1.2, h: 1.4, shutters: false });
  for (const y of [2.8, 6.0, 9.3]) {
    windowOn(out, { x: 4.02, y, z: -1.4, face: 'x' });
    windowOn(out, { x: -4.02, y, z: -1.4, face: 'x' });
  }
  chimney(out, -2.6, -2.2, top + 3.4);
  chimney(out, 2.6, -2.2, top + 3.4);
  lampBracket(out, -2.2, 3.4, 3.52);
  shrubs(out, [[-3.2, 5.4, 0.6], [3.2, 5.4, 0.6]]);
  Object.assign(out.meta, {
    porch: [-2.2, 3.55, 3.88], height: top + 6, hx: 5.9, hz: 3.7, cz: 0.2,
    slots: [[-5.2, 6.8], [5.2, 6.8], [-6.9, 1.0], [6.9, 1.0], [-6.9, -2.6], [6.9, -2.6]],
  });
  return out;
}

const BUILDERS = [cottage, cabin, bungalow, familyHome, twoStorey, manor, mansion];
export const MODEL_COUNT = BUILDERS.length;

// Tier 1 houses vary between three small homes; upgrades replace them.
export function modelFor(id, tier = 1, hash) {
  tier = Number(tier) | 0;
  if (tier >= 5) return 6;
  if (tier === 4) return 5;
  if (tier === 3) return 4;
  if (tier === 2) return 3;
  return hash % 3;
}

// Roofs: lighter at the ridge, darker at the eaves, so their shape reads
// from the high camera even at noon when every slope is lit the same.
function roofShade(g) {
  const pos = g.attributes.position;
  const col = g.attributes.color;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    lo = Math.min(lo, pos.getY(i));
    hi = Math.max(hi, pos.getY(i));
  }
  const span = Math.max(0.01, hi - lo);
  for (let i = 0; i < pos.count; i++) {
    const k = 0.7 + 0.3 * ((pos.getY(i) - lo) / span);
    col.setXYZ(i, col.getX(i) * k, col.getY(i) * k, col.getZ(i) * k);
  }
  return g;
}

let cache = null;
export function houseModels() {
  if (cache) return cache;
  cache = BUILDERS.map((build) => {
    const out = build();
    return {
      walls: merge(out.walls),
      roof: merge(out.roof.map((g) => roofShade(paint(g)))),
      details: merge(out.details),
      glass: merge(out.glass),
      meta: out.meta,
    };
  });
  return cache;
}
