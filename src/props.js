import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Yard props (garden beds, crops, kennel, alarm bell, raid flag) and cars.
// All vertex-coloured, so each model is a single instanced draw call.
// Parts baked white (0xffffff) take the per-instance colour.

function paint(geo, hex = 0xffffff) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  for (const a of ['uv', 'uv1']) if (g.attributes[a]) g.deleteAttribute(a);
  const c = new THREE.Color(hex);
  const arr = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < arr.length; i += 3) arr.set([c.r, c.g, c.b], i);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}
const box = (w, h, d, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
const merge = (parts) => {
  const g = mergeGeometries(parts);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
};

// ---------- garden ----------
// Local positions (house frame) of the three garden beds, behind the house.
export const BED_SPOTS = [
  [-2.2, -4.7],
  [0, -4.7],
  [2.2, -4.7],
];

export function bedGeometry() {
  return merge([
    paint(box(1.8, 0.28, 1.15, 0, 0.14, 0), 0x8a5a2b), // wooden frame
    paint(box(1.55, 0.06, 0.9, 0, 0.29, 0), 0x5a3a22), // soil
  ]);
}

// Leafy plant; scaled by growth stage.
export function plantGeometry() {
  const p = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    p.push(paint(new THREE.ConeGeometry(0.2, 1.0, 4).rotateZ(Math.cos(a) * 0.55).rotateX(Math.sin(a) * 0.55).translate(Math.cos(a) * 0.2, 0.75, Math.sin(a) * 0.2), i % 2 ? 0x4f9a44 : 0x62b04f));
  }
  return merge(p);
}

// Ripe produce: small rounds tinted by crop colour (pumpkin is scaled up).
export function fruitGeometry() {
  return merge([
    paint(new THREE.IcosahedronGeometry(0.26, 1).translate(-0.32, 0.6, 0.15)),
    paint(new THREE.IcosahedronGeometry(0.26, 1).translate(0.3, 0.66, -0.12)),
    paint(new THREE.IcosahedronGeometry(0.24, 1).translate(0.02, 0.9, 0.22)),
  ]);
}

// ---------- defences ----------
export const KENNEL_SPOT = [-5.9, -4.6];
export const BELL_SPOT = [-1.6, 6.4];
export const FLAG_SPOT = [-4.2, 7.2];

export function kennelGeometry() {
  return merge([
    paint(box(1.4, 1.0, 1.2, 0, 0.5, 0), 0xa8774a),
    paint(new THREE.ConeGeometry(1.05, 0.6, 4).rotateY(Math.PI / 4).translate(0, 1.3, 0), 0xc0504d),
    paint(box(0.5, 0.6, 0.05, 0, 0.35, 0.61), 0x2a2a2e), // doorway
    // the dog, lying in front
    paint(box(0.45, 0.35, 0.8, 0.1, 0.18, 1.15), 0xd9b98a),
    paint(box(0.36, 0.34, 0.36, 0.1, 0.42, 1.62), 0xd9b98a),
    paint(box(0.1, 0.18, 0.08, -0.04, 0.66, 1.62), 0x7a5233),
    paint(box(0.1, 0.18, 0.08, 0.24, 0.66, 1.62), 0x7a5233),
    paint(box(0.08, 0.08, 0.05, 0.1, 0.42, 1.82), 0x1b1b1f),
  ]);
}

export function bellGeometry() {
  return merge([
    paint(box(0.14, 1.9, 0.14, 0, 0.95, 0), 0x3a3f4a),
    paint(box(0.6, 0.1, 0.12, 0.25, 1.85, 0), 0x3a3f4a),
    paint(new THREE.CylinderGeometry(0.12, 0.3, 0.42, 10).translate(0.48, 1.55, 0), 0xd94141),
  ]);
}

// Pennant on a pole; tinted red (raid mode) or blue (shielded).
export function flagGeometry() {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.lineTo(1.1, 0.3);
  s.lineTo(0, 0.6);
  s.closePath();
  return merge([
    paint(new THREE.CylinderGeometry(0.05, 0.06, 2.6, 6).translate(0, 1.3, 0), 0x3a3f4a),
    paint(new THREE.ExtrudeGeometry(s, { depth: 0.04, bevelEnabled: false }).translate(0.05, 1.9, 0)),
  ]);
}

// ---------- cars (forward = +z) ----------
export const CAR_SPOT = [5.4, 6.4]; // parked by the lane, parallel to it

const wheel = (x, z, r = 0.38) => paint(new THREE.CylinderGeometry(r, r, 0.3, 12).rotateZ(Math.PI / 2).translate(x, r, z), 0x1d1d22);
const glass = 0x2a3542;

export function carGeometry(model) {
  const p = [];
  if (model === 'van') {
    p.push(paint(box(1.9, 1.9, 4.4, 0, 1.35, 0)));
    p.push(paint(box(1.92, 0.7, 1.2, 0, 1.85, 1.65), glass));
    p.push(paint(box(1.94, 0.5, 2.4, 0, 1.75, -0.6), glass));
    p.push(paint(box(1.95, 0.15, 4.42, 0, 0.75, 0), 0xffffff));
  } else if (model === 'pickup') {
    p.push(paint(box(1.9, 0.9, 4.8, 0, 0.85, 0)));
    p.push(paint(box(1.8, 0.85, 1.9, 0, 1.7, 0.7)));
    p.push(paint(box(1.82, 0.55, 1.4, 0, 1.75, 0.95), glass));
    p.push(paint(box(1.7, 0.45, 2.0, 0, 1.15, -1.3), 0x2b2b30)); // open bed
  } else if (model === 'sports') {
    p.push(paint(box(1.95, 0.6, 4.3, 0, 0.6, 0)));
    p.push(paint(box(1.6, 0.5, 1.7, 0, 1.1, -0.2), glass));
    p.push(paint(box(1.9, 0.12, 0.5, 0, 1.0, -2.0), 0x1d1d22)); // spoiler
  } else {
    p.push(paint(box(1.8, 0.9, 3.8, 0, 0.8, 0)));
    p.push(paint(box(1.62, 0.75, 2.1, 0, 1.6, -0.2), glass));
  }
  const len = model === 'pickup' ? 1.6 : model === 'van' ? 1.45 : model === 'sports' ? 1.35 : 1.2;
  for (const x of [-0.92, 0.92]) for (const z of [-len, len]) p.push(wheel(x, z, model === 'sports' ? 0.34 : 0.38));
  const front = model === 'pickup' ? 2.4 : model === 'van' ? 2.2 : model === 'sports' ? 2.15 : 1.9;
  for (const x of [-0.6, 0.6]) {
    p.push(paint(box(0.4, 0.18, 0.06, x, 0.9, front + 0.01), 0xfff3c4)); // headlights
    p.push(paint(box(0.4, 0.16, 0.06, x, 0.9, -front - 0.01), 0xd94141)); // tail lights
  }
  return merge(p);
}
