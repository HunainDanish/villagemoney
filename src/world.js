import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  BLOCK_SIDE, HOUSES_PER_BLOCK, LOT, PITCH, PLOT,
  blockGrid, blockOfHouse, blocksNear, housePosition, worldToGrid, gridToBlock,
} from '../shared/layout.js';
import { loadBlock } from './api.js';

// Rendering strategy for a big town:
// - Only blocks within LOAD_RADIUS of the player are kept in memory.
// - All houses are drawn with a handful of InstancedMeshes (one draw call per
//   house part), so 1,600 houses cost about the same as 1.
// - Fog hides the edge, and blocks are fetched lazily from the CDN-cached API.

const LOAD_RADIUS = 2; // 5x5 blocks = up to 1,600 houses
const CAPACITY = (2 * LOAD_RADIUS + 1) ** 2 * HOUSES_PER_BLOCK;
const HOUSE_HALF = 3.2; // collision half-size

const COLORS = {
  sky: 0xbfe3ff,
  road: 0x8d8f99,
  grass: 0x9fd77f,
  plaza: 0xe9dcc4,
  trim: 0x4a3b33,
};
const WALLS = [0xf6e7d0, 0xf2c6b4, 0xcfe5f2, 0xfff1a8, 0xd9f0c9, 0xe8d5f5, 0xfad2d2, 0xffffff];
const ROOFS = [0xc0504d, 0x4f6d9a, 0x5b8c5a, 0x8a5a44, 0x3e3e4a, 0xd98c3f, 0x7b5ea7];

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

