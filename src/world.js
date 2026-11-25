import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  BLOCK_SIDE, HOUSES_PER_BLOCK, LOT, PITCH, PLOT,
  blockGrid, blocksNear, housePosition, worldToGrid, gridToBlock, firstHouseOfBlock, lastHouseOfBlock, houseAt, blockOfHouse,
} from '../shared/layout.js';
import { plotNodes, plazaNodes, NODE_KINDS, YARD_SLOTS, toWorld, PLAZA } from '../shared/nodes.js';
import { WALL_PAINTS, ROOF_PAINTS } from '../shared/game.js';
import * as M from './models.js';
import { houseModels, modelFor } from './houses.js';
import * as Props from './props.js';
import { CROPS, CARS } from '../shared/life.js';
import { cropReadyAt } from '../shared/game.js';
import { GAME } from '../shared/features.js';
import { buildVenues } from './venues.js';
import { buildInterior, INTERIOR_ORIGIN } from './interior.js';
import { VENUES } from '../shared/nodes.js';
import { lookFor, colorOf } from '../shared/style.js';
import { Sky } from './sky.js';
import { loadBlock } from './api.js';
import { buildCentre } from './centre.js';
import { Forest } from './forest.js';
import { CityModel, townBounds } from './aerial.js';

// Rendering strategy for a big town:
// - Only blocks within LOAD_RADIUS of the player are kept in memory.
// - Everything repeated (houses, trees, props, decor) is an InstancedMesh with
//   vertex-coloured geometry: one draw call per model, however many houses.
// - Fog hides the edge; blocks are fetched lazily from the CDN-cached API.

const LOAD_RADIUS = 2; // 5x5 blocks = up to 1,600 houses
const BLOCKS = (2 * LOAD_RADIUS + 1) ** 2;
const CAPACITY = BLOCKS * HOUSES_PER_BLOCK;
const MOBILE = matchMedia('(pointer: coarse)').matches;

const DAY_GLASS = new THREE.Color(0x58708c);
// Unpainted houses: muted colours that are NOT in the shop palette.
const DEFAULT_WALLS = [0xeee6d8, 0xe3d5c0, 0xdfe3e6, 0xe9dccf, 0xd8cfc4, 0xf2ede4];
const DEFAULT_ROOFS = [0x6e5a4e, 0x5d6168, 0x7a4e3f, 0x55604f, 0x6b5f57];
const NIGHT_GLASS = new THREE.Color(0x1d2433);
const WARM = new THREE.Color(0xffc56b);

function hash(n) {
  let h = Math.imul(n ^ 0x27d4eb2d, 2654435761) >>> 0;
  return (h ^ (h >>> 15)) >>> 0;
}

