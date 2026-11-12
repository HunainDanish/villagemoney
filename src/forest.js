import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { LOT, PITCH, gridToBlock, blockOfHouse } from '../shared/layout.js';

// The wild woods round the town.
// - Every grid cell that has no block yet (beyond the town's edge) is thick
//   forest, cut by two dirt trails that follow the future streets. When enough
//   people join, the next block is "cleared" out of the woods.
// - Far away, a ring of forested hills and blue mountains closes the horizon.
//   They follow the camera and are tinted by the sky, so they read as distance.

const MOBILE = matchMedia('(pointer: coarse)').matches;
const RADIUS = 3; // forest cells drawn round the player (7x7)
const PER_CELL = MOBILE ? 100 : 170;
const TRAIL = 4.5; // half width of the dirt trails through a cell
const CAP = (2 * RADIUS + 1) ** 2 * PER_CELL;
const FAR2 = 345 ** 2; // just past the fog's end

function rnd(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function colored(geo, hex) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(hex);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  g.deleteAttribute('uv');
  return g;
}

// Wild trees: taller and fuller than the garden ones.
function firGeometry() {
  return mergeGeometries([
    colored(new THREE.CylinderGeometry(0.28, 0.42, 2, 6).translate(0, 1, 0), 0x5e3c24),
    colored(new THREE.ConeGeometry(2.4, 3.2, 7).translate(0, 3.2, 0), 0x2d6e44),
    colored(new THREE.ConeGeometry(1.9, 2.8, 7).translate(0, 4.8, 0), 0x347d4b),
    colored(new THREE.ConeGeometry(1.3, 2.4, 7).translate(0, 6.3, 0), 0x3d8c52),
  ]);
}
function broadGeometry() {
  return mergeGeometries([
    colored(new THREE.CylinderGeometry(0.35, 0.55, 3, 6).translate(0, 1.5, 0), 0x6e4a2c),
    colored(new THREE.IcosahedronGeometry(2.3, 0).translate(0, 4.4, 0), 0x55a447),
    colored(new THREE.IcosahedronGeometry(1.6, 0).translate(1.2, 3.8, 0.6), 0x4c9a40),
    colored(new THREE.IcosahedronGeometry(1.5, 0).translate(-1.1, 4.0, -0.5), 0x63b150),
  ]);
}

// Hills ring: a jagged strip of triangles, height from layered sines.
function ridge(radius, base, peak, freq, seed, steps = 160) {
  const pos = [];
  const h = (a) =>
    base + peak * (0.55 + 0.25 * Math.sin(a * freq + seed) + 0.15 * Math.sin(a * freq * 2.7 + seed * 3) + 0.05 * Math.sin(a * freq * 7.1));
  for (let i = 0; i < steps; i++) {
    const a0 = (i / steps) * Math.PI * 2;
    const a1 = ((i + 1) / steps) * Math.PI * 2;
    const p0 = [Math.cos(a0) * radius, Math.sin(a0) * radius];
    const p1 = [Math.cos(a1) * radius, Math.sin(a1) * radius];
    const h0 = h(a0);
    const h1 = h(a1);
    pos.push(p0[0], -5, p0[1], p1[0], -5, p1[1], p1[0], h1, p1[1]);
    pos.push(p0[0], -5, p0[1], p1[0], h1, p1[1], p0[0], h0, p0[1]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

// A tree-line of cone silhouettes along a ring.
function treeline(radius, n, seed) {
  const r = rnd(seed);
  const parts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + r() * 0.01;
    const s = 10 + r() * 14;
    const rr = radius + (r() - 0.5) * 14;
    parts.push(new THREE.ConeGeometry(s * 0.45, s * 1.6, 5).translate(Math.cos(a) * rr, s * 0.8 + 2, Math.sin(a) * rr));
  }
  const g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)));
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  return g;
}

const backMat = (hex) => new THREE.MeshBasicMaterial({ color: hex, fog: false, side: THREE.DoubleSide });

