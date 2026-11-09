import * as THREE from 'three';
import { LOT, PITCH, PLOT, worldToGrid, gridToBlock, housePosition } from '../shared/layout.js';

// GPS directions: a route along the town's roads and lanes, drawn as moving
// arrows on the ground, with a banner ("Right at the next corner · 85 m ·
// 1 min") and optional auto-walk. 1 world unit is about 1 metre.

const ROAD = (k) => (k + 0.5) * PITCH; // centre line of road k (x or z)
const LANE_STEP = PLOT; // lanes / back gardens run along x every 16 units
const WALK_SPEED = 14;

const nearestRoad = (v) => ROAD(Math.round(v / PITCH - 0.5));

// From a point, how do we reach the road network? Returns the points to walk
// and the road point reached ({x, z, axis}: 'v' = road along z, 'h' = along x).
// Clear walkways across the plaza (no fountain, stalls, rocks or trees).
const PLAZA_CORRIDOR = 17;

function exitToRoad(p, toward = p) {
  const [gx, gz] = worldToGrid(p.x, p.z);
  const cx = gx * PITCH;
  const cz = gz * PITCH;
  const lx = p.x - cx;
  const lz = p.z - cz;
  const half = LOT / 2;
  const plaza = gridToBlock(gx, gz) < 0;

  // Already on a road or sidewalk: snap to the nearest road centre line.
  if (Math.abs(lx) > half - 1 || Math.abs(lz) > half - 1) {
    const dx = Math.abs(p.x - nearestRoad(p.x));
    const dz = Math.abs(p.z - nearestRoad(p.z));
    return dx < dz
      ? { walk: [], road: { x: nearestRoad(p.x), z: p.z, axis: 'v' } }
      : { walk: [], road: { x: p.x, z: nearestRoad(p.z), axis: 'h' } };
  }
  // Plaza: step onto a clear walkway, then out through the edge facing the
  // destination (a straight line would hit the fountain or the stalls).
  if (plaza) {
    const C = PLAZA_CORRIDOR;
    if (Math.abs(toward.z - p.z) >= Math.abs(toward.x - p.x)) {
      const x = cx + Math.sign(lx || 1) * C;
      const sz = Math.sign(toward.z - p.z || 1);
      return { walk: [{ x, z: p.z }], road: { x, z: cz + sz * (PITCH / 2), axis: 'h' } };
    }
    const z = cz + Math.sign(lz || 1) * C;
    const sx = Math.sign(toward.x - p.x || 1);
    return { walk: [{ x: p.x, z }], road: { x: cx + sx * (PITCH / 2), z, axis: 'v' } };
  }
  // Outer rows: straight out to the road they face.
  if (Math.abs(lz) > half - 10) {
    return { walk: [], road: { x: p.x, z: cz + Math.sign(lz || 1) * (PITCH / 2), axis: 'h' } };
  }
  // Inside a block: step onto the nearest lane, then along it to the side road.
  const laneZ = cz + Math.round(lz / LANE_STEP) * LANE_STEP;
  const side = Math.sign(lx || 1);
  const walk = Math.abs(laneZ - p.z) > 0.5 ? [{ x: p.x, z: laneZ }] : [];
  return { walk, road: { x: cx + side * (PITCH / 2), z: laneZ, axis: 'v' } };
}

// Road point to road point along the grid (at most two turns).
function connect(a, b) {
  if (a.axis === 'v' && b.axis === 'v') {
    if (Math.abs(a.x - b.x) < 0.5) return [];
    const zh = nearestRoad((a.z + b.z) / 2);
    return [{ x: a.x, z: zh }, { x: b.x, z: zh }];
  }
  if (a.axis === 'h' && b.axis === 'h') {
    if (Math.abs(a.z - b.z) < 0.5) return [];
    const xv = nearestRoad((a.x + b.x) / 2);
    return [{ x: xv, z: a.z }, { x: xv, z: b.z }];
  }
  if (a.axis === 'v') return [{ x: a.x, z: b.z }];
  return [{ x: b.x, z: a.z }];
}