export class World {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(COLORS.sky);
    this.scene.fog = new THREE.Fog(COLORS.sky, 140, 300);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.5, 600);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x88aa77, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(60, 100, 40);
    this.scene.add(sun);

    this.totalHouses = 0;
    this.blocks = new Map(); // block number -> houses[] (null while loading)
    this.houses = new Map(); // house id -> { id, u }
    this.visible = []; // houses currently drawn, index = instance id
    this.dirty = false;

    this.#buildGround();
    this.#buildPlaza();
    this.#buildHouseMeshes();
    this.#buildMarker();
    this.raycaster = new THREE.Raycaster();
    this.resize();
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  #buildGround() {
    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(1200, 1200).rotateX(-Math.PI / 2),
      new THREE.MeshLambertMaterial({ color: COLORS.road }),
    );
    this.scene.add(this.ground);
    this.lots = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(LOT + 4, LOT + 4).rotateX(-Math.PI / 2),
      new THREE.MeshLambertMaterial({ color: COLORS.grass }),
      (2 * LOAD_RADIUS + 1) ** 2,
    );
    this.lots.position.y = 0.05;
    this.lots.count = 0;
    this.lots.frustumCulled = false; // its bounds change as blocks load
    this.scene.add(this.lots);
  }

  #buildPlaza() {
    const g = new THREE.Group();
    const stone = new THREE.MeshLambertMaterial({ color: COLORS.plaza });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(LOT + 4, LOT + 4).rotateX(-Math.PI / 2), stone);
    floor.position.y = 0.05;
    g.add(floor);
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(9, 10, 1.6, 32), new THREE.MeshLambertMaterial({ color: 0xcfc3ad }));
    basin.position.y = 0.8;
    const water = new THREE.Mesh(new THREE.CylinderGeometry(8.2, 8.2, 0.2, 32), new THREE.MeshLambertMaterial({ color: 0x6cc4f0 }));
    water.position.y = 1.5;
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.4, 7, 16), stone);
    pillar.position.y = 3.5;
    this.lamp = new THREE.Mesh(new THREE.SphereGeometry(1.6, 24, 16), new THREE.MeshBasicMaterial({ color: 0xffd36b }));
    this.lamp.position.y = 8;
    g.add(basin, water, pillar, this.lamp);
    // Trees around the plaza edge.
    const trunk = new THREE.CylinderGeometry(0.5, 0.7, 3, 8).translate(0, 1.5, 0);
    const crown = new THREE.IcosahedronGeometry(3, 0).translate(0, 5, 0);
    const tree = mergeGeometries([trunk.toNonIndexed(), crown.toNonIndexed()], true);
    const trees = new THREE.InstancedMesh(tree, [new THREE.MeshLambertMaterial({ color: 0x7a5233 }), new THREE.MeshLambertMaterial({ color: 0x4f9a4a, flatShading: true })], 24);
    const m = new THREE.Matrix4();
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const r = 36 + (i % 2) * 6;
      m.makeTranslation(Math.cos(a) * r, 0, Math.sin(a) * r);
      trees.setMatrixAt(i, m);
    }
    g.add(trees);
    this.scene.add(g);
  }

  #buildHouseMeshes() {
    const body = new THREE.BoxGeometry(6, 4, 6).translate(0, 2, 0);
    const roof = new THREE.ConeGeometry(5, 3, 4).rotateY(Math.PI / 4).translate(0, 5.5, 0);
    const door = new THREE.BoxGeometry(1.4, 2.4, 0.2).translate(0, 1.2, 3.05);
    const winL = new THREE.BoxGeometry(1.1, 1.1, 0.2).translate(-1.9, 2.6, 3.05);
    const winR = new THREE.BoxGeometry(1.1, 1.1, 0.2).translate(1.9, 2.6, 3.05);
    const chimney = new THREE.BoxGeometry(0.9, 2, 0.9).translate(1.6, 6, -1);
    const trim = mergeGeometries([door, winL, winR, chimney]);

    const make = (geo, mat) => {
      const mesh = new THREE.InstancedMesh(geo, mat, CAPACITY);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.frustumCulled = false; // instances span the whole loaded area
      this.scene.add(mesh);
      return mesh;
    };
    this.bodyMesh = make(body, new THREE.MeshLambertMaterial());
    this.roofMesh = make(roof, new THREE.MeshLambertMaterial({ flatShading: true }));
    this.trimMesh = make(trim, new THREE.MeshLambertMaterial({ color: COLORS.trim }));
    // Instance colors need an initial buffer.
    this.bodyMesh.setColorAt(0, new THREE.Color());
    this.roofMesh.setColorAt(0, new THREE.Color());
  }

  #buildMarker() {
    this.marker = new THREE.Mesh(
      new THREE.ConeGeometry(1.2, 2.4, 4).rotateX(Math.PI),
      new THREE.MeshBasicMaterial({ color: 0xffb800 }),
    );
    this.marker.visible = false;
    this.scene.add(this.marker);
  }

  setTotal(n) {
    if (n !== this.totalHouses) {
      this.totalHouses = n;
      this.lastCenter = null; // force a refresh of the nearby block list
    }
  }

  // Called every frame with the player's position; loads/unloads blocks.
  update(px, pz, t) {
    this.ground.position.set(Math.round(px / PITCH) * PITCH, 0, Math.round(pz / PITCH) * PITCH);
    this.lamp.material.color.setHSL(0.12, 1, 0.6 + Math.sin(t * 2) * 0.1);
    if (this.marker.visible) this.marker.position.y = 11 + Math.sin(t * 3) * 0.6;

    const [gx, gz] = worldToGrid(px, pz);
    const key = `${gx},${gz}`;
    if (key !== this.lastCenter) {
      this.lastCenter = key;
      const wanted = new Set(blocksNear(px, pz, LOAD_RADIUS, this.totalHouses));
      for (const b of this.blocks.keys()) {
        if (!wanted.has(b)) {
          for (const h of this.blocks.get(b) || []) this.houses.delete(h.id);
          this.blocks.delete(b);
          this.dirty = true;
        }
      }
      for (const b of wanted) if (!this.blocks.has(b)) this.#fetchBlock(b);
    }
    if (this.dirty) this.#rebuild();
  }

  async #fetchBlock(b) {
    this.blocks.set(b, null);
    try {
      const { houses } = await loadBlock(b);
      if (!this.blocks.has(b)) return; // unloaded while fetching
      this.blocks.set(b, houses);
      for (const h of houses) this.houses.set(h.id, h);
      this.dirty = true;
    } catch {
      this.blocks.delete(b); // retry on the next move
      this.lastCenter = null;
    }
  }

  // Re-fetch one block (e.g. after the player hides their name).
  refreshBlock(b) {
    if (!this.blocks.has(b)) return;
    for (const h of this.blocks.get(b) || []) this.houses.delete(h.id);
    this.#fetchBlock(b);
  }

  #rebuild() {
    this.dirty = false;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    const up = new THREE.Vector3(0, 1, 0);
    const c = new THREE.Color();
    this.visible = [];
    let lots = 0;
    for (const [b, houses] of this.blocks) {
      const [gx, gz] = blockGrid(b);
      m.makeTranslation(gx * PITCH, 0, gz * PITCH);
      this.lots.setMatrixAt(lots++, m);
      for (const h of houses || []) {
        if (this.visible.length >= CAPACITY) break;
        const p = housePosition(h.id);
        const i = this.visible.length;
        q.setFromAxisAngle(up, p.facing);
        m.compose(new THREE.Vector3(p.x, 0, p.z), q, one);
        this.bodyMesh.setMatrixAt(i, m);
        this.roofMesh.setMatrixAt(i, m);
        this.trimMesh.setMatrixAt(i, m);
        const seed = hash(h.u || `#${h.id}`);
        this.bodyMesh.setColorAt(i, c.setHex(WALLS[seed % WALLS.length]));
        this.roofMesh.setColorAt(i, c.setHex(ROOFS[(seed >>> 8) % ROOFS.length]));
        this.visible.push({ ...h, x: p.x, z: p.z });
      }
    }
    this.lots.count = lots;
    this.lots.instanceMatrix.needsUpdate = true;
    for (const mesh of [this.bodyMesh, this.roofMesh, this.trimMesh]) {
      mesh.count = this.visible.length;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }

  // Is the point (x, z) inside a house? Used for simple collision.
  blocked(x, z) {
    const [gx, gz] = worldToGrid(x, z);
    const b = gridToBlock(gx, gz);
    if (b < 0) return Math.hypot(x - gx * PITCH, z - gz * PITCH) < 10.5; // fountain
    const lx = x - gx * PITCH;
    const lz = z - gz * PITCH;
    const half = LOT / 2;
    if (Math.abs(lx) > half || Math.abs(lz) > half) return false; // on a road
    const sx = Math.round(lx / PLOT + (BLOCK_SIDE - 1) / 2);
    const sz = Math.round(lz / PLOT + (BLOCK_SIDE - 1) / 2);
    if (sx < 0 || sz < 0 || sx >= BLOCK_SIDE || sz >= BLOCK_SIDE) return false;
    const id = b * HOUSES_PER_BLOCK + sz * BLOCK_SIDE + sx + 1;
    if (!this.houses.has(id)) return false;
    const cx = (sx - (BLOCK_SIDE - 1) / 2) * PLOT;
    const cz = (sz - (BLOCK_SIDE - 1) / 2) * PLOT;
    return Math.abs(lx - cx) < HOUSE_HALF && Math.abs(lz - cz) < HOUSE_HALF;
  }

  // Screen point -> { house } or { ground: {x, z} }.
  pick(ndcX, ndcY) {
    this.raycaster.setFromCamera({ x: ndcX, y: ndcY }, this.camera);
    const hits = this.raycaster.intersectObjects([this.bodyMesh, this.roofMesh], false);
    if (hits.length && hits[0].instanceId !== undefined) return { house: this.visible[hits[0].instanceId] };
    const ray = this.raycaster.ray;
    if (ray.direction.y >= 0) return null;
    const t = -ray.origin.y / ray.direction.y;
    return { ground: { x: ray.origin.x + ray.direction.x * t, z: ray.origin.z + ray.direction.z * t } };
  }

  showMarker(id) {
    if (!id) {
      this.marker.visible = false;
      return;
    }
    const p = housePosition(id);
    this.marker.position.set(p.x, 11, p.z);
    this.marker.visible = true;
  }

  // Nearest houses to (x, z), for name labels.
  nearest(x, z, maxDist, limit) {
    const out = [];
    const d2 = maxDist * maxDist;
    for (const h of this.visible) {
      const d = (h.x - x) ** 2 + (h.z - z) ** 2;
      if (d < d2) out.push([d, h]);
    }
    out.sort((a, b) => a[0] - b[0]);
    return out.slice(0, limit).map((e) => e[1]);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}

export { blockOfHouse };
