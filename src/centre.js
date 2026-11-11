import * as THREE from 'three';
import { PITCH, LOT, BOULEVARD_Z } from '../shared/layout.js';
import { VILLAS, villaLevel } from '../shared/life.js';

// The town centre's middle strip (see shared/layout.js): the straight Main
// Boulevard between the two districts, two parks with benches, and the two
// villas that the whole town upgrades together.

const lam = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra });
const flat = (color) => lam(color, { flatShading: true });
const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);
function put(parent, geo, mat, x, y, z, ry = 0) {
  const m = new THREE.Mesh(geo, typeof mat === 'number' ? lam(mat) : mat);
  m.position.set(x, y, z);
  m.rotation.y = ry;
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

function label(text, w, h, bg = '#1d2b55', fg = '#fff') {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = Math.round((512 * h) / w);
  const g = c.getContext('2d');
  g.fillStyle = bg;
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = '#f2c94c';
  g.lineWidth = 10;
  g.strokeRect(5, 5, c.width - 10, c.height - 10);
  g.fillStyle = fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `900 ${Math.round(c.height * 0.5)}px Nunito, system-ui, sans-serif`;
  g.fillText(text, c.width / 2, c.height / 2 + 4, c.width - 30);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  // Two faces back to back, so the text reads the right way from both sides.
  const mesh = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ map: tex });
  for (const ry of [0, Math.PI]) {
    const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    face.rotation.y = ry;
    face.position.z = ry ? -0.01 : 0.01;
    mesh.add(face);
  }
  return { mesh, canvas: c, tex };
}

// Where the boulevard runs (road centre line) and how long it is.
export const BOULEVARD = { z: BOULEVARD_Z, x0: -1.5 * PITCH - 30, x1: 1.5 * PITCH + 30 };
// Villas: centre of their lot, facing north onto the boulevard.
const VILLA_CELL_Z = PITCH;
export const VILLA_SPOTS = VILLAS.map((v, i) => ({ ...v, i, x: i === 0 ? -36 : 36, z: VILLA_CELL_Z + 8 }));
// Footprint per level (half width, half depth), for collision and the door.
export const villaSize = (level) => ({ hw: 7 + level, hd: 6 + level * 0.8 });
export const villaDoor = (i, level) => {
  const v = VILLA_SPOTS[i];
  return { x: v.x, z: v.z - villaSize(level).hd - 3.5 };
};

