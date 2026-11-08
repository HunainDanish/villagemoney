import * as THREE from 'three';

// Particles (wood chips, leaves, dust, sparkles, splashes) from one pooled
// InstancedMesh, plus tiny synthesized sound effects (Web Audio, no files).

const MAX = 400;

export class Particles {
  constructor(scene) {
    this.mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshLambertMaterial({ color: 0xffffff }),
      MAX,
    );
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.setColorAt(0, new THREE.Color());
    scene.add(this.mesh);
    this.list = [];
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.e = new THREE.Euler();
    this.c = new THREE.Color();
  }

  burst(x, y, z, { n = 10, color = 0xffffff, colors = null, size = 0.25, speed = 5, up = 4, life = 0.9, gravity = 14, spin = 8 } = {}) {
    for (let i = 0; i < n && this.list.length < MAX; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.6);
      this.list.push({
        p: new THREE.Vector3(x, y, z),
        v: new THREE.Vector3(Math.cos(a) * s, up * (0.5 + Math.random()), Math.sin(a) * s),
        r: new THREE.Vector3(Math.random() * 6, Math.random() * 6, Math.random() * 6),
        spin: spin * (Math.random() - 0.5),
        size: size * (0.6 + Math.random() * 0.8),
        color: colors ? colors[(Math.random() * colors.length) | 0] : color,
        life,
        t: 0,
        gravity,
      });
    }
  }

  chips(x, y, z) {
    this.burst(x, y, z, { n: 9, colors: [0xd9b98a, 0xb88a55, 0x8a5a2b], size: 0.22, speed: 6, up: 5 });
  }
  leaves(x, y, z) {
    this.burst(x, y, z, { n: 8, colors: [0x5aa04a, 0x7cc35d, 0x3f8a3a], size: 0.3, speed: 3, up: 1, life: 2.2, gravity: 2.5, spin: 4 });
  }
  dust(x, z) {
    this.burst(x, 0.2, z, { n: 3, color: 0xd8cbb0, size: 0.28, speed: 1.5, up: 1.2, life: 0.5, gravity: 1 });
  }
  sparkle(x, y, z) {
    this.burst(x, y, z, { n: 16, colors: [0xffd36b, 0xffffff, 0xffb800], size: 0.18, speed: 4, up: 6, life: 1, gravity: 6 });
  }
  splash(x, z) {
    this.burst(x, 0.3, z, { n: 14, colors: [0x9fd6ff, 0xffffff], size: 0.18, speed: 3, up: 6, life: 0.8, gravity: 16 });
  }
  stones(x, y, z) {
    this.burst(x, y, z, { n: 9, colors: [0x9a9a9a, 0xc0c0c0, 0x9fd6ff], size: 0.22, speed: 6, up: 5 });
  }

  update(dt) {
    let k = 0;
    const keep = [];
    for (const p of this.list) {
      p.t += dt;
      if (p.t >= p.life) continue;
      p.v.y -= p.gravity * dt;
      p.p.addScaledVector(p.v, dt);
      if (p.p.y < 0.05) {
        p.p.y = 0.05;
        p.v.set(p.v.x * 0.5, 0, p.v.z * 0.5);
      }
      p.r.x += p.spin * dt;
      p.r.y += p.spin * dt;
      const s = p.size * (1 - (p.t / p.life) ** 3);
      this.q.setFromEuler(this.e.set(p.r.x, p.r.y, p.r.z));
      this.m.compose(p.p, this.q, new THREE.Vector3(s, s, s));
      this.mesh.setMatrixAt(k, this.m);
      this.mesh.setColorAt(k, this.c.setHex(p.color));
      k++;
      keep.push(p);
    }
    this.list = keep;
    this.mesh.count = k;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

// ---------- sound ----------
let ctx = null;
let muted = false;
try {
  muted = localStorage.getItem('pl_muted') === '1';
} catch {
  /* storage blocked */
}

export const isMuted = () => muted;
export function setMuted(v) {
  muted = v;
  try {
    localStorage.setItem('pl_muted', v ? '1' : '0');
  } catch {
    /* ignore */
  }
}

function ac() {
  if (muted) return null;
  if (!ctx) {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    ctx = new C();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function noise(a, dur, { freq = 800, q = 1, gain = 0.4, type = 'bandpass' } = {}) {
  const len = Math.floor(a.sampleRate * dur);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = a.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g).connect(a.destination);
  src.start();
}

function tone(a, freq, dur, { type = 'sine', gain = 0.2, delay = 0, slide = 0 } = {}) {
  const o = a.createOscillator();
  const g = a.createGain();
  const t = a.currentTime + delay;
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.05);
}

export const sfx = {
  chop() {
    const a = ac();
    if (!a) return;
    noise(a, 0.12, { freq: 900, q: 2, gain: 0.5 });
    tone(a, 140, 0.12, { type: 'triangle', gain: 0.35, slide: 0.6 });
  },
  mine() {
    const a = ac();
    if (!a) return;
    noise(a, 0.08, { freq: 3000, q: 4, gain: 0.35 });
    tone(a, 1200, 0.1, { type: 'square', gain: 0.06, slide: 0.8 });
  },
  fall() {
    const a = ac();
    if (!a) return;
    noise(a, 0.6, { freq: 300, q: 0.7, gain: 0.5, type: 'lowpass' });
    tone(a, 90, 0.4, { type: 'sine', gain: 0.4, delay: 0.35, slide: 0.5 });
  },
  pickup() {
    const a = ac();
    if (!a) return;
    tone(a, 660, 0.1, { gain: 0.15 });
    tone(a, 990, 0.14, { gain: 0.15, delay: 0.08 });
  },
  splash() {
    const a = ac();
    if (!a) return;
    noise(a, 0.4, { freq: 1500, q: 0.5, gain: 0.35 });
  },
  bite() {
    const a = ac();
    if (!a) return;
    tone(a, 880, 0.08, { type: 'square', gain: 0.08 });
    tone(a, 880, 0.08, { type: 'square', gain: 0.08, delay: 0.12 });
  },
  level() {
    const a = ac();
    if (!a) return;
    [523, 659, 784, 1046].forEach((f, i) => tone(a, f, 0.25, { type: 'triangle', gain: 0.15, delay: i * 0.1 }));
  },
  click() {
    const a = ac();
    if (!a) return;
    tone(a, 440, 0.05, { gain: 0.08 });
  },
};

// Floating "+2 🪵" text over the world.
export function floatText(layer, camera, pos, text) {
  const el = document.createElement('div');
  el.className = 'float-text';
  el.textContent = text;
  layer.append(el);
  const start = performance.now();
  const p = pos.clone();
  const v = new THREE.Vector3();
  const step = () => {
    const k = (performance.now() - start) / 1200;
    if (k >= 1) return el.remove();
    v.copy(p).setY(p.y + k * 3).project(camera);
    el.style.opacity = String(1 - k * k);
    el.style.transform = `translate(-50%,-50%) translate(${((v.x + 1) / 2) * innerWidth}px,${((1 - v.y) / 2) * innerHeight}px)`;
    requestAnimationFrame(step);
  };
  step();
}
