import * as THREE from 'three';

// Low-poly articulated character: torso, head with eyes and hair, arms with
// hands, legs with shoes. Procedural animation (no model files):
//   idle  - breathing, slow weight shift, blinking
//   walk  - opposite arm/leg swing, body bob and lean, scaled by speed
//   run   - bigger swing, more lean
//   chop  - two-handed overhead swing (used by woodcutting / mining)
//   wave  - one arm waving
// Animation blends smoothly between states, so nothing pops.

const SKIN = [0xf6d2b5, 0xe8b894, 0xc68a62, 0x9a6440, 0x6f4429];
const HAIR = [0x2b1d16, 0x5a3a22, 0x8a5a2b, 0xd9b26a, 0x1d1d22, 0xa23b2a];
const SHIRT = [0x3d7cf5, 0xe85d5d, 0x45b36b, 0xf2b134, 0x8e5cd9, 0x2bb3b3, 0xf07ab1, 0x4a4f5c];
const PANTS = [0x2f3a56, 0x3b3b3b, 0x5a4636, 0x2e5249, 0x6b6f7a];

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

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
  constructor({ seed = 'me', shadow = true, look = {} } = {}) {
    const h = hash(seed);
    const skin = look.skin ?? SKIN[h % SKIN.length];
    const hair = look.hair ?? HAIR[(h >>> 4) % HAIR.length];
    const shirt = look.shirt ?? SHIRT[(h >>> 8) % SHIRT.length];
    const pants = look.pants ?? PANTS[(h >>> 12) % PANTS.length];

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
    const hairMesh = new THREE.Mesh(G.hair, mat(hair));
    hairMesh.rotation.x = -0.25;
    hairMesh.position.y = 0.04;
    head.add(hairMesh);
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

    if (this.action) {
      const a = this.action;
      a.t += dt;
      if (a.type === 'chop') {
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
    this.legL.rotation.x = -swing * 1.05;
    this.legR.rotation.x = swing * 1.05;
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