// ---------- one villa, bigger and fancier with each level (1-5) ----------
function buildVilla(level, colors) {
  const g = new THREE.Group();
  const { hw, hd } = villaSize(level);
  const wall = flat(colors.wall);
  const trim = flat(0xfff7e6);
  const roof = flat(colors.roof);
  const glass = new THREE.MeshLambertMaterial({ color: 0x9fd3ff, emissive: 0x223355 });
  // Plinth and main block (two storeys).
  put(g, B(hw * 2 + 1.6, 0.5, hd * 2 + 1.6), trim, 0, 0.25, 0);
  const coreW = hw * 1.3;
  put(g, B(coreW, 7, hd * 1.4), wall, 0, 4, 0);
  put(g, B(coreW + 0.6, 0.4, hd * 1.4 + 0.6), trim, 0, 7.6, 0);
  // Pitched roof: a low four-sided pyramid.
  const r = put(g, new THREE.ConeGeometry(Math.hypot(coreW, hd * 1.4) * 0.55, 3, 4), roof, 0, 9.3, 0, Math.PI / 4);
  r.scale.set(1, 1, (hd * 1.4) / coreW);
  // Front: door, columns, balcony, windows.
  const front = -hd * 0.7 - 0.05;
  put(g, B(2.2, 3.4, 0.2), flat(colors.door), 0, 2.2, front);
  for (const x of [-2.2, 2.2]) put(g, new THREE.CylinderGeometry(0.35, 0.4, 7, 10), trim, x, 4, front - 1.6);
  put(g, B(6, 0.35, 2.2), trim, 0, 4.4, front - 1); // balcony
  for (const row of [2.4, 5.8]) {
    for (const x of [-coreW / 2 + 1.6, coreW / 2 - 1.6]) put(g, B(1.8, 1.8, 0.1), glass, x, row, front);
  }
  // Level 2: side wings.
  if (level >= 2) {
    for (const s of [-1, 1]) {
      const wx = s * (coreW / 2 + (hw - coreW / 2) / 2);
      const ww = hw - coreW / 2;
      put(g, B(ww, 4.6, hd * 1.2), wall, wx, 2.8, hd * 0.05);
      put(g, B(ww + 0.4, 0.35, hd * 1.2 + 0.4), trim, wx, 5.25, hd * 0.05);
      put(g, B(1.6, 1.6, 0.1), glass, wx, 2.8, -hd * 0.55);
    }
  }
  // Level 3: a pool and sun loungers behind, plus hedges.
  if (level >= 3) {
    put(g, B(hw * 1.2, 0.3, 4), trim, 0, 0.55, hd - 2.2);
    const water = put(g, B(hw * 1.1, 0.2, 3.2), new THREE.MeshLambertMaterial({ color: 0x3fc1e8, emissive: 0x0b4a66 }), 0, 0.75, hd - 2.2);
    water.castShadow = false;
    for (const s of [-1, 1]) put(g, B(0.8, 1.2, hd * 1.6), flat(0x3f8f3a), s * (hw + 0.2), 0.9, 0);
  }
  // Level 4: a tower with a balcony.
  if (level >= 4) {
    const tx = -coreW / 2 + 1.5;
    put(g, B(3, 12, 3), wall, tx, 6.5, 0);
    put(g, B(3.6, 0.4, 3.6), trim, tx, 12.6, 0);
    put(g, new THREE.ConeGeometry(2.6, 3.2, 4), roof, tx, 14.4, 0, Math.PI / 4);
    put(g, B(1.4, 1.6, 0.1), glass, tx, 10, -1.55);
  }
  // Level 5: a golden dome, flags and lights: the finished villa.
  if (level >= 5) {
    const gold = new THREE.MeshLambertMaterial({ color: 0xf2c94c, emissive: 0x6b4a00 });
    put(g, new THREE.SphereGeometry(2.4, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), gold, coreW / 2 - 2.2, 10.8, 0);
    put(g, new THREE.CylinderGeometry(0.08, 0.08, 4, 6), trim, coreW / 2 - 2.2, 14, 0);
    put(g, B(1.6, 1, 0.05), flat(colors.roof), coreW / 2 - 1.4, 15.3, 0);
    for (const s of [-1, 1]) put(g, new THREE.SphereGeometry(0.45, 10, 8), new THREE.MeshBasicMaterial({ color: 0xfff1c9 }), s * 3.2, 7.9, front - 1.6);
  }
  // Level badge: stars over the door.
  for (let i = 0; i < level; i++) {
    put(g, new THREE.OctahedronGeometry(0.32), new THREE.MeshLambertMaterial({ color: 0xf2c94c, emissive: 0x5a3d00 }), (i - (level - 1) / 2) * 0.9, 6.6, front - 0.25);
  }
  return g;
}