function roadTexture() {
  const s = 512;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  g.fillStyle = '#7d808a';
  g.fillRect(0, 0, s, s);
  for (let i = 0; i < 9000; i++) {
    const v = 110 + Math.random() * 40;
    g.fillStyle = `rgba(${v},${v},${v + 6},0.35)`;
    g.fillRect(Math.random() * s, Math.random() * s, 2, 2);
  }
  // Thin dashed centre lines along the tile edges (= road centres).
  g.fillStyle = '#f3e7b0';
  for (let i = 0; i < 12; i++) {
    const a = i * (s / 12) + 10;
    const len = s / 24;
    g.fillRect(a, 0, len, 2);
    g.fillRect(a, s - 2, len, 2);
    g.fillRect(0, a, 2, len);
    g.fillRect(s - 2, a, 2, len);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// Property-band colours: the West District's blocks, the East District's,
// the middle strip (gold), and further out a repeating set.
const WEST_BANDS = [0x955436, 0x7cc8f0, 0xd93a96, 0xf7941d];
const EAST_BANDS = [0xed1b24, 0xf5d000, 0x1fb25a, 0x0072bb];
function bandColor(b) {
  if (b < 0) return 0xf2c94c;
  if (b < 4) return WEST_BANDS[b];
  if (b < 8) return EAST_BANDS[b - 4];
  return [...WEST_BANDS, ...EAST_BANDS][b % 8];
}

const HOUSE_PARTS = ['walls', 'roof', 'details', 'glass', 'trim', 'door', 'shutter'];
const vc = (opts = {}) => new THREE.MeshLambertMaterial({ vertexColors: true, ...opts });

export class World {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !MOBILE || devicePixelRatio < 2, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, MOBILE ? 1.5 : 2));
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.12; // vivid, diorama-style colours
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = MOBILE ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xcfe9ff, 150, 330);
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.5, 1100);
    this.sky = new Sky(this.scene, this.renderer);
    this.forest = new Forest(this.scene);
    this.aerial = null; // { x, z, r, d, scale } while viewing the whole town
    this.night = 0;

    this.totalHouses = 0;
    this.blocks = new Map(); // block -> houses[] (null while loading)
    this.houses = new Map(); // id -> house
    this.overrides = new Map(); // id -> { d, p } for the signed-in player's own house
    this.drawn = []; // per style: houses drawn (index = instance id)
    this.nodes = []; // nodes currently drawn
    this.nodeIndex = new Map(); // node id -> { mesh, i, node }
    this.isReady = () => true; // set by the game: is a node harvestable?
    this.wobbles = new Map(); // node id -> start time
    this.falling = [];
    this.dirtyHouses = false;
    this.dirtyNodes = false;

    this.#buildGround();
    this.city = new CityModel(this.scene, bandColor, this.ground.material.map);
    this.#buildHouseMeshes();
    this.#buildNodeMeshes();
    this.#buildProps();
    this.#buildPlaza();
    this.#buildAmbient();
    this.#buildMarker();
    this.raycaster = new THREE.Raycaster();
    this.resize();
  }

  resize() {
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }

  #instanced(geo, mat, count, { cast = false, receive = false } = {}) {
    const m = new THREE.InstancedMesh(geo, mat, count);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.count = 0;
    m.frustumCulled = false;
    m.castShadow = cast;
    m.receiveShadow = receive;
    this.scene.add(m);
    return m;
  }

  // ---------- ground ----------
  #buildGround() {
    const tex = roadTexture();
    // An odd number of pitches, centred on a block centre, so tile edges fall
    // on road centres. Wide enough to fill the aerial view of the whole town.
    const size = PITCH * 41;
    tex.repeat.set(41, 41);
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ map: tex }));
    this.ground.receiveShadow = true;
    // The plane spans 9 pitches centred on a block centre, so its tile edges
    // already fall on road centres, which is where the dashes are painted.
    this.scene.add(this.ground);

    const CELLS = BLOCKS + 4; // + the centre's plaza, parks and villa lot
    this.sidewalks = this.#instanced(new THREE.BoxGeometry(LOT + 8, 0.3, LOT + 8).translate(0, 0.15, 0), new THREE.MeshLambertMaterial({ color: 0xece4d4 }), CELLS, { receive: true });
    this.lots = this.#instanced(M.lotGeometry(LOT + 1), vc(), CELLS, { receive: true });
    this.lots.position.y = 0.32;
    this.tufts = this.#instanced(M.grassTuftGeometry(), vc(), CELLS * 40);
    // Board-game look: every block has a coloured property band round its
    // edge (each district its own set of colours, like a game board).
    const band = [];
    const e = LOT / 2 + 3.2;
    for (const s of [-1, 1]) {
      band.push(new THREE.BoxGeometry(LOT + 7.6, 0.16, 1.4).translate(0, 0.38, s * e));
      band.push(new THREE.BoxGeometry(1.4, 0.16, LOT + 7.6).translate(s * e, 0.38, 0));
    }
    this.bands = this.#instanced(mergeGeometries(band), new THREE.MeshLambertMaterial(), CELLS, { receive: true });
    this.bands.setColorAt(0, new THREE.Color());
    this.tufts.position.y = 0.3;
  }

  // ---------- houses ----------
  #buildHouseMeshes() {
    this.styles = [];
    this.models = houseModels();
    for (const g of this.models) {
      const castWalls = !MOBILE;
      const st = {
        meta: g.meta,
        walls: this.#instanced(g.walls, vc(), CAPACITY, { cast: castWalls, receive: true }),
        roof: this.#instanced(g.roof, vc({ flatShading: true }), CAPACITY, { cast: castWalls }),
        details: this.#instanced(g.details, vc(), CAPACITY),
        glass: this.#instanced(g.glass, new THREE.MeshBasicMaterial({ vertexColors: true }), CAPACITY),
        // Paintable parts: every house tints these with its own colours.
        trim: this.#instanced(g.trim, vc(), CAPACITY),
        door: this.#instanced(g.door, vc(), CAPACITY),
        shutter: this.#instanced(g.shutter, vc(), CAPACITY),
        list: [],
      };
      for (const k of HOUSE_PARTS) st[k].position.y = 0.3;
      for (const k of ['walls', 'roof', 'glass', 'trim', 'door', 'shutter']) st[k].setColorAt(0, new THREE.Color());
      this.styles.push(st);
    }
    this.yards = this.#instanced(M.yardGeometry(), vc(), CAPACITY, { receive: true });
    this.yards.position.y = 0.3;
    this.porch = this.#instanced(new THREE.SphereGeometry(0.22, 8, 6), new THREE.MeshBasicMaterial(), CAPACITY);
    this.porch.setColorAt(0, new THREE.Color());
    this.porchGlow = this.#instanced(
      new THREE.CircleGeometry(1.4, 16),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }),
      CAPACITY,
    );
    this.porchGlow.setColorAt(0, new THREE.Color());
    // Decor items placed in yards.
    this.decorMeshes = {
      fence: this.#instanced(fenceGeometry(), vc(), CAPACITY, { cast: true }),
      planter: this.#instanced(planterGeometry(), vc(), CAPACITY, { cast: true }),
      bench: this.#instanced(M.benchGeometry(), vc(), CAPACITY, { cast: true }),
      lantern: this.#instanced(lanternGeometry(), vc(), CAPACITY, { cast: true }),
      birdhouse: this.#instanced(birdhouseGeometry(), vc(), CAPACITY, { cast: true }),
      gnome: this.#instanced(gnomeGeometry(), vc(), CAPACITY, { cast: true }),
    };
    for (const m of Object.values(this.decorMeshes)) m.position.y = 0.3;

    // Town-life props: garden beds and crops, kennels, alarm bells, raid
    // flags and parked cars. One instanced mesh each.
    const BEDS = CAPACITY * Props.BED_SPOTS.length;
    this.beds = this.#instanced(Props.bedGeometry(), vc(), BEDS, { receive: true });
    this.plants = this.#instanced(Props.plantGeometry(), vc({ flatShading: true }), BEDS);
    this.fruits = this.#instanced(Props.fruitGeometry(), vc(), BEDS);
    this.fruits.setColorAt(0, new THREE.Color());
    this.kennels = this.#instanced(Props.kennelGeometry(), vc({ flatShading: true }), CAPACITY, { cast: true });
    this.bells = this.#instanced(Props.bellGeometry(), vc(), CAPACITY);
    this.flags = this.#instanced(Props.flagGeometry(), vc({ side: THREE.DoubleSide }), CAPACITY);
    this.flags.setColorAt(0, new THREE.Color());
    this.parked = {};
    for (const model of Object.keys(CARS)) {
      const mesh = this.#instanced(Props.carGeometry(model), vc(), CAPACITY, { cast: true });
      mesh.setColorAt(0, new THREE.Color());
      this.parked[model] = mesh;
    }
    for (const m of [this.beds, this.plants, this.fruits, this.kennels, this.bells, this.flags, ...Object.values(this.parked)]) m.position.y = 0.3;
    this.hiddenCar = null; // your own parked car is hidden while you drive it
    // Crops grow in real time: redraw garden stages every 20 s.
    setInterval(() => (this.dirtyHouses = true), 20000);
  }

  // ---------- resource nodes ----------
  #buildNodeMeshes() {
    const cap = CAPACITY * 2;
    this.nodeMeshes = {
      oak: this.#instanced(M.oakGeometry(), vc({ flatShading: true }), cap, { cast: true }),
      pine: this.#instanced(M.pineGeometry(), vc({ flatShading: true }), cap, { cast: true }),
      stump: this.#instanced(M.stumpGeometry(), vc(), cap, { cast: true }),
      rock: this.#instanced(M.rockGeometry(), vc({ flatShading: true }), cap, { cast: true }),
      rubble: this.#instanced(M.rubbleGeometry(), vc({ flatShading: true }), cap),
      flower: this.#instanced(M.flowerGeometry(), vc(), cap),
      sprout: this.#instanced(M.grassTuftGeometry(), vc(), cap),
      berry: this.#instanced(M.berryGeometry(), vc({ flatShading: true }), cap, { cast: true }),
      bush: this.#instanced(M.bushGeometry(), vc({ flatShading: true }), cap, { cast: true }),
    };
    for (const m of Object.values(this.nodeMeshes)) {
      m.position.y = 0.3;
      m.setColorAt(0, new THREE.Color());
    }
    // "Ready" sparkle markers over harvestable nodes near the player.
    this.readyMarks = this.#instanced(new THREE.OctahedronGeometry(0.22), new THREE.MeshBasicMaterial({ color: 0xfff3b0 }), 64);
  }

  // ---------- street props ----------
  #buildProps() {
    this.lamps = this.#instanced(M.lampGeometry(), vc(), (BLOCKS + 4) * 4 + 16, { cast: true });
    this.lampBulbs = this.#instanced(M.lampBulbGeometry(), new THREE.MeshBasicMaterial({ color: 0xfff1c9 }), (BLOCKS + 4) * 4 + 16);
  }

  // ---------- plaza (block grid 0,0) ----------
  #buildPlaza() {
    const g = new THREE.Group();
    g.position.y = 0.3;
    const stone = new THREE.MeshLambertMaterial({ color: 0xe9dcc4 });
    const floor = new THREE.Mesh(new THREE.BoxGeometry(LOT + 1, 0.04, LOT + 1), stone);
    floor.receiveShadow = true;
    g.add(floor);
    // Concentric paving rings.
    [[30, 0xdccdb0], [24, 0xe9dcc4], [16, 0xd3c2a3]].forEach(([r, c], i) => {
      const ring = new THREE.Mesh(new THREE.CircleGeometry(r, 48).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: c }));
      ring.position.y = 0.03 + i * 0.005;
      ring.receiveShadow = true;
      g.add(ring);
    });

    // Fountain.
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(9, 10, 1.6, 32), new THREE.MeshLambertMaterial({ color: 0xcfc3ad }));
    basin.position.y = 0.8;
    basin.castShadow = basin.receiveShadow = true;
    this.fountainWater = new THREE.Mesh(new THREE.CylinderGeometry(8.3, 8.3, 0.2, 32), new THREE.MeshLambertMaterial({ color: 0x5bbbe8 }));
    this.fountainWater.position.y = 1.45;
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.4, 6, 12), new THREE.MeshLambertMaterial({ color: 0xcfc3ad }));
    pillar.position.y = 3.5;
    pillar.castShadow = true;
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(3, 1.2, 0.9, 16), new THREE.MeshLambertMaterial({ color: 0xcfc3ad }));
    bowl.position.y = 6.4;
    bowl.castShadow = true;
    this.lamp = new THREE.Mesh(new THREE.SphereGeometry(1.2, 20, 14), new THREE.MeshBasicMaterial({ color: 0xffd36b }));
    this.lamp.position.y = 8;
    g.add(basin, this.fountainWater, pillar, bowl, this.lamp);

    // Pond with dock (fishing).
    const P = PLAZA.pond;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(P.r, 0.9, 6, 28).rotateX(Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0xb9b2a5, flatShading: true }));
    rim.position.set(P.x, 0.2, P.z);
    rim.receiveShadow = true;
    this.pondWater = new THREE.Mesh(new THREE.CircleGeometry(P.r, 32).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x3f9fd0 }));
    this.pondWater.position.set(P.x, 0.12, P.z);
    const lily = new THREE.InstancedMesh(new THREE.CircleGeometry(0.9, 8).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x4f9a4a }), 6);
    for (let i = 0; i < 6; i++) {
      const a = i * 1.1;
      lily.setMatrixAt(i, new THREE.Matrix4().makeTranslation(P.x + Math.cos(a) * (3 + i), 0.18, P.z + Math.sin(a) * (2 + i * 0.8)));
    }
    const dock = new THREE.Mesh(new THREE.BoxGeometry(3, 0.3, 7), new THREE.MeshLambertMaterial({ color: 0x9a6b42 }));
    dock.position.set(P.x + 6, 0.45, P.z - 6);
    dock.rotation.y = Math.PI / 4;
    dock.castShadow = dock.receiveShadow = true;
    g.add(rim, this.pondWater, lily, dock);

    if (GAME) {
      // Workbench (crafting).
      const W = PLAZA.workbench;
      const bench = new THREE.Group();
      bench.position.set(W.x, 0, W.z);
      const top = new THREE.Mesh(new THREE.BoxGeometry(5, 0.4, 2.6), new THREE.MeshLambertMaterial({ color: 0xa8774a }));
      top.position.y = 1.9;
      for (const [x, z] of [[-2.2, -1], [2.2, -1], [-2.2, 1], [2.2, 1]]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.35, 1.8, 0.35), new THREE.MeshLambertMaterial({ color: 0x7a5233 }));
        leg.position.set(x, 0.9, z);
        leg.castShadow = true;
        bench.add(leg);
      }
      const saw = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.05, 0.5), new THREE.MeshLambertMaterial({ color: 0xb8bcc6 }));
      saw.position.set(-1, 2.15, 0.2);
      const logs = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 2.4, 8).rotateZ(Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x8a5a2b }));
      logs.position.set(1.2, 2.45, -0.3);
      top.castShadow = logs.castShadow = true;
      bench.add(top, saw, logs);
      g.add(bench);

      // Market stall (sell items, buy paint).
      const S = PLAZA.stall;
      const stall = new THREE.Group();
      stall.position.set(S.x, 0, S.z);
      const counter = new THREE.Mesh(new THREE.BoxGeometry(6, 1.8, 2.2), new THREE.MeshLambertMaterial({ color: 0xa8774a }));
      counter.position.y = 0.9;
      counter.castShadow = true;
      stall.add(counter);
      for (const x of [-2.8, 2.8]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 4.6, 0.3), new THREE.MeshLambertMaterial({ color: 0x7a5233 }));
        post.position.set(x, 2.3, -0.9);
        stall.add(post);
      }
      for (let i = 0; i < 6; i++) {
        const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.15, 3), new THREE.MeshLambertMaterial({ color: i % 2 ? 0xffffff : 0xe85d5d }));
        stripe.position.set(-2.75 + i * 1.1, 4.7, 0);
        stripe.rotation.x = 0.25;
        stripe.castShadow = true;
        stall.add(stripe);
      }
      const crates = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.9, 1.2), new THREE.MeshLambertMaterial({ color: 0xc9a27e }));
      crates.position.set(3.8, 0.45, 0.8);
      stall.add(crates);
      stall.rotation.y = -Math.PI / 4;
      g.add(stall);

      // Notice board (daily quests).
      const B = PLAZA.board;
      const board = new THREE.Group();
      board.position.set(B.x, 0, B.z);
      for (const x of [-1.8, 1.8]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 4, 0.3), new THREE.MeshLambertMaterial({ color: 0x7a5233 }));
        post.position.set(x, 2, 0);
        board.add(post);
      }
      const panel = new THREE.Mesh(new THREE.BoxGeometry(4.2, 2.4, 0.25), new THREE.MeshLambertMaterial({ color: 0xa8774a }));
      panel.position.y = 2.8;
      panel.castShadow = true;
      board.add(panel);
      [[-1.1, 3.2, 0xfff6d8], [0.6, 3.0, 0xffe1e1], [-0.2, 2.2, 0xe1f3ff], [1.3, 2.3, 0xfff6d8]].forEach(([x, y, c]) => {
        const paper = new THREE.Mesh(new THREE.BoxGeometry(1, 0.8, 0.05), new THREE.MeshLambertMaterial({ color: c }));
        paper.position.set(x, y, 0.15);
        paper.rotation.z = (x * 7) % 0.2;
        board.add(paper);
      });
      board.rotation.y = Math.PI / 4;
      g.add(board);
    }

    // Benches around the fountain.
    const benchGeo = M.benchGeometry();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      const b = new THREE.Mesh(benchGeo, vc());
      b.position.set(Math.cos(a) * 15, 0, Math.sin(a) * 15);
      b.rotation.y = -a - Math.PI / 2;
      b.castShadow = true;
      g.add(b);
    }
    if (GAME) {
      // Grocer: a market stall with crates of vegetables (seeds, milk, eggs, cheese).
      const G = PLAZA.grocer;
      const grocer = new THREE.Group();
      grocer.position.set(G.x, 0, G.z);
      const gc = new THREE.Mesh(new THREE.BoxGeometry(6, 1.6, 2.2), new THREE.MeshLambertMaterial({ color: 0x8fbf6a }));
      gc.position.y = 0.8;
      gc.castShadow = true;
      grocer.add(gc);
      for (const x of [-2.8, 2.8]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 4.4, 0.3), new THREE.MeshLambertMaterial({ color: 0x7a5233 }));
        post.position.set(x, 2.2, 0.9);
        grocer.add(post);
      }
      for (let i = 0; i < 6; i++) {
        const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.15, 3), new THREE.MeshLambertMaterial({ color: i % 2 ? 0xffffff : 0x3f9a5a }));
        stripe.position.set(-2.75 + i * 1.1, 4.5, 0);
        stripe.rotation.x = -0.25;
        stripe.castShadow = true;
        grocer.add(stripe);
      }
      [[0xf08a24, -1.8], [0xe03b2f, 0], [0xe6c35c, 1.8]].forEach(([col, x]) => {
        const crate = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.5, 1.2), new THREE.MeshLambertMaterial({ color: 0xa8774a }));
        crate.position.set(x, 1.85, 0);
        const veg = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 0).scale(1.2, 0.5, 1), new THREE.MeshLambertMaterial({ color: col, flatShading: true }));
        veg.position.set(x, 2.2, 0);
        grocer.add(crate, veg);
      });
      g.add(grocer);
    }

    // Car showroom: glass-fronted building with cars on display.
    const S2 = PLAZA.showroom;
    const show = new THREE.Group();
    show.position.set(S2.x, 0, S2.z);
    const floor2 = new THREE.Mesh(new THREE.BoxGeometry(S2.hw * 2, 0.3, S2.hd * 2), new THREE.MeshLambertMaterial({ color: 0xe9e4da }));
    floor2.position.y = 0.15;
    floor2.receiveShadow = true;
    const back = new THREE.Mesh(new THREE.BoxGeometry(S2.hw * 2, 5, 0.4), new THREE.MeshLambertMaterial({ color: 0xf2efe8 }));
    back.position.set(0, 2.5, S2.hd - 0.2);
    const roof2 = new THREE.Mesh(new THREE.BoxGeometry(S2.hw * 2 + 0.8, 0.5, S2.hd * 2 + 0.8), new THREE.MeshLambertMaterial({ color: 0x3a3f4a }));
    roof2.position.y = 5.25;
    roof2.castShadow = true;
    const glassMat = new THREE.MeshLambertMaterial({ color: 0x9fd6ff, transparent: true, opacity: 0.35 });
    const front = new THREE.Mesh(new THREE.BoxGeometry(S2.hw * 2, 4.6, 0.1), glassMat);
    front.position.set(0, 2.6, -S2.hd + 0.1);
    for (const x of [-S2.hw + 0.2, 0, S2.hw - 0.2]) {
      const col = new THREE.Mesh(new THREE.BoxGeometry(0.3, 5, 0.3), new THREE.MeshLambertMaterial({ color: 0x3a3f4a }));
      col.position.set(x, 2.5, -S2.hd + 0.15);
      show.add(col);
    }
    const sign = new THREE.Mesh(new THREE.BoxGeometry(6, 1, 0.3), new THREE.MeshBasicMaterial({ color: 0xe85d24 }));
    sign.position.set(0, 6.1, -S2.hd + 0.3);
    show.add(floor2, back, roof2, front, sign);
    ['hatch', 'sports', 'pickup'].forEach((model, i) => {
      const car = new THREE.Mesh(Props.carGeometry(model), new THREE.MeshLambertMaterial({ vertexColors: true, color: CARS[model].color }));
      car.position.set(-4 + i * 4, 0.3, 0.5);
      car.rotation.y = Math.PI + (i - 1) * 0.35;
      car.castShadow = true;
      show.add(car);
    });
    g.add(show);

    // Houses-only mode: places to hang out instead of the game stalls.
    if (!GAME) {
      this.venues = buildVenues();
      g.add(this.venues.group);
    }

    this.plaza = g;
    this.scene.add(g);
    // The middle strip: boulevard, parks, villas.
    this.centre = buildCentre();
    this.scene.add(this.centre.group);

    // Ripple rings for fountain + pond.
    this.ripples = new THREE.InstancedMesh(
      new THREE.RingGeometry(0.85, 1, 24).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false }),
      8,
    );
    this.ripples.frustumCulled = false;
    this.scene.add(this.ripples);
  }

  // ---------- smoke, fireflies, player lantern ----------
  #buildAmbient() {
    this.smoke = this.#instanced(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ color: 0xeeeeee, transparent: true, opacity: 0.6, flatShading: true }), 60);
    this.smokePuffs = Array.from({ length: 60 }, (_, i) => ({ t: (i / 60) * 3, src: i % 10 }));
    const n = 40;
    const pos = new Float32Array(n * 3);
    this.fireflyData = Array.from({ length: n }, () => ({ x: (Math.random() - 0.5) * 60, y: 1 + Math.random() * 3, z: (Math.random() - 0.5) * 60, p: Math.random() * 10 }));
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.fireflies = new THREE.Points(fg, new THREE.PointsMaterial({ color: 0xfff27a, size: 4, sizeAttenuation: false, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.fireflies.frustumCulled = false;
    this.scene.add(this.fireflies);
    this.lantern = new THREE.PointLight(0xffc56b, 0, 22, 1.6);
    this.scene.add(this.lantern);
  }

  #buildMarker() {
    this.marker = new THREE.Mesh(new THREE.ConeGeometry(1.2, 2.4, 4).rotateX(Math.PI), new THREE.MeshBasicMaterial({ color: 0xffb800 }));
    this.marker.visible = false;
    this.scene.add(this.marker);
  }

  // 🛩️ The whole town from the air (on) or back to street level (off).
  setAerial(on) {
    this.aerial = on ? {} : null;
    this.city.group.visible = on;
    this.ground.visible = !on; // the model village brings its own streets
    this.cityKey = null;
    this.scene.fog.near = 150;
    this.scene.fog.far = 330;
    this.camera.far = 1100;
    this.camera.updateProjectionMatrix();
  }

  // Where the aerial camera sits: far enough back to fit the whole town on
  // screen, whatever the screen's shape. Sky, fog and far plane grow to match.
  #aerialView() {
    if (!this.aerial) return null;
    const B = townBounds(this.totalHouses);
    const v = (45 * Math.PI) / 180;
    const h = 2 * Math.atan(Math.tan(v / 2) * this.camera.aspect);
    const d = (B.r * 0.92) / Math.sin(Math.min(v, h) / 2);
    const scale = Math.max(1, (d * 1.35) / 900);
    Object.assign(this.aerial, { x: B.x, z: B.z, r: B.r, d, scale });
    const far = Math.max(1100, 1100 * scale);
    if (this.camera.far !== far) {
      this.camera.far = far;
      this.camera.near = Math.max(0.5, d * 0.006); // depth precision from high up
      this.camera.updateProjectionMatrix();
    }
    this.scene.fog.near = d * 1.05;
    this.scene.fog.far = d * 2.1;
    return this.aerial;
  }

  // The model village: every block and wild cell the detailed world isn't
  // drawing round you right now.
  #rebuildCity(center) {
    const loaded = [...this.blocks.entries()].filter(([, v]) => v).map(([b]) => b).sort((a, b) => a - b);
    const key = `${this.totalHouses}|${loaded.join(',')}|${Math.round(center.x / PITCH)},${Math.round(center.z / PITCH)}`;
    if (key === this.cityKey) return;
    this.cityKey = key;
    const have = new Set(loaded);
    this.city.build(this.totalHouses, {
      skipBlock: (b) => have.has(b),
      skipWild: (gx, gz) => this.forest.covers(gx, gz, center),
      cellTrees: (gx, gz) => this.forest.cellTrees(gx, gz),
    });
  }

  setTotal(n) {
    if (n !== this.totalHouses) {
      this.totalHouses = n;
      this.lastCenter = null;
    }
  }

  // Signed-in player's own decor/paint, shown instantly (the CDN copy lags).
  setOverride(id, look) {
    if (look) this.overrides.set(id, look);
    else this.overrides.delete(id);
    this.dirtyHouses = true;
  }

  // ---------- per-frame ----------
  update(px, pz, t, dt) {
    const center = new THREE.Vector3(px, 0, pz);
    this.ground.position.set(Math.round(px / PITCH) * PITCH, 0, Math.round(pz / PITCH) * PITCH);
    const view = this.#aerialView();
    const day = this.sky.update(center, dt, view);
    this.forest.update(center, this.totalHouses, this.sky.horizon, day, view);
    const night = 1 - day;
    if (Math.abs(night - this.night) > 0.02 || this.dirtyGlow) {
      this.night = night;
      this.dirtyGlow = false;
      this.#applyNight();
    }
    this.lamp.material.color.setHSL(0.12, 1, 0.55 + Math.sin(t * 2) * 0.08);
    // Town goal: the golden fountain.
    this.fountainWater.material.color.setHex(this.goldFountain ? 0xf2c94c : 0x5bbbe8);
    if (this.marker.visible) this.marker.position.y = 12 + Math.sin(t * 3) * 0.6;
    this.lantern.position.set(px, 5, pz);
    this.lantern.intensity = night * 60;

    const [gx, gz] = worldToGrid(px, pz);
    const key = `${gx},${gz}`;
    if (key !== this.lastCenter) {
      this.lastCenter = key;
      const wanted = new Set(blocksNear(px, pz, LOAD_RADIUS, this.totalHouses));
      for (const b of this.blocks.keys()) {
        if (!wanted.has(b)) {
          for (const h of this.blocks.get(b) || []) this.houses.delete(h.id);
          this.blocks.delete(b);
          this.dirtyHouses = this.dirtyNodes = true;
        }
      }
      for (const b of wanted) if (!this.blocks.has(b)) this.#fetchBlock(b);
      this.center = { gx, gz };
      this.dirtyNodes = true;
    }
    if (this.dirtyHouses) this.#rebuildHouses();
    if (this.dirtyNodes) this.#rebuildNodes();
    if (view) this.#rebuildCity(center);
    this.#animate(t, dt, px, pz);
    this.venues?.update(t, dt, this.swingSeat);
  }

  async #fetchBlock(b) {
    this.blocks.set(b, null);
    try {
      const { houses } = await loadBlock(b);
      if (!this.blocks.has(b)) return;
      this.blocks.set(b, houses);
      for (const h of houses) this.houses.set(h.id, h);
      this.dirtyHouses = this.dirtyNodes = true;
    } catch {
      this.blocks.delete(b);
      this.lastCenter = null;
    }
  }

  refreshBlock(b) {
    if (!this.blocks.has(b)) return;
    for (const h of this.blocks.get(b) || []) this.houses.delete(h.id);
    this.#fetchBlock(b);
  }

  #rebuildHouses() {
    this.dirtyHouses = false;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    const up = new THREE.Vector3(0, 1, 0);
    const c = new THREE.Color();
    for (const st of this.styles) st.list = [];
    this.drawnAll = [];
    let lots = 0;
    let lamps = 0;
    let tufts = 0;
    let porch = 0;
    const decorCount = Object.fromEntries(Object.keys(this.decorMeshes).map((k) => [k, 0]));
    const lampAt = (x, z) => {
      m.makeTranslation(x, 0.3, z);
      this.lamps.setMatrixAt(lamps, m);
      this.lampBulbs.setMatrixAt(lamps++, m);
    };

    this.porchPos = [];
    this.bedRecs = [];
    const now = Date.now();
    let beds = 0;
    let plants = 0;
    let fruits = 0;
    let kennels = 0;
    let bells = 0;
    let flags = 0;
    const parkedCount = Object.fromEntries(Object.keys(this.parked).map((k) => [k, 0]));
    // Plaza lot is always present.
    const plazaBlocks = [[0, 0, true, -1], [0, -1, false, -3], [0, 1, false, -2], [0, 2, false, -3]];
    const blocks = [...plazaBlocks, ...[...this.blocks.keys()].map((b) => [...blockGrid(b), false, b])];
    for (const [gx, gz, isPlaza, bn] of blocks) {
      const cx = gx * PITCH;
      const cz = gz * PITCH;
      m.makeTranslation(cx, 0, cz);
      this.bands.setMatrixAt(lots, m);
      this.bands.setColorAt(lots, c.setHex(bandColor(bn)));
      this.sidewalks.setMatrixAt(lots++, m);
      const half = LOT / 2 + 2.5;
      lampAt(cx - half, cz - half);
      lampAt(cx + half, cz - half);
      lampAt(cx - half, cz + half);
      lampAt(cx + half, cz + half);
      if (isPlaza) continue;
      // Grass tufts, deterministic per block.
      let r = hash(gx * 7919 + gz * 104729);
      for (let i = 0; i < 40; i++) {
        r = hash(r + i);
        const x = cx + ((r % 1000) / 1000 - 0.5) * LOT;
        const z = cz + (((r >>> 10) % 1000) / 1000 - 0.5) * LOT;
        m.makeRotationY(r % 6).setPosition(x, 0, z);
        this.tufts.setMatrixAt(tufts++, m);
      }
    }
    // Plaza is drawn as its own group; don't put a grass lot over it.
    this.lots.count = 0;
    let li = 0;
    for (const [gx, gz, isPlaza] of blocks) {
      if (isPlaza) continue;
      m.makeTranslation(gx * PITCH, 0, gz * PITCH);
      this.lots.setMatrixAt(li++, m);
    }
    this.lots.count = li;
    this.sidewalks.count = this.bands.count = lots;
    this.bands.instanceMatrix.needsUpdate = true;
    if (this.bands.instanceColor) this.bands.instanceColor.needsUpdate = true;
    this.lamps.count = this.lampBulbs.count = lamps;
    this.tufts.count = tufts;

    for (const houses of this.blocks.values()) {
      for (const h0 of houses || []) {
        const full = this.overrides.has(h0.id) ? { ...h0, ...this.overrides.get(h0.id) } : h0;
        // Houses-only mode still shows upgrades (earned with house points).
        // Houses-only mode still shows upgrades and each house's own colours.
        const h = GAME ? full : { id: full.id, u: full.u, lit: full.lit, t: full.t, p: full.p, c: full.c, d: full.d };
        if (h.mv) continue; // moved in with someone: this plot stands empty
        const p = housePosition(h.id);
        const seed = hash(h.id);
        const look = lookFor(h.id, h.p); // unique default + the resident's choices
        const model = modelFor(h.id, h.t || 1, look.style);
        const st = this.styles[model];
        const meta = st.meta;
        const i = st.list.length;
        q.setFromAxisAngle(up, p.facing);
        m.compose(new THREE.Vector3(p.x, 0, p.z), q, one);
        st.walls.setMatrixAt(i, m);
        st.roof.setMatrixAt(i, m);
        st.details.setMatrixAt(i, m);
        st.glass.setMatrixAt(i, m);
        st.trim.setMatrixAt(i, m);
        st.door.setMatrixAt(i, m);
        st.shutter.setMatrixAt(i, m);
        st.trim.setColorAt(i, c.setHex(colorOf('trim', look.trim)));
        st.door.setColorAt(i, c.setHex(colorOf('door', look.door)));
        st.shutter.setColorAt(i, c.setHex(colorOf('shutter', look.shutter)));
        this.yards.setMatrixAt(this.drawnAll.length, m);
        const wall = h.p?.wall ?? null;
        const roof = h.p?.roof ?? null;
        st.walls.setColorAt(i, c.setHex(colorOf('wall', look.wall)));
        st.roof.setColorAt(i, c.setHex(colorOf('roof', look.roof)));
        void wall;
        void roof;
        // Porch light beside the door.
        const pl = toWorld(p, meta.porch[0], meta.porch[2]);
        m.makeTranslation(pl.x, meta.porch[1] + 0.3, pl.z);
        this.porch.setMatrixAt(porch++, m);
        this.porchPos.push(pl);
        // Yard decor.
        (h.d || []).forEach((item, slot) => {
          const mesh = this.decorMeshes[item];
          const slots = meta.slots || YARD_SLOTS;
          if (!mesh || slot >= slots.length) return;
          const w = toWorld(p, ...slots[slot]);
          q.setFromAxisAngle(up, p.facing);
          m.compose(new THREE.Vector3(w.x, 0, w.z), q, one);
          mesh.setMatrixAt(decorCount[item]++, m);
        });
        const at = (lx, lz) => {
          const w = toWorld(p, lx, lz);
          q.setFromAxisAngle(up, p.facing);
          return m.compose(new THREE.Vector3(w.x, 0, w.z), q, one);
        };
        const rec = { ...h, light: colorOf('light', look.light), x: p.x, z: p.z, facing: p.facing, style: model, height: meta.height + 1.5, windows: Boolean(h.lit) || hash(h.id + 99) % 10 < 7 };
        const names = [h.u, ...(h.m || [])].filter(Boolean).map((u) => `@${u}`);
        rec.label = names.length ? names.join(' & ') : 'A neighbour';
        // Garden beds and crops (growth stage from planting time).
        (GAME ? Props.BED_SPOTS : []).forEach(([lx, lz], plot) => {
          this.beds.setMatrixAt(beds, at(lx, lz));
          this.bedRecs[beds++] = { house: rec, plot };
          const g = h.g?.[plot];
          if (!g || !CROPS[g.c]) return;
          const ready = cropReadyAt({ garden: h.g, job: h.j }, plot);
          const k = Math.max(0, Math.min(1, (now - g.at) / Math.max(1, ready - g.at)));
          const base = at(lx, lz).clone();
          const size = 0.35 + 0.75 * k;
          this.plants.setMatrixAt(plants++, base.clone().multiply(new THREE.Matrix4().makeScale(size, size, size)));
          if (k >= 1) {
            const big = g.c === 'pumpkin' ? 2.2 : 1;
            this.fruits.setMatrixAt(fruits, base.clone().multiply(new THREE.Matrix4().makeScale(big, big, big)));
            this.fruits.setColorAt(fruits++, c.setHex(CROPS[g.c].color));
          }
        });
        if (h.df?.dog) this.kennels.setMatrixAt(kennels++, at(...Props.KENNEL_SPOT));
        if (h.df?.alarm) this.bells.setMatrixAt(bells++, at(...Props.BELL_SPOT));
        if (h.r) {
          this.flags.setMatrixAt(flags, at(...Props.FLAG_SPOT));
          this.flags.setColorAt(flags++, c.setHex((h.sh || 0) > now ? 0x3d7cf5 : 0xd94141));
        }
        if (h.c && this.parked[h.c] && this.hiddenCar !== h.id) {
          const w = toWorld(p, ...Props.CAR_SPOT);
          q.setFromAxisAngle(up, p.facing + Math.PI / 2);
          const pm = this.parked[h.c];
          pm.setMatrixAt(parkedCount[h.c], m.compose(new THREE.Vector3(w.x, 0, w.z), q, one));
          pm.setColorAt(parkedCount[h.c]++, c.setHex(CARS[h.c].color));
        }
        st.list.push(rec);
        this.drawnAll.push(rec);
      }
    }
    for (const st of this.styles) {
      for (const k of HOUSE_PARTS) {
        st[k].count = st.list.length;
        st[k].instanceMatrix.needsUpdate = true;
        if (st[k].instanceColor) st[k].instanceColor.needsUpdate = true;
      }
    }
    this.yards.count = this.drawnAll.length;
    this.porch.count = this.porchGlow.count = porch;
    const lifeCounts = [[this.beds, beds], [this.plants, plants], [this.fruits, fruits], [this.kennels, kennels], [this.bells, bells], [this.flags, flags]];
    for (const [model, mesh] of Object.entries(this.parked)) lifeCounts.push([mesh, parkedCount[model]]);
    for (const [mesh, n] of lifeCounts) {
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    for (const [k, mesh] of Object.entries(this.decorMeshes)) {
      mesh.count = decorCount[k];
      mesh.instanceMatrix.needsUpdate = true;
    }
    for (const mesh of [this.sidewalks, this.lots, this.lamps, this.lampBulbs, this.tufts, this.yards, this.porch, this.porchGlow]) mesh.instanceMatrix.needsUpdate = true;
    this.dirtyGlow = true;
  }

  // Windows and porch lights: warm at night for residents who visited today.
  #applyNight() {
    const n = this.night;
    const c = new THREE.Color();
    for (const st of this.styles) {
      st.list.forEach((h, i) => {
        c.copy(DAY_GLASS).lerp(NIGHT_GLASS, n);
        if (h.windows) c.lerp(WARM, n);
        st.glass.setColorAt(i, c);
      });
      if (st.glass.instanceColor) st.glass.instanceColor.needsUpdate = true;
    }
    const m = new THREE.Matrix4();
    const grey = new THREE.Color(0x6a6a6a);
    (this.drawnAll || []).forEach((h, i) => {
      // Porch light shines only for residents active today (the "porchlight").
      const on = Boolean(this.houses.get(h.id)?.lit) || this.overrides.has(h.id);
      this.porch.setColorAt(i, on ? c.setHex(h.light).lerp(grey, 1 - n) : grey);
      this.porchGlow.setColorAt(i, c.setHex(h.light));
      const s = on ? Math.max(0.001, n) : 0.001;
      const p = this.porchPos[i];
      m.makeRotationX(-Math.PI / 2).scale(new THREE.Vector3(s, s, s)).setPosition(p.x, 0.36, p.z);
      this.porchGlow.setMatrixAt(i, m);
    });
    if (this.porch.instanceColor) this.porch.instanceColor.needsUpdate = true;
    if (this.porchGlow.instanceColor) this.porchGlow.instanceColor.needsUpdate = true;
    this.porchGlow.instanceMatrix.needsUpdate = true;
    this.lampBulbs.material.color.setHex(0x8a8a80).lerp(new THREE.Color(0xfff1c9), Math.min(1, n * 1.4));
  }

  // ---------- nodes ----------
  #rebuildNodes() {
    this.dirtyNodes = false;
    const list = [];
    if (this.center && Math.max(Math.abs(this.center.gx), Math.abs(this.center.gz)) <= LOAD_RADIUS) list.push(...plazaNodes());
    for (const b of this.blocks.keys()) {
      const first = firstHouseOfBlock(b);
      for (let id = first; id <= lastHouseOfBlock(b); id++) list.push(...plotNodes(id));
    }
    this.nodes = list;
    this.nodeIndex.clear();
    const counts = Object.fromEntries(Object.keys(this.nodeMeshes).map((k) => [k, 0]));
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    for (const n of list) {
      const ready = this.isReady(n);
      let mesh;
      if (n.kind === 'tree') mesh = ready ? n.variant : 'stump';
      else if (n.kind === 'rock') mesh = ready ? 'rock' : 'rubble';
      else if (n.kind === 'flower') mesh = ready ? 'flower' : 'sprout';
      else mesh = ready ? 'berry' : 'bush';
      const target = this.nodeMeshes[mesh];
      const i = counts[mesh]++;
      const h = hash(n.x * 31 + n.z * 17);
      const s = n.s;
      m.makeRotationY((h % 628) / 100).scale(new THREE.Vector3(s, s, s)).setPosition(n.x, 0, n.z);
      target.setMatrixAt(i, m);
      // Slight per-tree tint so groves don't look copy-pasted.
      const tint = 0.88 + ((h >>> 8) % 25) / 100;
      target.setColorAt(i, c.setRGB(tint, tint * (0.97 + ((h >>> 3) % 6) / 100), tint));
      this.nodeIndex.set(n.id, { mesh: target, meshName: mesh, i, node: n, base: m.clone(), ready });
    }
    for (const [k, mesh] of Object.entries(this.nodeMeshes)) {
      mesh.count = counts[k];
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  markNodesDirty() {
    this.dirtyNodes = true;
  }

  wobble(nodeId) {
    this.wobbles.set(nodeId, performance.now());
  }

  // Animated falling tree, then the instance switches to a stump.
  fellTree(node, fromX, fromZ) {
    const geo = this.nodeMeshes[node.variant].geometry;
    const mesh = new THREE.Mesh(geo, this.nodeMeshes[node.variant].material);
    mesh.castShadow = true;
    const pivot = new THREE.Group();
    pivot.position.set(node.x, 0.3, node.z);
    pivot.rotation.y = Math.atan2(node.x - fromX, node.z - fromZ);
    mesh.scale.setScalar(node.s);
    pivot.add(mesh);
    this.scene.add(pivot);
    this.falling.push({ pivot, t: 0, node });
    this.dirtyNodes = true;
  }

  #animate(t, dt, px, pz) {
    // Wobble nodes that were just hit (scale spring).
    const now = performance.now();
    const m = new THREE.Matrix4();
    for (const [id, start] of this.wobbles) {
      const rec = this.nodeIndex.get(id);
      const k = (now - start) / 450;
      if (!rec || k >= 1) {
        this.wobbles.delete(id);
        if (rec) {
          rec.mesh.setMatrixAt(rec.i, rec.base);
          rec.mesh.instanceMatrix.needsUpdate = true;
        }
        continue;
      }
      const w = Math.sin(k * Math.PI * 4) * (1 - k) * 0.12;
      m.copy(rec.base).multiply(new THREE.Matrix4().makeRotationZ(w).premultiply(new THREE.Matrix4().makeScale(1 + w * 0.5, 1 - w * 0.3, 1 + w * 0.5)));
      rec.mesh.setMatrixAt(rec.i, m);
      rec.mesh.instanceMatrix.needsUpdate = true;
    }
    // Falling trees: ease over, bounce, sink away.
    this.falling = this.falling.filter((f) => {
      f.t += dt;
      const k = Math.min(1, f.t / 0.9);
      const ease = k < 1 ? k * k * k : 1;
      f.pivot.children[0].rotation.x = ease * (Math.PI / 2 - 0.05) + (k === 1 ? Math.sin(Math.min(1, (f.t - 0.9) / 0.3) * Math.PI) * 0.08 : 0);
      if (f.t > 1.6) f.pivot.position.y -= dt * 3;
      if (f.t > 2.6) {
        this.scene.remove(f.pivot);
        return false;
      }
      return true;
    });

    // Ready markers over harvestable nodes closest to the player.
    let r = 0;
    const near = [];
    for (const n of GAME ? this.nodes : []) {
      const d = (n.x - px) ** 2 + (n.z - pz) ** 2;
      if (d < 26 ** 2 && this.isReady(n)) near.push([d, n]);
    }
    near.sort((a, b) => a[0] - b[0]);
    for (const [, n] of near.slice(0, 64)) {
      const y = (n.kind === 'tree' ? 7.2 : n.kind === 'flower' ? 2 : 3.2) * n.s + Math.sin(t * 3 + n.x) * 0.25;
      m.makeRotationY(t * 2 + n.z).setPosition(n.x, y, n.z);
      this.readyMarks.setMatrixAt(r++, m);
    }
    this.readyMarks.count = r;
    this.readyMarks.instanceMatrix.needsUpdate = true;

    // Water ripples.
    for (let i = 0; i < 8; i++) {
      const pond = i >= 4;
      const k = ((t * 0.5 + i * 0.25) % 1);
      const s = pond ? 2 + k * 6 : 1.5 + k * 6;
      const cx = pond ? PLAZA.pond.x + ((i * 37) % 7) - 3 : 0;
      const cz = pond ? PLAZA.pond.z + ((i * 53) % 7) - 3 : 0;
      m.makeScale(s, 1, s).setPosition(cx, pond ? 0.45 : 1.85, cz);
      this.ripples.setMatrixAt(i, m);
    }
    this.ripples.instanceMatrix.needsUpdate = true;
    this.ripples.material.opacity = 0.3;

    // Chimney smoke from the nearest chimneys.
    const chimneys = [];
    for (const st of this.styles) {
      for (const h of st.list) {
        const d = (h.x - px) ** 2 + (h.z - pz) ** 2;
        if (d < 70 ** 2) chimneys.push([d, h]);
      }
    }
    chimneys.sort((a, b) => a[0] - b[0]);
    const srcs = chimneys.slice(0, 8).flatMap(([, h]) =>
      (this.styles[h.style].meta.chimneys || []).map(([cx, cy, cz]) => {
        const w = toWorld({ x: h.x, z: h.z, facing: h.facing }, cx, cz);
        return [w.x, cy + 0.3, w.z];
      }),
    ).slice(0, 10);
    let si = 0;
    for (const p of this.smokePuffs) {
      p.t += dt;
      if (p.t > 3) p.t -= 3;
      const src = srcs[p.src];
      if (!src) continue;
      const k = p.t / 3;
      const s = (0.4 + k * 1.2) * (1 - k * k);
      m.makeScale(s, s, s).setPosition(src[0] + Math.sin(k * 5 + p.src) * 0.6 + k * 2, src[1] + k * 6, src[2]);
      this.smoke.setMatrixAt(si++, m);
    }
    this.smoke.count = si;
    this.smoke.instanceMatrix.needsUpdate = true;

    // Fireflies at night around the player.
    const pos = this.fireflies.geometry.attributes.position;
    this.fireflyData.forEach((f, i) => {
      const fx = ((f.x - px + 30) % 60 + 60) % 60 - 30;
      const fz = ((f.z - pz + 30) % 60 + 60) % 60 - 30;
      pos.setXYZ(i, px + fx + Math.sin(t + f.p) * 1.5, f.y + Math.sin(t * 1.7 + f.p) * 0.6, pz + fz + Math.cos(t * 0.8 + f.p) * 1.5);
    });
    pos.needsUpdate = true;
    this.fireflies.material.opacity = Math.max(0, this.night - 0.3) * (0.6 + Math.sin(t * 4) * 0.4);
  }

  // ---------- collision ----------
  blocked(x, z) {
    if (this.interior) {
      const b = this.interior.bounds;
      const lx = x - INTERIOR_ORIGIN.x;
      const lz = z - INTERIOR_ORIGIN.z;
      const inDoorway = Math.abs(lx) < 1.1 && lz > b.maxZ - 0.5;
      if (!inDoorway && (lx < b.minX || lx > b.maxX || lz < b.minZ || lz > b.maxZ)) return true;
      return this.interior.furniture.some((f) => Math.abs(lx - f.x) < f.hw && Math.abs(lz - f.z) < f.hd);
    }
    const [gx, gz] = worldToGrid(x, z);
    const b = gridToBlock(gx, gz);
    if (b < -1) return this.centre.blocked(x, z);
    if (this.forest.blocked(x, z, this.totalHouses)) return true;
    if (b < 0) {
      // Plaza: fountain, pond water, workbench, stall, board, nodes.
      if (Math.hypot(x, z) < 10.4) return true;
      const P = PLAZA.pond;
      if (Math.hypot(x - P.x, z - P.z) < P.r + 0.5) return true;
      if (GAME) {
        for (const s of [PLAZA.workbench, PLAZA.stall, PLAZA.board, PLAZA.grocer]) if (Math.abs(x - s.x) < 3 && Math.abs(z - s.z) < 3) return true;
      } else {
        const { cafe, hall, wheel, playground } = VENUES;
        if (Math.hypot(x - wheel.x, z - wheel.z) < wheel.r) return true; // wheel base
        if (Math.abs(x - cafe.x) < 3.2 && Math.abs(z - (cafe.z - cafe.hd + 1)) < 0.9) return true; // café counter
        if (Math.abs(x - hall.x) < hall.hw - 0.5 && Math.abs(z - (hall.z - hall.hd + 1.6)) < 1.5) return true; // stage
        if (Math.hypot(x - (playground.x + 3), z - playground.z) < 1.1) return true; // dice table
      }
      const S = PLAZA.showroom;
      if (Math.abs(x - S.x) < S.hw && Math.abs(z - S.z) < S.hd) return true;
      return this.#nodeBlocks(plazaNodes(), x, z);
    }
    const lx = x - gx * PITCH;
    const lz = z - gz * PITCH;
    const half = LOT / 2;
    if (Math.abs(lx) > half || Math.abs(lz) > half) return false;
    const sx = Math.round(lx / PLOT + (BLOCK_SIDE - 1) / 2);
    const sz = Math.round(lz / PLOT + (BLOCK_SIDE - 1) / 2);
    if (sx < 0 || sz < 0 || sx >= BLOCK_SIDE || sz >= BLOCK_SIDE) return false;
    const id = houseAt(b, sz * BLOCK_SIDE + sx);
    if (!id) return false; // an unused plot at the end of a district
    const h = this.houses.get(id) || (this.overrides.has(id) ? { id } : null);
    if (h && (!GAME || !h.mv)) {
      // Footprint of this house's model, in the house's own frame.
      const tier = this.overrides.get(id)?.t ?? h.t ?? 1;
      const paint = this.overrides.get(id)?.p ?? h.p;
      const meta = this.models[modelFor(id, tier, lookFor(id, paint).style)].meta;
      const p = housePosition(id);
      const dx = x - p.x;
      const dz = z - p.z;
      const c = Math.cos(p.facing);
      const sn = Math.sin(p.facing);
      const ux = dx * c - dz * sn;
      const uz = dx * sn + dz * c;
      // +0.3 so your body stops at the wall instead of sinking into it.
      if (Math.abs(ux - (meta.cx || 0)) < meta.hx + 0.3 && Math.abs(uz - (meta.cz || 0)) < meta.hz + 0.3) return true;
    }
    // Nodes of this plot and the plot behind it (shared back garden).
    const neighbours = [id, id - BLOCK_SIDE, id + BLOCK_SIDE].filter((n) => n >= 1 && blockOfHouse(n) === b);
    for (const n of neighbours) if (this.#nodeBlocks(plotNodes(n), x, z)) return true;
    return false;
  }

  #nodeBlocks(nodes, x, z) {
    for (const n of nodes) {
      const r = NODE_KINDS[n.kind].radius * n.s;
      // Felled trees (stumps) and mined rocks (rubble) don't block.
      const solid = n.kind === 'tree' || n.kind === 'rock' ? this.isReady(n) : true;
      if (r > 0 && solid && (n.x - x) ** 2 + (n.z - z) ** 2 < r * r) return true;
    }
    return false;
  }

  // ---------- picking ----------
  pick(ndcX, ndcY) {
    this.raycaster.setFromCamera({ x: ndcX, y: ndcY }, this.camera);
    const targets = [];
    for (const [name, mesh] of Object.entries(this.nodeMeshes)) {
      mesh.userData.name = name;
      if (mesh.count) targets.push(mesh);
    }
    for (const st of this.styles) targets.push(st.walls, st.roof);
    targets.push(this.beds, this.plants, this.fruits);
    if (this.interior) targets.unshift(this.interior.group);
    targets.push(this.plaza, this.centre.group);
    const hits = this.raycaster.intersectObjects(targets, true);
    for (const hit of hits) {
      const obj = hit.object;
      if (obj.userData.name && hit.instanceId !== undefined) {
        for (const rec of this.nodeIndex.values()) if (rec.mesh === obj && rec.i === hit.instanceId) return { node: rec.node };
      }
      for (const st of this.styles) {
        if ((obj === st.walls || obj === st.roof) && hit.instanceId !== undefined) return { house: st.list[hit.instanceId] };
      }
      if (obj === this.beds && hit.instanceId !== undefined) return { bed: this.bedRecs[hit.instanceId] };
      if ((obj === this.plants || obj === this.fruits) && hit.instanceId !== undefined) {
        // Plants/fruit are drawn on beds: find the bed under the hit point.
        let best = null;
        let bestD = 4;
        for (let i = 0; i < this.beds.count; i++) {
          const mm = new THREE.Matrix4();
          this.beds.getMatrixAt(i, mm);
          const pos = new THREE.Vector3().setFromMatrixPosition(mm);
          const d = (pos.x - hit.point.x) ** 2 + (pos.z - hit.point.z) ** 2;
          if (d < bestD) {
            bestD = d;
            best = this.bedRecs[i];
          }
        }
        if (best) return { bed: best };
      }
      // Venue things: a seat, the dice table, a wheel cabin.
      for (let o = obj; o; o = o.parent) {
        if (o.userData?.seat) return { seat: o.userData.seat };
        if (o.userData?.dice) return { dice: true };
        if (o.userData?.ride) return { ride: true };
        if (o.userData?.villa !== undefined) return { villa: o.userData.villa };
      }
      // Plaza stations by proximity of the hit point.
      const p = hit.point;
      if (!GAME) {
        for (const [name, v] of Object.entries(VENUES)) {
          const r = name === 'wheel' ? 9 : Math.max(v.hw, v.hd) + 1;
          if (Math.hypot(p.x - v.x, p.z - v.z) < r) return { station: name, at: v };
        }
      }
      for (const [name, s] of Object.entries(PLAZA)) {
        if (!GAME && ['workbench', 'stall', 'board', 'grocer'].includes(name)) continue;
        const r = name === 'pond' ? s.r + 1 : name === 'showroom' ? s.hw + 1 : 4.5;
        if (Math.hypot(p.x - s.x, p.z - s.z) < r) return { station: name, at: s };
      }
      break;
    }
    const ray = this.raycaster.ray;
    if (ray.direction.y >= 0) return null;
    const t = (0.3 - ray.origin.y) / ray.direction.y;
    const gx = ray.origin.x + ray.direction.x * t;
    const gz = ray.origin.z + ray.direction.z * t;
    const P = PLAZA.pond;
    if (Math.hypot(gx - P.x, gz - P.z) < P.r) return { station: 'pond', at: P };
    return { ground: { x: gx, z: gz } };
  }

  showMarker(id) {
    if (!id) {
      this.marker.visible = false;
      return;
    }
    const p = housePosition(id);
    this.marker.position.set(p.x, 12, p.z);
    this.marker.visible = true;
  }

  nearest(x, z, maxDist, limit) {
    const out = [];
    const d2 = maxDist * maxDist;
    for (const h of this.drawnAll || []) {
      const d = (h.x - x) ** 2 + (h.z - z) ** 2;
      if (d < d2) out.push([d, h]);
    }
    out.sort((a, b) => a[0] - b[0]);
    return out.slice(0, limit).map((e) => e[1]);
  }

  // Is a house between the camera and the player? Checked ~8 times a second.
  #playerHidden(group) {
    const now = performance.now();
    if (now - (this.hiddenAt || 0) < 120) return this.hidden;
    this.hiddenAt = now;
    const target = group.position.clone().setY(2.2);
    const dir = target.clone().sub(this.camera.position);
    const dist = dir.length();
    this.occluder = this.occluder || new THREE.Raycaster();
    this.occluder.set(this.camera.position, dir.normalize());
    this.occluder.far = dist - 1;
    const meshes = this.styles.flatMap((st) => [st.walls, st.roof]);
    this.hidden = this.occluder.intersectObjects(meshes, false).length > 0;
    return this.hidden;
  }

  // ---------- house interiors ----------
  enterInterior(houseId, tier, paint) {
    this.exitInterior();
    const wall = colorOf('wall', lookFor(houseId, paint).wall);
    this.interior = buildInterior(tier || 1, wall, houseId);
    this.interior.house = houseId;
    this.scene.add(this.interior.group);
    this.ground.visible = false; // the room brings its own garden
    return this.interior;
  }

  exitInterior() {
    if (!this.interior) return;
    this.scene.remove(this.interior.group);
    this.ground.visible = true;
    this.interior.group.traverse((o) => {
      o.geometry?.dispose();
      o.material?.dispose?.();
    });
    this.interior = null;
  }

  render(playerGroup) {
    this.renderer.render(this.scene, this.camera);
    if (!playerGroup || !this.#playerHidden(playerGroup)) return;
    // Silhouette pass: draw the player again only where something is in
    // front of them (GreaterDepth), so you never lose yourself behind a house.
    if (!this.ghost) {
      this.ghost = new THREE.Scene();
      this.ghost.overrideMaterial = new THREE.MeshBasicMaterial({
        color: 0xff8a3d, transparent: true, opacity: 0.55, depthWrite: false, depthFunc: THREE.GreaterDepth,
      });
    }
    const parent = playerGroup.parent;
    this.ghost.add(playerGroup);
    this.renderer.autoClear = false;
    this.renderer.render(this.ghost, this.camera);
    this.renderer.autoClear = true;
    parent.add(playerGroup);
  }
}

