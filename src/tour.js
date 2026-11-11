import { planRoute } from './nav.js';
import { BOULEVARD, villaDoor } from './centre.js';
import { PITCH } from '../shared/layout.js';

// The town tour (▶ Tour): one press walks you through the whole centre on
// its own: out to the West District gate, straight down Main Boulevard (no
// turns, nothing to climb over) to the East District gate, back to the
// middle, up to a villa, and home to the fountain. Any move of your own, or
// Stop, ends it.

const STOPS = [
  { at: (x) => x < -PITCH / 2, text: '🏘️ West District · 250 homes' },
  { at: (x) => x > PITCH / 2, text: '🏘️ East District · 250 homes' },
  { at: () => true, text: '🛣️ Main Boulevard · the plaza is north, the villas south' },
];

export class Tour {
  constructor({ player, nav, bar, onEnd }) {
    Object.assign(this, { player, nav, bar, onEnd });
    this.points = null;
    bar.querySelector('.tour-stop').onclick = () => this.stop();
  }

  get active() {
    return Boolean(this.points);
  }

  start() {
    this.nav.stop();
    this.player.leaveSeat();
    const p = this.player.pos;
    const z = BOULEVARD.z;
    const west = { x: BOULEVARD.x0 + 14, z, say: '🚩 West gate: the tour runs straight along Main Boulevard' };
    const east = { x: BOULEVARD.x1 - 14, z, say: '🚩 East gate: turning back to the middle' };
    const mid = { x: -36, z, say: '🏛️ Up to the villas: the whole town builds them together' };
    const door = { ...villaDoor(0, 5), say: '🌅 Sunset Villa: tap a villa to add a brick' };
    const home = { x: 0, z: 14, say: '⛲ Back at the fountain. Tour complete!' };
    const route = (a, b) => planRoute(a, b).slice(1, -1); // the in-between corners
    this.points = [
      ...route({ x: p.x, z: p.z }, west).map((q) => ({ x: q.x, z: q.z })),
      west,
      east,
      mid,
      door,
      ...route(door, home).map((q) => ({ x: q.x, z: q.z })),
      home,
    ].filter((q, i, a) => i === 0 || Math.hypot(q.x - a[i - 1].x, q.z - a[i - 1].z) > 0.5);
    this.wasRunning = this.player.runToggle;
    this.player.runToggle = true;
    this.i = 0;
    this.bar.hidden = false;
    document.body.classList.add('touring');
    this.#say('🧭 Town tour: sit back, we walk you round. Move to take over.');
    this.#next();
  }

  stop(done = false) {
    if (!this.points) return;
    this.points = null;
    this.player.target = null;
    this.player.runToggle = this.wasRunning;
    this.bar.hidden = true;
    document.body.classList.remove('touring');
    this.onEnd?.(done);
  }

  #say(text) {
    this.bar.querySelector('.tour-text').textContent = text;
  }

  #next() {
    const q = this.points[this.i];
    if (!q) return this.stop(true);
    this.player.target = { x: q.x, z: q.z, range: 0.8, tour: true };
  }

  update() {
    if (!this.points) return;
    const pl = this.player;
    // Took the controls: the tour ends.
    if (pl.keys.size || (pl.joy && pl.joy.length > 0.12)) return this.stop();
    const q = this.points[this.i];
    if (Math.hypot(pl.pos.x - q.x, pl.pos.z - q.z) < 1.2) {
      if (q.say) this.#say(q.say);
      this.i++;
      return this.#next();
    }
    // Something cancelled the walk (a tap elsewhere): end the tour.
    if (!pl.target?.tour) return this.stop();
    // Along the boulevard: say where we are.
    if (Math.abs(pl.pos.z - BOULEVARD.z) < 3 && this.i > 0) {
      const text = STOPS.find((s) => s.at(pl.pos.x)).text;
      // Leave a stop's own message up for a few steps first.
      const prev = this.points[this.i - 1];
      const fresh = prev.say && Math.hypot(pl.pos.x - prev.x, pl.pos.z - prev.z) < 14;
      if (!fresh && this.bar.querySelector('.tour-text').textContent !== text) this.#say(text);
    }
  }
}
