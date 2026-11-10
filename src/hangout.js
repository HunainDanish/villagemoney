// Hanging out at the plaza venues: sit on café chairs, hall benches and
// swings; order from the café menu; cheers; take photos; roll the dice; ride
// the Ferris wheel. Things others should see go out as reactions (bubbles).

const FOODS = [
  ['🍝', 'Pasta'], ['🍣', 'Sushi'], ['🍔', 'Burger'], ['🍰', 'Strawberry cake'], ['🍹', 'Berry mocktail'], ['🧃', 'Fresh juice'], ['☕', 'Coffee'],
];
// How high the character's feet sit so the hips land on the seat.
const SEAT_Y = { cafe: 1.0, hall: 1.0, swing: 1.3, sofa: 0.75 };

export class Hangout {
  constructor({ world, player, net, ui, sfx, particles, react, openSheet, closeSheet, bar }) {
    Object.assign(this, { world, player, net, ui, sfx, particles, react, openSheet, closeSheet, bar });
    this.riding = null;
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
          this.sfx.pickup();
          this.ui.toast(`${icon} Enjoy your ${name.toLowerCase()}!`);
        }),
      );
    });
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
    this.player.pos.y = 0;
    this.player.char.stop();
    this.bar.hidden = true;
    if (v) this.player.teleport(v.boarding.x, v.boarding.z, v.boarding.x * 1.5, v.boarding.z * 1.5);
    if (!byUser) this.ui.toast('🎡 Hope you enjoyed the ride!');
  }

  update(dt) {
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