export class Forest {
  constructor(scene) {
    const inst = (geo) => {
      const m = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), CAP);
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = !MOBILE;
      m.position.y = 0.3;
      scene.add(m);
      return m;
    };
    this.firs = inst(firGeometry());
    this.broad = inst(broadGeometry());
    this.firs.setColorAt(0, new THREE.Color());
    this.broad.setColorAt(0, new THREE.Color());

    // Forest floor: a mossy pad per cell, with the two trails left as dirt.
    const pad = LOT + 12;
    const floor = mergeGeometries([
      colored(new THREE.BoxGeometry(pad, 0.3, pad).translate(0, 0.15, 0), 0x4f8f3e),
      colored(new THREE.BoxGeometry(pad, 0.04, TRAIL * 1.6).translate(0, 0.32, 0), 0xb08a5a),
      colored(new THREE.BoxGeometry(TRAIL * 1.6, 0.04, pad).translate(0, 0.32, 0), 0xb08a5a),
    ]);
    this.floor = new THREE.InstancedMesh(floor, new THREE.MeshLambertMaterial({ vertexColors: true }), (2 * RADIUS + 1) ** 2);
    this.floor.count = 0;
    this.floor.frustumCulled = false;
    this.floor.receiveShadow = true;
    scene.add(this.floor);

    // Horizon: mountains far off, forested hills in front of them.
    this.back = new THREE.Group();
    this.mountains = new THREE.Mesh(ridge(720, 10, 150, 5, 1.3), backMat(0x7f9cc4));
    this.hills = new THREE.Mesh(ridge(650, 4, 70, 9, 4.1, 220), backMat(0x5f8f6a));
    this.trees = new THREE.Mesh(treeline(620, MOBILE ? 260 : 420, 7), backMat(0x3f6e4c));
    for (const m of [this.mountains, this.hills, this.trees]) m.renderOrder = -0.5;
    this.back.add(this.mountains, this.hills, this.trees);
    scene.add(this.back);

    this.cells = new Map(); // "gx,gz" -> trees [{x,z,r,fir,s,rot,tint}]
    this.key = null;
    this.c = new THREE.Color();
  }

  // Trees of a wild cell (the aerial view draws them too).
  cellTrees(gx, gz) {
    return this.#cell(gx, gz);
  }

  // Is that cell drawn in full by the woods round the player?
  covers(gx, gz, center) {
    return Math.abs(gx - Math.round(center.x / PITCH)) <= RADIUS && Math.abs(gz - Math.round(center.z / PITCH)) <= RADIUS;
  }

  // Trees of one wild cell, the same for every visitor.
  #cell(gx, gz) {
    const k = `${gx},${gz}`;
    let list = this.cells.get(k);
    if (list) return list;
    const r = rnd(Math.imul(gx, 73856093) ^ Math.imul(gz, 19349663));
    const cx = gx * PITCH;
    const cz = gz * PITCH;
    const half = LOT / 2 + 3;
    // A clearing in some cells: a meadow in the woods.
    const glade = r() < 0.35 ? { x: (r() - 0.5) * 60, z: (r() - 0.5) * 60, r: 12 + r() * 10 } : null;
    list = [];
    for (let tries = 0; list.length < PER_CELL && tries < PER_CELL * 5; tries++) {
      const lx = (r() * 2 - 1) * half;
      const lz = (r() * 2 - 1) * half;
      if (Math.abs(lx) < TRAIL + 1.5 || Math.abs(lz) < TRAIL + 1.5) continue;
      if (glade && Math.hypot(lx - glade.x, lz - glade.z) < glade.r) continue;
      const s = 1.1 + r() * 1.3;
      const t = { x: cx + lx, z: cz + lz, s, r: 0.7 * s, fir: r() < 0.6, rot: r() * 6.28, tint: 0.82 + r() * 0.3 };
      if (list.some((o) => (o.x - t.x) ** 2 + (o.z - t.z) ** 2 < 9)) continue;
      list.push(t);
    }
    this.cells.set(k, list);
    if (this.cells.size > 200) this.cells.delete(this.cells.keys().next().value);
    return list;
  }

  #wild(gx, gz, total) {
    if (total < 1) return false;
    const b = gridToBlock(gx, gz);
    return b > blockOfHouse(total);
  }

  // Redraw when you change cell or the town grows.
  // view: { x, z, scale } while in the aerial view (the horizon is then
  // centred on the whole town and grown to fit round it).
  update(center, total, horizon, day, view = null) {
    this.back.position.set(view?.x ?? center.x, 0, view?.z ?? center.z);
    this.back.scale.setScalar(view?.scale ?? 1);
    // Distance haze: blend the far layers into the sky colour.
    const night = 1 - day;
    const tint = (mesh, hex, haze) => {
      mesh.material.color.setHex(hex).lerp(this.c.setHex(horizon), haze).multiplyScalar(1 - night * 0.55);
    };
    tint(this.mountains, 0x7f9cc4, 0.5);
    tint(this.hills, 0x5f8f6a, 0.35);
    tint(this.trees, 0x3f6e4c, 0.25);

    const gx = Math.round(center.x / PITCH);
    const gz = Math.round(center.z / PITCH);
    // Rebuild every few steps; trees past the fog line aren't drawn at all, so
    // the far woods fade into haze in front of the hills.
    const key = `${Math.round(center.x / 20)},${Math.round(center.z / 20)},${total},${Boolean(view)}`;
    if (key === this.key) return;
    this.key = key;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const sc = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    let firs = 0;
    let broad = 0;
    let floors = 0;
    for (let dx = -RADIUS; dx <= RADIUS; dx++) {
      for (let dz = -RADIUS; dz <= RADIUS; dz++) {
        if (!this.#wild(gx + dx, gz + dz, total)) continue;
        this.floor.setMatrixAt(floors++, m.makeTranslation((gx + dx) * PITCH, 0, (gz + dz) * PITCH));
        for (const t of this.#cell(gx + dx, gz + dz)) {
          if (!view && (t.x - center.x) ** 2 + (t.z - center.z) ** 2 > FAR2) continue;
          m.compose(v.set(t.x, 0, t.z), q.setFromAxisAngle(up, t.rot), sc.setScalar(t.s));
          const mesh = t.fir ? this.firs : this.broad;
          const i = t.fir ? firs++ : broad++;
          mesh.setMatrixAt(i, m);
          mesh.setColorAt(i, this.c.setScalar(t.tint));
        }
      }
    }
    for (const [mesh, n] of [[this.firs, firs], [this.broad, broad], [this.floor, floors]]) {
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  // Trunks block walking; the trails and glades are free.
  blocked(x, z, total) {
    const gx = Math.round(x / PITCH);
    const gz = Math.round(z / PITCH);
    if (!this.#wild(gx, gz, total)) return false;
    for (const t of this.#cell(gx, gz)) if ((t.x - x) ** 2 + (t.z - z) ** 2 < t.r * t.r) return true;
    return false;
  }
}