function dedupe(points) {
  const out = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(last.x - p.x, last.z - p.z) > 0.5) out.push(p);
  }
  // Drop points that sit in a straight line (no real turn).
  return out.filter((p, i) => {
    if (i === 0 || i === out.length - 1) return true;
    const a = out[i - 1];
    const c = out[i + 1];
    const cross = (p.x - a.x) * (c.z - p.z) - (p.z - a.z) * (c.x - p.x);
    return Math.abs(cross) > 1;
  });
}

// Full route from `from` to `to` (both {x, z}).
export function planRoute(from, to) {
  if (Math.hypot(from.x - to.x, from.z - to.z) < 22) return [from, to];
  const [ga, gb] = [worldToGrid(from.x, from.z), worldToGrid(to.x, to.z)];
  const sameLane = ga[0] === gb[0] && ga[1] === gb[1] && Math.abs(from.z - to.z) < 3;
  if (sameLane) return [from, to];
  const s = exitToRoad(from, to);
  const t = exitToRoad(to, from);
  return dedupe([from, ...s.walk, s.road, ...connect(s.road, t.road), t.road, ...t.walk.slice().reverse(), to]);
}

// Where to stand to visit a house: on its path, just in front of the door.
export function doorPoint(id) {
  const p = housePosition(id);
  return { x: p.x + Math.sin(p.facing) * 7, z: p.z + Math.cos(p.facing) * 7 };
}

