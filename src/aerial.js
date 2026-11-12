import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { LOT, PITCH, blockGrid, blockOfHouse, firstHouseOfBlock, lastHouseOfBlock, housePosition, gridToBlock } from '../shared/layout.js';
import { plotNodes } from '../shared/nodes.js';

// Aerial view of the whole town (🛩️ City). Up close only the blocks round you
// are loaded in full detail; from the air, every other block is drawn as a
// light "model village": one box-and-roof per house, a tree per garden, the
// block's pad and coloured band, and the woods all round the edge. It's all
// worked out from the house numbers, so it needs nothing from the server.

const ROOFS = [0xd9534f, 0x3f7fd0, 0x3c9a5f, 0xe8893a, 0x8e5bc4, 0x4f5d6e, 0xc9a227, 0x2e8c8c];
const WALLS = [0xf3ede2, 0xe8dcc8, 0xdfe6ea, 0xf1e3d3, 0xe6e1d6];

function hash(n) {
  const h = Math.imul(n ^ 0x5bd1e995, 2654435761) >>> 0;
  return (h ^ (h >>> 13)) >>> 0;
}

function colored(geo, hex) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(hex);
  const arr = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < arr.length; i += 3) arr.set([c.r, c.g, c.b], i);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  g.deleteAttribute('uv');
  return g;
}

// Size and middle of the built town, in world units.
export function townBounds(total) {
  let x0 = -1, x1 = 1, z0 = -1, z1 = 2; // the centre strip and both districts
  const last = total > 0 ? blockOfHouse(total) : -1;
  for (let b = 0; b <= last; b++) {
    const [gx, gz] = blockGrid(b);
    x0 = Math.min(x0, gx); x1 = Math.max(x1, gx);
    z0 = Math.min(z0, gz); z1 = Math.max(z1, gz);
  }
  const x = ((x0 + x1) / 2) * PITCH;
  const z = ((z0 + z1) / 2) * PITCH;
  const r = (Math.hypot(x1 - x0 + 1, z1 - z0 + 1) / 2) * PITCH;
  return { x, z, r, x0, x1, z0, z1 };
}