export function buildCentre() {
  const group = new THREE.Group();
  const seats = [];
  const solids = []; // { x, z, r } circles and { x, z, hw, hd } boxes

  // ---------- Main Boulevard: straight, paved, nothing in the way ----------
  const len = BOULEVARD.x1 - BOULEVARD.x0;
  const mid = (BOULEVARD.x0 + BOULEVARD.x1) / 2;
  const pave = put(group, B(len, 0.06, 9.6), lam(0xd9714e), mid, 0.03, BOULEVARD.z);
  pave.castShadow = false;
  // Gold centre line and white edge lines.
  for (let x = BOULEVARD.x0 + 3; x < BOULEVARD.x1 - 3; x += 7) put(group, B(3.6, 0.04, 0.5), lam(0xf2c94c), x, 0.08, BOULEVARD.z).castShadow = false;
  for (const s of [-1, 1]) put(group, B(len, 0.04, 0.3), lam(0xfff7e6), mid, 0.08, BOULEVARD.z + s * 4.5).castShadow = false;
  // Gateways at both ends (pillars stand on the sidewalks, the road stays clear).
  for (const x of [BOULEVARD.x0 + 4, BOULEVARD.x1 - 4]) {
    for (const s of [-1, 1]) {
      put(group, B(1.4, 8, 1.4), flat(0xfff7e6), x, 4, BOULEVARD.z + s * 6.6);
      put(group, new THREE.SphereGeometry(0.7, 10, 8), new THREE.MeshBasicMaterial({ color: 0xfff1c9 }), x, 8.6, BOULEVARD.z + s * 6.6);
    }
    put(group, B(1.2, 1.2, 14.6), flat(0xd94141), x, 7.6, BOULEVARD.z);
    const sign = label('Main Boulevard', 9, 1.6);
    sign.mesh.position.set(x, 6.3, BOULEVARD.z);
    sign.mesh.rotation.y = Math.PI / 2;
    group.add(sign.mesh);
  }

  // ---------- parks (north and south of the plaza) ----------
  for (const cz of [-PITCH, 2 * PITCH]) {
    const half = LOT / 2;
    // A clear cross of paths through the middle; benches along it.
    put(group, B(8, 0.08, LOT), lam(0xe9d8b4), 0, 0.36, cz).castShadow = false;
    put(group, B(LOT, 0.08, 8), lam(0xe9d8b4), 0, 0.36, cz).castShadow = false;
    // A round pond in each quarter's inner corner, flowers and trees outside.
    let seed = cz;
    const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    for (const [qx, qz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const px = qx * 40;
      const pz = cz + qz * 40;
      if (qx === qz) {
        const pond = put(group, new THREE.CylinderGeometry(9, 9, 0.2, 24), new THREE.MeshLambertMaterial({ color: 0x5bbbe8 }), px, 0.4, pz);
        pond.castShadow = false;
        put(group, new THREE.TorusGeometry(9, 0.5, 6, 24), flat(0xd9d4ca), px, 0.45, pz).rotation.x = Math.PI / 2;
        solids.push({ x: px, z: pz, r: 9.6 });
      } else {
        for (let i = 0; i < 12; i++) {
          const fx = px + (rnd() - 0.5) * 22;
          const fz = pz + (rnd() - 0.5) * 22;
          put(group, new THREE.IcosahedronGeometry(0.45, 0), flat([0xff5e7e, 0xffd166, 0xc77dff, 0xff9f43][i % 4]), fx, 0.7, fz);
        }
      }
      for (let i = 0; i < 6; i++) {
        const tx = qx * (26 + rnd() * (half - 32));
        const tz = cz + qz * (26 + rnd() * (half - 32));
        if (Math.hypot(tx - px, tz - pz) < 12) continue;
        const s = 0.8 + rnd() * 0.6;
        put(group, new THREE.CylinderGeometry(0.4 * s, 0.55 * s, 3 * s, 6), flat(0x7a5233), tx, 1.5 * s + 0.3, tz);
        put(group, new THREE.IcosahedronGeometry(2.4 * s, 0), flat([0x4f9a44, 0x5fae4c, 0x3f8f3a][i % 3]), tx, 4.3 * s + 0.3, tz);
        solids.push({ x: tx, z: tz, r: 0.9 * s });
      }
    }
    // Benches face the main path (x = 0) and the cross path (z = cz).
    for (const dz of [-30, -14, 14, 30]) {
      for (const s of [-1, 1]) {
        const bx = s * 6;
        const bench = put(group, B(0.7, 0.18, 2.6), flat(0xa8774a), bx, 0.85, cz + dz);
        put(bench, B(0.12, 0.7, 2.6), flat(0xa8774a), s * 0.32, 0.45, 0);
        for (const lz of [-1, 1]) put(bench, B(0.5, 0.75, 0.12), flat(0x3a3f4a), 0, -0.4, lz * 1.1);
        bench.userData.seat = { x: bx, z: cz + dz, h: s > 0 ? -Math.PI / 2 : Math.PI / 2, kind: 'bench' };
        seats.push(bench.userData.seat);
      }
    }
    const sign = label(cz < 0 ? 'North Park' : 'South Park', 6, 1.2, '#2f6b3a');
    sign.mesh.position.set(0, 3.2, cz + (cz < 0 ? half - 6 : -half + 6));
    group.add(sign.mesh);
    put(group, B(0.25, 3, 0.25), flat(0x5a4636), -2.6, 1.8, sign.mesh.position.z - 0.1);
    put(group, B(0.25, 3, 0.25), flat(0x5a4636), 2.6, 1.8, sign.mesh.position.z - 0.1);
  }

  // ---------- villas (south of the boulevard, in the middle) ----------
  const villas = VILLA_SPOTS.map((v) => {
    const holder = new THREE.Group();
    holder.position.set(v.x, 0.3, v.z);
    // The model's front is its -z side: north, onto the boulevard.
    group.add(holder);
    // Path from the boulevard to the door, and a sign.
    put(group, B(3.4, 0.08, v.z - (VILLA_CELL_Z - LOT / 2) - 4), lam(0xe9d8b4), v.x, 0.36, (VILLA_CELL_Z - LOT / 2 + v.z) / 2 - 2).castShadow = false;
    const sign = label(v.name, 6, 1.2, '#5a2d82');
    sign.mesh.position.set(v.x + 5.2, 2.6, VILLA_CELL_Z - LOT / 2 + 8);
    group.add(sign.mesh);
    for (const dx of [-2.6, 2.6]) put(group, B(0.25, 3, 0.25), flat(0x5a4636), v.x + 5.2 + dx, 1.8, VILLA_CELL_Z - LOT / 2 + 8.1);
    return { ...v, holder, level: 0, sign };
  });
  // Between the villas: a formal garden with a golden statue on a plinth.
  {
    const gz = VILLA_CELL_Z + 22;
    put(group, B(14, 0.1, 30), lam(0x6fd14a), 0, 0.36, gz).castShadow = false;
    for (const s of [-1, 1]) put(group, B(0.9, 1.1, 30), flat(0x3f8f3a), s * 7.4, 0.85, gz);
    put(group, new THREE.CylinderGeometry(2.6, 3, 1.4, 8), flat(0xfff7e6), 0, 1, gz + 8);
    const gold = new THREE.MeshLambertMaterial({ color: 0xf2c94c, emissive: 0x5a3d00, flatShading: true });
    put(group, new THREE.CylinderGeometry(0.6, 0.9, 2.6, 7), gold, 0, 3, gz + 8);
    put(group, new THREE.IcosahedronGeometry(1.1, 0), gold, 0, 5, gz + 8);
    solids.push({ x: 0, z: gz + 8, r: 3.2 });
    for (let i = 0; i < 10; i++) {
      put(group, new THREE.IcosahedronGeometry(0.5, 0), flat([0xff5e7e, 0xffd166, 0xc77dff, 0xff9f43, 0xffffff][i % 5]), (i % 2 ? 1 : -1) * 4.6, 0.8, gz - 12 + Math.floor(i / 2) * 5);
    }
  }

  const api = {
    group,
    seats,
    villas,
    // Rebuild a villa when its level changes.
    setVillaLevel(i, level) {
      const v = villas[i];
      if (v.level === level) return false;
      const grew = v.level > 0 && level > v.level;
      v.level = level;
      v.holder.traverse((o) => {
        if (o !== v.holder) {
          o.geometry?.dispose();
          o.material?.dispose?.();
        }
      });
      v.holder.clear();
      const model = buildVilla(level, v.colors);
      model.traverse((o) => (o.userData.villa = i));
      v.holder.add(model);
      return grew;
    },
    blocked(x, z) {
      for (const s of solids) {
        if (s.r ? (x - s.x) ** 2 + (z - s.z) ** 2 < s.r * s.r : Math.abs(x - s.x) < s.hw && Math.abs(z - s.z) < s.hd) return true;
      }
      for (const v of villas) {
        const { hw, hd } = villaSize(v.level || 1);
        if (Math.abs(x - v.x) < hw + 0.8 && Math.abs(z - v.z) < hd + 0.8) return true;
      }
      return false;
    },
  };
  for (const v of villas) api.setVillaLevel(v.i, villaLevel(0));
  return api;
}
