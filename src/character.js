import * as THREE from 'three';

// Low-poly articulated character: torso, head with eyes and hair, arms with
// hands, legs with shoes. Procedural animation (no model files):
//   idle  - breathing, slow weight shift, blinking
//   walk  - opposite arm/leg swing, body bob and lean, scaled by speed
//   run   - bigger swing, more lean
//   chop  - two-handed overhead swing (used by woodcutting / mining)
//   wave  - one arm waving
// Animation blends smoothly between states, so nothing pops.

import { SKIN, HAIR, SHIRTS, PANTS, defaultAvatar } from '../shared/look.js';

// Shared geometries: every character reuses them.
const G = {
  torso: new THREE.CapsuleGeometry(0.62, 0.7, 4, 10),
  head: new THREE.SphereGeometry(0.62, 16, 12),
  hair: new THREE.SphereGeometry(0.66, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55),
  eye: new THREE.SphereGeometry(0.085, 8, 6),
  arm: new THREE.CapsuleGeometry(0.17, 0.75, 3, 8).translate(0, -0.48, 0),
  hand: new THREE.SphereGeometry(0.17, 8, 6),
  leg: new THREE.CapsuleGeometry(0.21, 0.62, 3, 8).translate(0, -0.42, 0),
  shoe: new THREE.BoxGeometry(0.34, 0.2, 0.52).translate(0, 0, 0.08),
  shadow: new THREE.CircleGeometry(0.9, 20).rotateX(-Math.PI / 2),
  axeHandle: new THREE.CylinderGeometry(0.05, 0.05, 1.1, 6).translate(0, -0.55, 0),
  axeHead: new THREE.BoxGeometry(0.08, 0.32, 0.42).translate(0, -1.0, 0.16),
  // Hair styles and hats (all sit on the head group).
  longHair: new THREE.BoxGeometry(1.1, 0.9, 0.35).translate(0, -0.25, -0.42),
  bun: new THREE.SphereGeometry(0.26, 10, 8).translate(0, 0.62, -0.32),
  capCrown: new THREE.SphereGeometry(0.68, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.42).translate(0, 0.08, 0),
  capBrim: new THREE.CylinderGeometry(0.5, 0.5, 0.06, 14, 1, false, -Math.PI / 2, Math.PI).translate(0, 0.3, 0.42),
  beanie: new THREE.SphereGeometry(0.7, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.5).scale(1, 1.15, 1).translate(0, 0.1, 0),
  pompom: new THREE.SphereGeometry(0.16, 8, 6).translate(0, 0.92, 0),
  flower: new THREE.IcosahedronGeometry(0.13, 0),
  party: new THREE.ConeGeometry(0.32, 0.8, 12).translate(0, 0.95, 0),
  crown: new THREE.CylinderGeometry(0.42, 0.38, 0.32, 10, 1, true).translate(0, 0.66, 0),
};
const MATS = new Map();
const mat = (hex) => {
  if (!MATS.has(hex)) MATS.set(hex, new THREE.MeshLambertMaterial({ color: hex }));
  return MATS.get(hex);
};
const eyeMat = new THREE.MeshBasicMaterial({ color: 0x1b1b1f });
const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false });

const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));

export class Character {
  // avatar = { skin, hair, style, shirt, pants, hat } (indices, shared/look.js);
  // without one, the look comes from the name so everyone differs.
  constructor({ seed = 'me', shadow = true, avatar = null } = {}) {
    const av = avatar || defaultAvatar(seed);
    this.avatar = av;
    const skin = SKIN[av.skin] ?? SKIN[0];
    const hair = HAIR[av.hair] ?? HAIR[0];
    const shirt = SHIRTS[av.shirt] ?? SHIRTS[0];
    const pants = PANTS[av.pants] ?? PANTS[0];

    const group = new THREE.Group();
    group.scale.setScalar(0.72); // ~2.9 units tall: doors are 3.4 units
    const root = new THREE.Group(); // bobs and leans
    group.add(root);

    const torso = new THREE.Mesh(G.torso, mat(shirt));
    torso.position.y = 1.95;
    torso.scale.set(1, 1, 0.78);
    root.add(torso);

    const head = new THREE.Group();
    head.position.y = 3.25;
    root.add(head);
    head.add(new THREE.Mesh(G.head, mat(skin)));
    if (av.style !== 3) {
      // 0 short, 1 long, 2 bun, 3 bald
      const hairMesh = new THREE.Mesh(G.hair, mat(hair));
      hairMesh.rotation.x = -0.25;
      hairMesh.position.y = 0.04;
      head.add(hairMesh);
      if (av.style === 1) head.add(new THREE.Mesh(G.longHair, mat(hair)));
      if (av.style === 2) head.add(new THREE.Mesh(G.bun, mat(hair)));
    }
    // Hats: 0 none, 1 cap, 2 beanie, 3 flower crown, 4 party hat, 5 crown.
    if (av.hat === 1) head.add(new THREE.Mesh(G.capCrown, mat(shirt)), new THREE.Mesh(G.capBrim, mat(shirt)));
    if (av.hat === 2) head.add(new THREE.Mesh(G.beanie, mat(0xd94141)), new THREE.Mesh(G.pompom, mat(0xffffff)));
    if (av.hat === 3) {
      const cols = [0xff6f91, 0xffd166, 0xc77dff, 0xffffff, 0xff9e5e, 0x7cc35d];
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        const f = new THREE.Mesh(G.flower, mat(cols[i % cols.length]));
        f.position.set(Math.cos(a) * 0.55, 0.42, Math.sin(a) * 0.55);
        head.add(f);
      }
    }
    if (av.hat === 4) head.add(new THREE.Mesh(G.party, mat(0x8e5cd9)), new THREE.Mesh(G.pompom, mat(0xffd166)).translateY(0.45));
    if (av.hat === 5) head.add(new THREE.Mesh(G.crown, new THREE.MeshLambertMaterial({ color: 0xd4af37, side: THREE.DoubleSide })));
    const eyes = [-0.22, 0.22].map((x) => {
      const e = new THREE.Mesh(G.eye, eyeMat);
      e.position.set(x, 0.06, 0.55);
      head.add(e);
      return e;
    });