export class CityModel {
  constructor(scene, bandColor, roadTex) {
    this.scene = scene;
    this.roadTex = roadTex.clone();
    // From the air the street grid stops at the town's edge: beyond it is
    // open country (green, fading into the haze) and the woods.
    this.country = new THREE.Mesh(new THREE.CircleGeometry(30000, 48).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x5f9c48 }));
    this.country.position.y = -0.6;
    this.country.receiveShadow = true;
    this.roads = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ map: this.roadTex }));
    this.roads.receiveShadow = true;
    this.bandColor = bandColor;
    this.group = new THREE.Group();
    this.group.visible = false;
    this.group.add(this.country, this.roads);
    scene.add(this.group);
    this.cap = 0;
    this.c = new THREE.Color();

    const pad = mergeGeometries([
      colored(new THREE.BoxGeometry(LOT + 8, 0.3, LOT + 8).translate(0, 0.15, 0), 0xece4d4),
      colored(new THREE.BoxGeometry(LOT + 1, 0.06, LOT + 1).translate(0, 0.33, 0), 0x7cc65a),
    ]);
    const e = LOT / 2 + 3.2;
    const band = mergeGeometries([-1, 1].flatMap((s) => [
      new THREE.BoxGeometry(LOT + 7.6, 0.16, 1.4).translate(0, 0.38, s * e),
      new THREE.BoxGeometry(1.4, 0.16, LOT + 7.6).translate(s * e, 0.38, 0),
    ]));
    this.padGeo = pad;
    this.bandGeo = band;
    this.wallGeo = new THREE.BoxGeometry(7, 5, 6.5).translate(0, 2.8, 0);
    this.roofGeo = new THREE.ConeGeometry(5.6, 3.4, 4).rotateY(Math.PI / 4).scale(1, 1, 0.93).translate(0, 7, 0);
    this.treeGeo = mergeGeometries([
      colored(new THREE.CylinderGeometry(0.3, 0.45, 2, 5).translate(0, 1.3, 0), 0x6b4429),
      colored(new THREE.IcosahedronGeometry(2.1, 0).translate(0, 3.8, 0), 0x56a646),
    ]);
    this.firGeo = mergeGeometries([
      colored(new THREE.CylinderGeometry(0.3, 0.45, 2, 5).translate(0, 1, 0), 0x5e3c24),
      colored(new THREE.ConeGeometry(2.3, 5.5, 6).translate(0, 4.2, 0), 0x2f7347),
    ]);
    this.floorGeo = mergeGeometries([
      colored(new THREE.BoxGeometry(PITCH, 0.3, PITCH).translate(0, 0.15, 0), 0x4f8f3e),
    ]);
  }

  #mesh(geo, mat, n) {
    const m = new THREE.InstancedMesh(geo, mat, Math.max(1, n));
    m.frustumCulled = false;
    m.count = 0;
    m.receiveShadow = true;
    this.group.add(m);
    return m;
  }

  // (Re)make the instanced meshes when the town outgrows them.
  #ensure(houses, blocks, wild) {
    const need = { houses, blocks, wild };
    if (this.meshes && houses <= this.cap.houses && blocks <= this.cap.blocks && wild <= this.cap.wild) return;
    if (this.meshes) for (const m of Object.values(this.meshes)) { this.group.remove(m); m.dispose(); }
    this.cap = { houses: Math.ceil(need.houses * 1.3) + 64, blocks: need.blocks + 16, wild: need.wild + 32 };
    const lam = (o = {}) => new THREE.MeshLambertMaterial(o);
    this.meshes = {
      pads: this.#mesh(this.padGeo, lam({ vertexColors: true }), this.cap.blocks),
      bands: this.#mesh(this.bandGeo, lam(), this.cap.blocks),
      walls: this.#mesh(this.wallGeo, lam(), this.cap.houses),
      roofs: this.#mesh(this.roofGeo, lam({ flatShading: true }), this.cap.houses),
      trees: this.#mesh(this.treeGeo, lam({ vertexColors: true, flatShading: true }), this.cap.houses),
      floors: this.#mesh(this.floorGeo, lam({ vertexColors: true }), this.cap.wild),
      firs: this.#mesh(this.firGeo, lam({ vertexColors: true, flatShading: true }), this.cap.wild * 36),
    };
    for (const k of ['bands', 'walls', 'roofs', 'firs']) this.meshes[k].setColorAt(0, this.c);
  }

  // Draw everything the detailed world isn't showing right now.
  // skipBlock(b): that block is loaded in full detail. skipWild(gx, gz):
  // the near forest already covers that cell. cellTrees(gx, gz): its trees.
  build(total, { skipBlock, skipWild, cellTrees }) {
    const B = townBounds(total);
    const last = total > 0 ? blockOfHouse(total) : -1;
    const blocks = [];
    for (let b = 0; b <= last; b++) if (!skipBlock(b)) blocks.push(b);
    let houses = 0;
    for (const b of blocks) houses += Math.min(lastHouseOfBlock(b), total) - firstHouseOfBlock(b) + 1;
    const wildCells = [];
    const M = 3; // rings of woods round the edge
    for (let gx = B.x0 - M; gx <= B.x1 + M; gx++) {
      for (let gz = B.z0 - M; gz <= B.z1 + M; gz++) {
        if (gridToBlock(gx, gz) > last && !skipWild(gx, gz)) wildCells.push([gx, gz]);
      }
    }
    this.#ensure(houses, blocks.length, wildCells.length);
    // Streets under the built town only; tile edges land on road centres.
    const nx = B.x1 - B.x0 + 1;
    const nz = B.z1 - B.z0 + 1;
    this.roads.scale.set(nx * PITCH, 1, nz * PITCH);
    this.roads.position.set(B.x, 0, B.z);
    this.roadTex.repeat.set(nx, nz);
    this.roadTex.needsUpdate = true;
    const ms = this.meshes;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const s = new THREE.Vector3(1, 1, 1);
    const up = new THREE.Vector3(0, 1, 0);
    const n = { pads: 0, walls: 0, trees: 0, floors: 0, firs: 0 };
    for (const b of blocks) {
      const [gx, gz] = blockGrid(b);
      m.makeTranslation(gx * PITCH, 0, gz * PITCH);
      ms.pads.setMatrixAt(n.pads, m);
      ms.bands.setMatrixAt(n.pads, m);
      ms.bands.setColorAt(n.pads++, this.c.setHex(this.bandColor(b)));
      const top = Math.min(lastHouseOfBlock(b), total);
      for (let id = firstHouseOfBlock(b); id <= top; id++) {
        const p = housePosition(id);
        const h = hash(id);
        m.compose(v.set(p.x, 0.3, p.z), q.setFromAxisAngle(up, p.facing), s.set(1, 0.9 + (h % 5) * 0.08, 1));
        ms.walls.setMatrixAt(n.walls, m);
        ms.roofs.setMatrixAt(n.walls, m);
        ms.walls.setColorAt(n.walls, this.c.setHex(WALLS[(h >>> 4) % WALLS.length]));
        ms.roofs.setColorAt(n.walls++, this.c.setHex(ROOFS[(h >>> 8) % ROOFS.length]));
        const tree = plotNodes(id).find((nd) => nd.kind === 'tree');
        if (tree) {
          m.compose(v.set(tree.x, 0.3, tree.z), q.identity(), s.setScalar(tree.s));
          ms.trees.setMatrixAt(n.trees++, m);
        }
      }
    }
    for (const [gx, gz] of wildCells) {
      ms.floors.setMatrixAt(n.floors++, m.makeTranslation(gx * PITCH, 0, gz * PITCH));
      const list = cellTrees(gx, gz);
      for (let i = 0; i < list.length && i < 36 * 4; i += 4) {
        const t = list[i];
        m.compose(v.set(t.x, 0.3, t.z), q.setFromAxisAngle(up, t.rot), s.setScalar(t.s * 1.4));
        ms.firs.setMatrixAt(n.firs, m);
        ms.firs.setColorAt(n.firs++, this.c.setScalar(t.tint));
      }
    }
    ms.pads.count = ms.bands.count = n.pads;
    ms.walls.count = ms.roofs.count = n.walls;
    ms.trees.count = n.trees;
    ms.floors.count = n.floors;
    ms.firs.count = n.firs;
    for (const mesh of Object.values(ms)) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    return B;
  }
}
