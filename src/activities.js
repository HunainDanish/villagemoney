import * as THREE from 'three';
import { NODE_KINDS, PLAZA } from '../shared/nodes.js';
import { ITEMS, SKILLS, nodeReadyAt } from '../shared/game.js';
import { sfx, floatText } from './fx.js';

// Turns taps into activities: walk to a thing, then chop / mine / pick /
// fish / knock / open a station. Animation and feedback happen here; the
// rules (and the reward) come from the store.

const HIT_MS = 600; // one swing; matches the character's chop cycle
const STATION_RANGE = 4.5;

export class Activities {
  constructor({ world, player, store, particles, labels, ui }) {
    Object.assign(this, { world, player, store, particles, labels, ui });
    this.current = null;
    player.onCancel = () => this.stop();
    world.isReady = (n) => nodeReadyAt(this.store.state, n) <= Date.now();
    // Regrowth: every 2 s, redraw if something nearby has grown back.
    setInterval(() => {
      for (const rec of this.world.nodeIndex.values()) {
        if (!rec.ready && this.world.isReady(rec.node)) return this.world.markNodesDirty();
      }
    }, 2000);
    this.#buildBobber();
  }

  #buildBobber() {
    const g = new THREE.Group();
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), new THREE.MeshLambertMaterial({ color: 0xe84a4a }));
    const bottom = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0xffffff }));
    top.scale.y = 0.8;
    g.add(top, bottom);
    g.visible = false;
    this.world.scene.add(g);
    this.bobber = g;
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 }));
    line.frustumCulled = false;
    line.visible = false;
    this.world.scene.add(line);
    this.line = line;
  }

  // Entry point for any tap in the world.
  tap(hit) {
    if (this.current?.type === 'fish' && this.current.phase === 'bite') return this.#reel();
    if (hit.node) return this.#goNode(hit.node);
    if (hit.station) return this.#goStation(hit.station, hit.at);
    if (hit.bed) return this.ui.openBed(hit.bed, (h, then) => this.knock(h, then));
    if (hit.house) return this.ui.openHouse(hit.house, (h, then) => this.knock(h || hit.house, then));
    if (hit.ground) this.player.walkTo(hit.ground.x, hit.ground.z);
  }

  stop() {
    const c = this.current;
    if (!c) return;
    this.current = null;
    this.player.char.stop();
    this.bobber.visible = false;
    this.line.visible = false;
    this.ui.prompt(null);
    clearTimeout(c.timer);
  }

  #toast(msg) {
    this.ui.toast(msg);
  }

  // ---------- harvesting ----------
  #goNode(node) {
    const kind = NODE_KINDS[node.kind];
    if (!this.world.isReady(node)) {
      const mins = Math.ceil((nodeReadyAt(this.store.state, node) - Date.now()) / 60000);
      return this.#toast(`${node.kind === 'tree' ? 'This tree is' : 'It is'} growing back · ${mins} min`);
    }
    const range = (kind.radius || 0.6) * node.s + 1.6;
    this.player.walkTo(node.x, node.z, range, () => this.#harvest(node));
  }

  #harvest(node) {
    const kind = NODE_KINDS[node.kind];
    const ch = this.player.char;
    const swing = node.kind === 'tree' || node.kind === 'rock';
    this.current = { type: 'harvest', node, hits: 0 };
    ch.play(swing ? 'chop' : 'gather', swing ? 'axe' : null);
    const cur = this.current;
    const hit = () => {
      if (this.current !== cur) return;
      cur.hits++;
      const y = node.kind === 'tree' ? 2.4 : 1;
      if (node.kind === 'tree') {
        sfx.chop(cur.hits);
        this.particles.chips(node.x, y, node.z);
        if (cur.hits === kind.hits) this.particles.leaves(node.x, 5, node.z);
      } else if (node.kind === 'rock') {
        sfx.mine();
        this.particles.stones(node.x, y, node.z);
      }
      if (swing) this.world.wobble(node.id);
      if (cur.hits >= kind.hits) return this.#finish(node);
      cur.timer = setTimeout(hit, HIT_MS);
    };
    // First strike lands at the bottom of the first swing.
    cur.timer = setTimeout(hit, swing ? HIT_MS * 0.6 : 500);
  }

  async #finish(node) {
    const cur = this.current;
    const r = await this.store.act({ a: 'harvest', node: node.id });
    if (this.current === cur) this.stop();
    if (!r.ok) return this.#toast(r.reason === 'too fast' ? 'Take a breath… try again in a moment' : capital(r.reason));
    if (node.kind === 'tree') {
      sfx.fall();
      this.world.fellTree(node, this.player.pos.x, this.player.pos.z);
      this.player.shake = 0.35;
    } else {
      sfx.pickup();
      this.particles.sparkle(node.x, 1.5, node.z);
      this.world.markNodesDirty();
    }
    this.#rewards(r.events, new THREE.Vector3(node.x, 3, node.z));
  }

  #rewards(events, at) {
    let dy = 0;
    for (const e of events || []) {
      if (e.type === 'gain') {
        floatText(this.labels, this.world.camera, at.clone().setY(at.y + dy), `+${e.qty} ${ITEMS[e.item]?.icon || ''}`);
        dy += 1.2;
        this.ui.bumpBag();
      } else if (e.type === 'level') {
        sfx.level();
        this.particles.sparkle(this.player.pos.x, 3, this.player.pos.z);
        this.ui.celebrate(`${SKILLS[e.skill]} level ${e.level}!`);
      } else if (e.type === 'coins') {
        floatText(this.labels, this.world.camera, at.clone().setY(at.y + dy), `+${e.coins} 🪙`);
        dy += 1.2;
      } else if (e.type === 'daily') {
        this.ui.celebrate(`Day ${e.streak} streak · +${e.coins} 🪙`);
      }
    }
  }

  // ---------- stations ----------
  #goStation(name, at) {
    if (name === 'pond') return this.#goFish();
    this.player.walkTo(at.x, at.z, STATION_RANGE, () => {
      sfx.click();
      if (name === 'workbench') this.ui.openCraft();
      else if (name === 'stall') this.ui.openShop();
      else if (name === 'board') this.ui.openQuests();
      else if (name === 'grocer') this.ui.openGrocer();
      else if (name === 'showroom') this.ui.openShowroom();
    });
  }

  // ---------- fishing ----------
  #goFish() {
    const P = PLAZA.pond;
    // Walk to the nearest point on the shore.
    const dx = this.player.pos.x - P.x;
    const dz = this.player.pos.z - P.z;
    const d = Math.hypot(dx, dz) || 1;
    const sx = P.x + (dx / d) * (P.r + 1.6);
    const sz = P.z + (dz / d) * (P.r + 1.6);
    this.player.walkTo(sx, sz, 1.2, () => this.#cast());
  }

  #cast() {
    const P = PLAZA.pond;
    const ch = this.player.char;
    this.player.face(P.x, P.z);
    ch.play('cast');
    sfx.splash();
    const dx = P.x - this.player.pos.x;
    const dz = P.z - this.player.pos.z;
    const d = Math.hypot(dx, dz);
    const bx = this.player.pos.x + (dx / d) * 5;
    const bz = this.player.pos.z + (dz / d) * 5;
    this.bobber.position.set(bx, 0.45, bz);
    this.bobber.visible = true;
    this.line.visible = true;
    this.particles.splash(bx, bz);
    const wait = 2500 + Math.random() * 4500;
    const sinceLast = Date.now() - (this.store.state.fishAt || 0);
    const cur = { type: 'fish', phase: 'wait', bx, bz };
    this.current = cur;
    this.ui.prompt('Waiting for a bite…');
    cur.timer = setTimeout(() => {
      if (this.current !== cur) return;
      cur.phase = 'bite';
      sfx.bite();
      this.particles.splash(bx, bz);
      this.ui.prompt('🎣 Tap now!', () => this.#reel());
      cur.timer = setTimeout(() => {
        if (this.current !== cur) return;
        this.#toast('It got away…');
        this.stop();
      }, 1100);
    }, Math.max(wait, 6200 - sinceLast));
  }

  async #reel() {
    const cur = this.current;
    if (cur?.type !== 'fish' || cur.phase !== 'bite') return;
    cur.phase = 'reel';
    clearTimeout(cur.timer);
    this.ui.prompt(null);
    sfx.splash();
    this.particles.splash(cur.bx, cur.bz);
    const r = await this.store.act({ a: 'fish' });
    this.stop();
    if (!r.ok) return this.#toast(capital(r.reason));
    const fish = r.events?.find((e) => e.type === 'gain');
    if (fish) {
      const def = ITEMS[fish.item];
      this.ui.celebrate(fish.item === 'boot' ? 'You fished up… an old boot 🥾' : `You caught a ${def.name} ${def.icon}`);
      if (fish.item !== 'boot') sfx.pickup();
    }
    this.#rewards(r.events.filter((e) => e.type !== 'gain'), this.player.pos.clone().setY(3));
  }

  // ---------- knocking (quest: visit neighbours) ----------
  // Walk to the front door, then knock (or, with `then`, do something else
  // there, e.g. start a raid).
  async knock(house, then) {
    const near = Math.hypot(house.x - this.player.pos.x, house.z - this.player.pos.z) < 14;
    if (!near) {
      const door = { x: house.x + Math.sin(house.facing) * 6.5, z: house.z + Math.cos(house.facing) * 6.5 };
      this.player.walkTo(door.x, door.z, 1.2, () => this.knock(house, then));
      return;
    }
    this.player.face(house.x, house.z);
    if (then) return then();
    this.player.char.play('wave');
    sfx.click();
    setTimeout(sfx.click, 160);
    const r = await this.store.act({ a: 'visit', house: house.id });
    if (r.ok) this.#toast(`You knocked on ${house.u ? '@' + house.u : 'a neighbour'}'s door 👋`);
  }

  // Per-frame: fishing line + bobber bob.
  update(t) {
    if (this.bobber.visible) {
      const c = this.current;
      const dip = c?.phase === 'bite' ? -0.35 + Math.sin(t * 30) * 0.12 : Math.sin(t * 2) * 0.06;
      this.bobber.position.y = 0.45 + dip;
      const hand = new THREE.Vector3();
      this.player.char.armR.getWorldPosition(hand);
      hand.y += 0.4;
      const pos = this.line.geometry.attributes.position;
      pos.setXYZ(0, hand.x, hand.y + 1.2, hand.z);
      pos.setXYZ(1, this.bobber.position.x, this.bobber.position.y + 0.2, this.bobber.position.z);
      pos.needsUpdate = true;
    }
  }
}

const capital = (s = '') => s.charAt(0).toUpperCase() + s.slice(1);