export class Navigator {
  constructor({ world, player, banner }) {
    this.world = world;
    this.player = player;
    this.banner = banner;
    this.route = null;
    this.auto = false;
    // Flat chevrons on the ground, pointing along the route.
    const s = new THREE.Shape();
    s.moveTo(-0.9, -0.5);
    s.lineTo(0, 0.5);
    s.lineTo(0.9, -0.5);
    s.lineTo(0.9, -0.05);
    s.lineTo(0, 0.95);
    s.lineTo(-0.9, -0.05);
    s.closePath();
    const geo = new THREE.ShapeGeometry(s).rotateX(-Math.PI / 2).rotateY(Math.PI);
    this.arrows = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0x3d7cf5, transparent: true, opacity: 0.85, depthWrite: false }), 400);
    this.arrows.count = 0;
    this.arrows.frustumCulled = false;
    this.arrows.renderOrder = 2;
    world.scene.add(this.arrows);
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.up = new THREE.Vector3(0, 1, 0);
    banner.querySelector('.nav-auto').onclick = () => this.setAuto(!this.auto);
    banner.querySelector('.nav-stop').onclick = () => this.stop();
    this.onArrive = () => {};
  }

  // Start directions to a place: { x, z, name, house? }.
  go(dest) {
    this.dest = dest;
    this.reroutedAt = 0;
    this.#plan();
    this.banner.hidden = false;
    this.setAuto(false);
    if (dest.house) this.world.showMarker(dest.house);
  }

  stop() {
    this.route = null;
    this.dest = null;
    this.auto = false;
    this.arrows.count = 0;
    this.banner.hidden = true;
    this.player.target = null;
  }

  setAuto(on) {
    this.auto = on && Boolean(this.route);
    this.banner.querySelector('.nav-auto').textContent = this.auto ? '⏸' : '▶';
    this.banner.querySelector('.nav-auto').title = this.auto ? 'Stop walking' : 'Walk me there';
    if (!this.auto) this.player.target = null;
  }

  #plan() {
    const p = this.player.pos;
    this.route = planRoute({ x: p.x, z: p.z }, this.dest);
    this.lengths = [];
    for (let i = 0; i < this.route.length - 1; i++) {
      const a = this.route[i];
      const b = this.route[i + 1];
      this.lengths.push(Math.hypot(b.x - a.x, b.z - a.z));
    }
  }

  // Closest point of the route to the player: segment index + distance along it.
  #progress() {
    const p = this.player.pos;
    let best = { i: 0, t: 0, d: Infinity };
    for (let i = 0; i < this.route.length - 1; i++) {
      const a = this.route[i];
      const b = this.route[i + 1];
      const L = this.lengths[i] || 1e-6;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.z - a.z) * (b.z - a.z)) / (L * L)));
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < best.d - 0.01) best = { i, t, d };
    }
    return best;
  }

  update(time) {
    if (!this.route) return;
    // Someone took the controls: stop auto-walking.
    if (this.auto && (this.player.keys.size || (this.player.joy && this.player.joy.length > 0.12))) this.setAuto(false);

    let prog = this.#progress();
    if (prog.d > 25 && performance.now() - this.reroutedAt > 2000) {
      this.reroutedAt = performance.now();
      this.#plan();
      prog = this.#progress();
    }
    // Remaining distance.
    let remaining = this.lengths[prog.i] * (1 - prog.t);
    for (let i = prog.i + 1; i < this.lengths.length; i++) remaining += this.lengths[i];
    const end = this.route[this.route.length - 1];
    const toEnd = Math.hypot(this.player.pos.x - end.x, this.player.pos.z - end.z);

    if (toEnd < 3.5) {
      const name = this.dest.name;
      const dest = this.dest;
      this.stop();
      this.onArrive(dest, name);
      return;
    }

    // Next turn.
    let text = 'Straight ahead';
    const toCorner = this.lengths[prog.i] * (1 - prog.t);
    if (prog.i + 2 < this.route.length) {
      const a = this.route[prog.i];
      const b = this.route[prog.i + 1];
      const c = this.route[prog.i + 2];
      const cross = (b.x - a.x) * (c.z - b.z) - (b.z - a.z) * (c.x - b.x);
      const dir = cross > 0 ? 'Right' : 'Left';
      const arrow = cross > 0 ? '↱' : '↰';
      text = toCorner < 12 ? `${arrow} Turn ${dir.toLowerCase()} now` : `${arrow} ${dir} at the next corner · ${Math.round(toCorner)} m`;
    } else {
      text = `⬆ ${this.dest.name} ahead · ${Math.round(remaining)} m`;
    }
    const speed = this.player.vehicle ? 30 : WALK_SPEED;
    const mins = Math.max(1, Math.round(remaining / speed / 60));
    this.banner.querySelector('.nav-text').textContent = text;
    this.banner.querySelector('.nav-sub').textContent = `${this.dest.name} · ${Math.round(remaining)} m · ${mins} min`;

    // Auto-walk: aim at the next route point.
    if (this.auto) {
      // Next route point that we're not already standing on.
      let j = Math.min(prog.i + 1, this.route.length - 1);
      const pp = this.player.pos;
      while (j < this.route.length - 1 && Math.hypot(this.route[j].x - pp.x, this.route[j].z - pp.z) < 1.5) j++;
      const next = this.route[j];
      if (!this.player.target || this.player.target.x !== next.x || this.player.target.z !== next.z) {
        this.player.target = { x: next.x, z: next.z, range: 0.6 };
      }
    }

    // Arrows from the player onward, scrolling forward.
    let n = 0;
    const spacing = 3.2;
    let offset = (time * 6) % spacing;
    for (let i = prog.i; i < this.route.length - 1 && n < 400; i++) {
      const a = this.route[i];
      const b = this.route[i + 1];
      const L = this.lengths[i];
      const start = i === prog.i ? prog.t * L : 0;
      const angle = Math.atan2(b.x - a.x, b.z - a.z);
      this.q.setFromAxisAngle(this.up, angle);
      for (let d = start + offset; d < L && n < 400; d += spacing) {
        const k = d / L;
        this.m.compose(new THREE.Vector3(a.x + (b.x - a.x) * k, 0.42, a.z + (b.z - a.z) * k), this.q, new THREE.Vector3(1, 1, 1));
        this.arrows.setMatrixAt(n++, this.m);
      }
      offset = (offset + spacing - ((L - start) % spacing)) % spacing;
    }
    this.arrows.count = n;
    this.arrows.instanceMatrix.needsUpdate = true;
  }
}
