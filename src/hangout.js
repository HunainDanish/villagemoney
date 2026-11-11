import * as THREE from 'three';
import { makeDish } from './food.js';

// Hanging out at the plaza venues: sit on café chairs, hall benches and
// swings; order from the café menu; cheers; take photos; roll the dice; ride
// the Ferris wheel. Things others should see go out as reactions (bubbles).

const FOODS = [
  ['🍝', 'Pasta'], ['🍣', 'Sushi'], ['🍔', 'Burger'], ['🍰', 'Strawberry cake'], ['🍹', 'Berry mocktail'], ['🧃', 'Fresh juice'], ['☕', 'Coffee'],
];
// How high the character's feet sit so the hips land on the seat.
const SEAT_Y = { cafe: 1.0, hall: 1.0, swing: 1.3, sofa: 0.75, bench: 1.1 };

export class Hangout {
  constructor({ world, player, net, ui, sfx, particles, react, openSheet, closeSheet, bar }) {
    Object.assign(this, { world, player, net, ui, sfx, particles, react, openSheet, closeSheet, bar });
    this.riding = null;
    this.dishes = []; // { mesh, born, life }
    player.onStand = () => this.#standUp();
  }

  // ---------- seats ----------
  sit(seat) {
    this.stopRide();
    this.player.walkTo(seat.x, seat.z, 1.6, () => {
      this.player.sitOn(seat, SEAT_Y[seat.kind] ?? 1);
      this.player.char.play(seat.kind === 'swing' ? 'swing' : 'sit');
      this.world.swingSeat = seat.kind === 'swing' ? seat : null;
      this.sfx.click();
      this.#showBar(seat.kind);
    });
  }