// ---------- decor models (vertex coloured) ----------
function colored(geo, hex) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g.attributes.uv) g.deleteAttribute('uv');
  const c = new THREE.Color(hex);
  const arr = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < arr.length; i += 3) arr.set([c.r, c.g, c.b], i);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}
const bx = (w, h, d, x, y, z, col) => colored(new THREE.BoxGeometry(w, h, d).translate(x, y, z), col);
const done = (parts) => {
  const g = mergeGeometries(parts);
  g.computeVertexNormals();
  return g;
};
function fenceGeometry() {
  const p = [bx(3.2, 0.18, 0.12, 0, 0.6, 0, 0xf7f3ea), bx(3.2, 0.18, 0.12, 0, 1.1, 0, 0xf7f3ea)];
  for (let i = 0; i < 6; i++) p.push(colored(new THREE.BoxGeometry(0.3, 1.5, 0.14).translate(-1.4 + i * 0.56, 0.75, 0.04), 0xffffff));
  return done(p);
}
function planterGeometry() {
  return done([
    bx(1.6, 0.7, 1.0, 0, 0.35, 0, 0x9a6b42),
    colored(new THREE.IcosahedronGeometry(0.42, 0).translate(-0.4, 0.95, 0), 0xff6f91),
    colored(new THREE.IcosahedronGeometry(0.42, 0).translate(0.4, 0.95, 0), 0xffd166),
    colored(new THREE.IcosahedronGeometry(0.4, 0).translate(0, 1.05, 0.1), 0x5aa04a),
  ]);
}
function lanternGeometry() {
  return done([
    bx(0.2, 2.2, 0.2, 0, 1.1, 0, 0x3a3f4a),
    bx(0.7, 0.8, 0.7, 0, 2.5, 0, 0xffd27a),
    colored(new THREE.ConeGeometry(0.6, 0.5, 4).rotateY(Math.PI / 4).translate(0, 3.15, 0), 0x3a3f4a),
  ]);
}
function birdhouseGeometry() {
  return done([
    bx(0.18, 2.4, 0.18, 0, 1.2, 0, 0x7a5233),
    bx(0.9, 0.9, 0.9, 0, 2.8, 0, 0xe8b45a),
    colored(new THREE.ConeGeometry(0.85, 0.6, 4).rotateY(Math.PI / 4).translate(0, 3.55, 0), 0xc0504d),
    colored(new THREE.CircleGeometry(0.18, 10).translate(0, 2.85, 0.46), 0x2a2a2e),
  ]);
}
function gnomeGeometry() {
  return done([
    colored(new THREE.CylinderGeometry(0.35, 0.45, 0.8, 8).translate(0, 0.4, 0), 0x4f6d9a),
    colored(new THREE.SphereGeometry(0.3, 8, 6).translate(0, 1.0, 0), 0xf6d2b5),
    colored(new THREE.ConeGeometry(0.28, 0.4, 8).translate(0, 0.8, 0.12), 0xffffff),
    colored(new THREE.ConeGeometry(0.34, 0.8, 8).translate(0, 1.5, 0), 0xd94141),
  ]);
}