    const limb = (geo, color, x, y) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, y, 0);
      pivot.add(new THREE.Mesh(geo, mat(color)));
      root.add(pivot);
      return pivot;
    };
    const armL = limb(G.arm, shirt, -0.78, 2.45);
    const armR = limb(G.arm, shirt, 0.78, 2.45);
    for (const a of [armL, armR]) {
      const hand = new THREE.Mesh(G.hand, mat(skin));
      hand.position.y = -1.0;
      a.add(hand);
    }
    const legL = limb(G.leg, pants, -0.3, 1.2);
    const legR = limb(G.leg, pants, 0.3, 1.2);
    for (const l of [legL, legR]) {
      const shoe = new THREE.Mesh(G.shoe, mat(0x2a2a2e));
      shoe.position.y = -1.0;
      l.add(shoe);
    }

    // Tool held in the right hand (hidden until an activity needs it).
    const tool = new THREE.Group();
    tool.position.y = -0.95;
    tool.add(new THREE.Mesh(G.axeHandle, mat(0x8a5a2b)), new THREE.Mesh(G.axeHead, mat(0xb8bcc6)));
    tool.rotation.x = -Math.PI / 2;
    tool.visible = false;
    armR.add(tool);

    if (shadow) {
      for (const m of [torso, ...head.children]) m.castShadow = true;
      for (const p of [armL, armR, legL, legR]) p.traverse((o) => o.isMesh && (o.castShadow = true));
    } else {
      // Cheap blob shadow for other players (no shadow-map cost).
      const blob = new THREE.Mesh(G.shadow, shadowMat);
      blob.position.y = 0.06;
      group.add(blob);
    }

    Object.assign(this, { group, root, torso, head, eyes, armL, armR, legL, legR, tool });
    this.phase = Math.random() * 10;
    this.blinkIn = 2 + Math.random() * 3;
    this.speedSmooth = 0;
    this.heading = 0;
    this.action = null; // { type: 'chop' | 'wave', t }
  }

  // Semi-transparent "ghost" look while hidden from other players.
  setGhost(on) {
    this.group.traverse((o) => {
      if (!o.isMesh || o.material === shadowMat) return;
      if (on && !o.userData.ownMat) {
        o.material = o.material.clone();
        o.userData.ownMat = true;
      }
      if (o.userData.ownMat) {
        o.material.transparent = on;
        o.material.opacity = on ? 0.35 : 1;
        o.material.depthWrite = !on;
      }
    });
  }

  // Rotate smoothly toward a heading (radians).
  face(target, dt) {
    let d = target - this.heading;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.heading += d * (1 - Math.exp(-12 * dt));
    this.group.rotation.y = this.heading;
  }

  play(type, tool = null) {
    this.action = { type, t: 0 };
    this.tool.visible = Boolean(tool);
  }

  stop() {
    this.action = null;
    this.tool.visible = false;
  }

  // speed: world units per second (0 = idle, ~14 walk, ~26 run).
  update(dt, speed) {
    const s = (this.speedSmooth = damp(this.speedSmooth, speed, 10, dt));
    const walk = Math.min(1, s / 14); // 0..1 walk blend
    const run = Math.max(0, Math.min(1, (s - 14) / 12)); // 0..1 run blend
    this.phase += dt * (2 + s * 0.62);
    const p = this.phase;

    const swing = Math.sin(p) * (0.75 * walk + 0.35 * run);
    const breathe = Math.sin(performance.now() / 700 + this.phase) * 0.03 * (1 - walk);

    let armL = swing;
    let armR = -swing;
    let armLz = 0.08 + breathe;
    let armRz = -0.08 - breathe;
    let lean = 0.08 * walk + 0.16 * run;
    let bob = Math.abs(Math.sin(p)) * (0.16 * walk + 0.12 * run);
    let headTilt = 0;

    let legLx = -swing * 1.05;
    let legRx = swing * 1.05;
    let rootZ = 0;
    if (this.action) {
      const a = this.action;
      a.t += dt;
      if (a.type === 'dance') {
        // Arms up, swaying; little hops. Lasts 3 s.
        const k = a.t * 7;
        armL = -2.6 + Math.sin(k) * 0.5;
        armR = -2.6 - Math.sin(k) * 0.5;
        armLz = 0.5;
        armRz = -0.5;
        rootZ = Math.sin(k * 0.5) * 0.18;
        bob = Math.abs(Math.sin(k)) * 0.3;
        legLx = Math.sin(k) * 0.4;
        legRx = -Math.sin(k) * 0.4;
        if (a.t > 3) this.stop();
      } else if (a.type === 'clap') {
        const k = Math.sin(a.t * 18);
        armL = armR = -1.3;
        armLz = 0.35 + k * 0.3;
        armRz = -0.35 - k * 0.3;
        if (a.t > 1.6) this.stop();
      } else if (a.type === 'jump') {
        const k = (a.t % 0.7) / 0.7;
        bob = Math.sin(k * Math.PI) * 1.4;
        armL = armR = -2.8;
        armLz = 0.6;
        armRz = -0.6;
        if (a.t > 2.1) this.stop();
      } else if (a.type === 'sit' || a.type === 'ride' || a.type === 'swing') {
        // Seated: legs forward, body lowered. Swinging rocks back and forth.
        legLx = legRx = -1.45;
        bob = -1.05;
        armL = armR = a.type === 'swing' ? -2.2 : -0.35;
        lean = a.type === 'swing' ? Math.sin(a.t * 2.4) * 0.45 : -0.08;
        if (a.type === 'swing') {
          legLx = legRx = -1.45 + Math.sin(a.t * 2.4) * 0.5;
        }
      } else if (a.type === 'chop') {
        // 0.6 s loop: wind up overhead, strike down.
        const k = (a.t % 0.6) / 0.6;
        // Negative x-rotation raises the arm forward/up; end the strike forward-down.
        const strike = k < 0.55 ? -0.5 - 2.3 * (k / 0.55) : -2.8 + 2.3 * ((k - 0.55) / 0.45) ** 0.5;
        armL = armR = strike;
        armLz = 0.35;
        armRz = -0.35;
        lean = k < 0.55 ? -0.08 : 0.22;
        bob = 0;
      } else if (a.type === 'wave') {
        armR = Math.PI;
        armRz = -0.4 + Math.sin(a.t * 14) * 0.35;
        headTilt = 0.15;
        if (a.t > 1.6) this.stop();
      } else if (a.type === 'gather') {
        const k = Math.min(1, a.t / 0.3);
        lean = 0.55 * k;
        armL = armR = -1.2 * k;
        bob = -0.25 * k;
      } else if (a.type === 'cast') {
        armR = -2.2 + Math.min(1, a.t * 3) * 1.6;
        armL = -0.5;
      }
    }

    this.armL.rotation.x = damp(this.armL.rotation.x, armL, 18, dt);
    this.armR.rotation.x = damp(this.armR.rotation.x, armR, 18, dt);
    this.armL.rotation.z = damp(this.armL.rotation.z, armLz, 12, dt);
    this.armR.rotation.z = damp(this.armR.rotation.z, armRz, 12, dt);
    this.legL.rotation.x = damp(this.legL.rotation.x, legLx, 14, dt);
    this.legR.rotation.x = damp(this.legR.rotation.x, legRx, 14, dt);
    this.root.rotation.z = damp(this.root.rotation.z, rootZ, 8, dt);
    this.root.rotation.x = damp(this.root.rotation.x, lean, 8, dt);
    this.root.position.y = bob + breathe;
    this.head.rotation.z = damp(this.head.rotation.z, headTilt + Math.sin(p * 0.5) * 0.04 * walk, 6, dt);

    // Blink.
    this.blinkIn -= dt;
    const closed = this.blinkIn < 0.12;
    for (const e of this.eyes) e.scale.y = closed ? 0.15 : 1;
    if (this.blinkIn < 0) this.blinkIn = 2 + Math.random() * 4;
  }

  dispose() {
    // Geometries and materials are shared; nothing per-instance to free.
  }
}