  #standUp() {
    this.world.swingSeat = null;
    this.bar.hidden = true;
    if (this.world.interior) this.#showBar('room');
  }

  // ---------- visiting inside houses ----------
  // house = { id, x, z, facing, t, p, label }
  visit(house, doorPoint, onEnter) {
    this.stopRide();
    this.player.walkTo(doorPoint.x, doorPoint.z, 1.5, () => {
      const room = this.world.enterInterior(house.id, house.t, house.p);
      this.house = { ...house, doorPoint };
      this.net.regionOverride = `house:${house.id}`;
      this.player.teleport(room.door.x, room.door.z - 1, room.door.x, room.door.z - 6);
      this.sfx.click();
      this.ui.toast(`🏠 Welcome inside ${house.label || 'the house'}`);
      this.#showBar('room');
      onEnter?.();
    });
  }

  leaveHouse() {
    if (!this.world.interior) return;
    this.player.leaveSeat();
    this.world.exitInterior();
    this.net.regionOverride = null;
    const d = this.house.doorPoint;
    this.player.teleport(d.x, d.z, d.x + (d.x - this.house.x), d.z + (d.z - this.house.z));
    this.bar.hidden = true;
    this.house = null;
  }

  #showBar(kind) {
    const buttons = {
      cafe: [['menu', '🍽️ Menu'], ['cheers', '🥂 Cheers'], ['photo', '📸 Photo'], ['stand', 'Stand up']],
      hall: [['clap', '👏 Clap'], ['photo', '📸 Photo'], ['stand', 'Stand up']],
      swing: [['photo', '📸 Photo'], ['stand', 'Get off']],
      sofa: [['photo', '📸 Photo'], ['stand', 'Stand up']],
      bench: [['photo', '📸 Photo'], ['stand', 'Stand up']],
      room: [['photo', '📸 Photo'], ['leave', '🚪 Leave house']],
      ride: [['photo', '📸 Photo'], ['off', 'Get off']],
    }[kind];
    this.bar.innerHTML = buttons.map(([k, label]) => `<button class="btn ${k === 'stand' || k === 'off' ? '' : 'primary'}" data-k="${k}">${label}</button>`).join('');
    this.bar.hidden = false;
    this.bar.querySelectorAll('[data-k]').forEach((b) =>
      (b.onclick = () => {
        const k = b.dataset.k;
        if (k === 'menu') this.openMenu();
        else if (k === 'cheers') {
          this.react('cheers');
          this.player.char.play('clap');
          setTimeout(() => this.player.seat && this.player.char.play('sit'), 1700);
        } else if (k === 'clap') {
          this.react('clap');
          setTimeout(() => this.player.seat && this.player.char.play('sit'), 1700);
        } else if (k === 'photo') this.photo();
        else if (k === 'stand') this.player.leaveSeat();
        else if (k === 'off') this.stopRide(true);
        else if (k === 'leave') this.leaveHouse();
      }),
    );
  }

  openMenu() {
    this.openSheet('Café menu', (el) => {
      el.innerHTML = `<p>Order something: everyone nearby sees what you're having.</p><div class="grid">${FOODS.map(([icon, name], i) => `<button class="cell" data-f="${i}"><span class="ico">${icon}</span>${name}</button>`).join('')}</div>`;
      el.querySelectorAll('[data-f]').forEach((b) =>
        (b.onclick = () => {
          const [icon, name] = FOODS[Number(b.dataset.f)];
          this.closeSheet();
          this.react(`f${b.dataset.f}`);
          this.serve(this.player.seat, Number(b.dataset.f));
          this.sfx.pickup();
          this.ui.toast(`${icon} Enjoy your ${name.toLowerCase()}!`);
        }),
      );
    });
  }

  // ---------- food on the table ----------
  // A real little dish pops up on the table, in front of whoever ordered.
  serve(seat, i) {
    const t = seat?.table;
    if (!t) return;
    // Same spot again (a second order): replace what was there.
    const toward = Math.atan2(seat.x - t.x, seat.z - t.z);
    const x = t.x + Math.sin(toward) * 0.38;
    const z = t.z + Math.cos(toward) * 0.38;
    for (const d of this.dishes) if (Math.hypot(d.mesh.position.x - x, d.mesh.position.z - z) < 0.2) d.life = 0;
    const mesh = makeDish(i);
    mesh.position.set(x, t.y, z);
    mesh.rotation.y = toward;
    mesh.scale.setScalar(0.01);
    this.world.scene.add(mesh);
    this.dishes.push({ mesh, born: 0, life: 120 });
    this.particles.burst(x, t.y + 0.3, z, { n: 10, colors: [0xffffff, 0xffd166], size: 0.18, speed: 2, up: 2, life: 0.6, gravity: 4, spin: 2 });
  }

  // Someone else ordered (their reaction arrived): serve it at their table.
  serveNear(x, z, i) {
    const seat = this.world.venues?.seats?.filter((s) => s.table).reduce((best, s) => {
      const d = Math.hypot(s.x - x, s.z - z);
      return d < 1.6 && (!best || d < best.d) ? { s, d } : best;
    }, null)?.s;
    if (seat) this.serve(seat, i);
  }

  #updateDishes(dt) {
    for (const d of this.dishes) {
      d.born += dt;
      d.life -= dt;
      // Pop in with a little overshoot, shrink away at the end.
      const k = Math.min(1, d.born / 0.45);
      const pop = k < 1 ? k + Math.sin(k * Math.PI) * 0.3 : 1;
      const s = Math.max(0.01, Math.min(pop, d.life / 0.5));
      d.mesh.scale.setScalar(s * 1.35);
      if (d.life <= 0) {
        this.world.scene.remove(d.mesh);
        d.mesh.traverse((o) => {
          o.geometry?.dispose();
          o.material?.dispose?.();
        });
      }
    }
    this.dishes = this.dishes.filter((d) => d.life > 0);
  }

  // ---------- photos ----------
  // Render one frame and save it right away (the canvas is only readable
  // straight after drawing).
  photo() {
    this.sfx.click();
    document.body.classList.add('flash');
    setTimeout(() => document.body.classList.remove('flash'), 250);
    this.world.render(this.player.body);
    const url = this.world.renderer.domElement.toDataURL('image/jpeg', 0.92);
    this.openSheet('📸 Your photo', (el) => {
      el.innerHTML = `<img src="${url}" alt="Your photo of the town" style="width:100%;border-radius:12px;display:block" />
        <div class="stack"><a class="btn primary" href="${url}" download="town-photo.jpg">⬇️ Save photo</a></div>
        <p>Share it on your story and tag the town!</p>`;
    });
  }

  // ---------- dice ----------
  rollDice() {
    const table = this.world.venues;
    if (!table) return;
    const n = 1 + Math.floor(Math.random() * 6);
    table.rollDie(n);
    this.sfx.click();
    setTimeout(() => this.sfx.click(), 120);
    this.react(`d${n}`);
  }

  // ---------- Ferris wheel ----------
  ride() {
    const v = this.world.venues;
    if (!v || this.riding) return;
    this.player.walkTo(v.boarding.x, v.boarding.z, 1.5, () => {
      this.player.leaveSeat();
      this.riding = { cabin: v.lowestCabin(), t: 0 };
      this.player.riding = true;
      document.body.classList.add('riding');
      this.player.char.play('ride');
      this.sfx.level();
      this.ui.toast('🎡 Enjoy the view! The ride takes about 40 seconds.');
      this.#showBar('ride');
    });
  }

  stopRide(byUser = false) {
    if (!this.riding) return;
    const v = this.world.venues;
    this.riding = null;
    this.player.riding = false;
    document.body.classList.remove('riding');
    this.player.pos.y = 0;
    this.player.char.stop();
    this.bar.hidden = true;
    if (v) this.player.teleport(v.boarding.x, v.boarding.z, v.boarding.x * 1.5, v.boarding.z * 1.5);
    if (!byUser) this.ui.toast('🎡 Hope you enjoyed the ride!');
  }

  update(dt) {
    this.#updateDishes(dt);
    // Walked out through the door.
    const room = this.world.interior;
    if (room && this.player.pos.z > room.exitZ) this.leaveHouse();
    if (!this.riding) return;
    const v = this.world.venues;
    this.riding.t += dt;
    const p = v.cabinWorld(this.riding.cabin);
    this.player.pos.set(p.x, p.y, p.z);
    // One full turn (about 42 s), then off at the bottom.
    if (this.riding.t > 41) this.stopRide();
  }
}
