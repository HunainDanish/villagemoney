import * as THREE from 'three';
import { VENUES } from '../shared/nodes.js';

// Plaza venues for houses-only mode: a café terrace, a community hall with a
// stage and big screen, a Ferris wheel and a playground (swings + dice table).
// Seats are tagged with userData.seat so a tap can find them.

const lam = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra });
const box = (w, h, d, color) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), lam(color));
function at(mesh, x, y, z, ry = 0) {
  mesh.position.set(x, y, z);
  mesh.rotation.y = ry;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// A big screen that shows text, redrawn from a canvas.
function makeScreen(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = Math.round((512 * h) / w);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  const draw = (lines) => {
    const g = canvas.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, canvas.height);
    grad.addColorStop(0, '#1d2b55');
    grad.addColorStop(1, '#2f6fe0');
    g.fillStyle = grad;
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.textAlign = 'center';
    g.fillStyle = '#fff';
    lines.forEach((line, i) => {
      g.font = `${i === 0 ? 900 : 700} ${i === 0 ? 40 : 28}px Nunito, system-ui, sans-serif`;
      g.fillText(line, canvas.width / 2, 58 + i * 46, canvas.width - 30);
    });
    tex.needsUpdate = true;
  };
  return { mesh, draw };
}

export function buildVenues() {
  const group = new THREE.Group();
  const seats = [];
  const seat = (mesh, x, z, h, kind) => {
    mesh.userData.seat = { x, z, h, kind };
    seats.push(mesh.userData.seat);
    return mesh;
  };

  // ---------- café terrace ----------
  const C = VENUES.cafe;
  const cafe = new THREE.Group();
  cafe.position.set(C.x, 0, C.z);
  cafe.add(at(box(C.hw * 2, 0.12, C.hd * 2, 0xc9a27e), 0, 0.06, 0)); // wooden deck
  // Counter with an awning at the back.
  cafe.add(at(box(6, 1.6, 1.4, 0x9a6b42), 0, 0.8, -C.hd + 1));
  cafe.add(at(box(6.4, 0.18, 2.2, 0xf2efe8), 0, 1.7, -C.hd + 1));
  for (let i = 0; i < 6; i++) cafe.add(at(box(1.1, 0.14, 2.6, i % 2 ? 0xffffff : 0x2f7f86), -2.75 + i * 1.1, 4.1, -C.hd + 1.6));
  for (const x of [-3, 3]) cafe.add(at(box(0.25, 4, 0.25, 0x5a4636), x, 2, -C.hd + 2.8));
  const sign = makeScreen(4, 0.9);
  sign.mesh.position.set(0, 4.75, -C.hd + 2.95);
  sign.draw(['☕ Café']);
  cafe.add(sign.mesh);
  // Four tables with two chairs each (chairs face the table).
  [[-3, 0.5], [3, 0.5], [-3, 3.4], [3, 3.4]].forEach(([tx, tz]) => {
    cafe.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.1, 16), lam(0xf2efe8)), tx, 1.2, tz));
    cafe.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 1.15, 8), lam(0x3a3f4a)), tx, 0.6, tz));
    cafe.add(at(new THREE.Mesh(new THREE.ConeGeometry(1.5, 0.9, 10), lam(0xe85d5d)), tx, 3.6, tz));
    cafe.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.5, 6), lam(0xdddddd)), tx, 2.4, tz));
    for (const side of [-1, 1]) {
      const cx = tx + side * 1.25;
      const chair = at(box(0.8, 0.12, 0.8, 0x2f7f86), cx, 0.75, tz);
      chair.add(at(box(0.12, 0.9, 0.8, 0x2f7f86), side * 0.35, 0.5, 0));
      // Seat point: on the chair, facing the table.
      cafe.add(seat(chair, C.x + cx, C.z + tz, side > 0 ? -Math.PI / 2 : Math.PI / 2, 'cafe'));
    }
  });
  group.add(cafe);

  // ---------- community hall (open pavilion) ----------
  const H = VENUES.hall;
  const hall = new THREE.Group();
  hall.position.set(H.x, 0, H.z);
  hall.add(at(box(H.hw * 2, 0.2, H.hd * 2, 0xe9e4da), 0, 0.1, 0));
  for (const [x, z] of [[-H.hw + 0.3, -H.hd + 0.3], [H.hw - 0.3, -H.hd + 0.3], [-H.hw + 0.3, H.hd - 0.3], [H.hw - 0.3, H.hd - 0.3]]) {
    hall.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, 5.6, 10), lam(0xf7f3ea)), x, 2.8, z));
  }
  const roof = at(new THREE.Mesh(new THREE.ConeGeometry(Math.hypot(H.hw, H.hd) + 1.2, 2.6, 4), lam(0x4f6d9a, { flatShading: true })), 0, 6.9, 0, Math.PI / 4);
  roof.scale.set(1, 1, H.hd / H.hw);
  hall.add(roof);
  hall.add(at(box(H.hw * 2 - 1, 0.6, 3, 0x9a6b42), 0, 0.5, -H.hd + 1.6)); // stage
  const screen = makeScreen(7, 3.4);
  screen.mesh.position.set(0, 3.3, -H.hd + 0.3);
  hall.add(screen.mesh);
  for (let row = 0; row < 3; row++) {
    for (let col = -1; col <= 1; col++) {
      const bx = col * 3.4;
      const bz = 0.6 + row * 1.6;
      const bench = at(box(2.6, 0.18, 0.6, 0xa8774a), bx, 0.75, bz);
      bench.add(at(box(2.6, 0.6, 0.12, 0xa8774a), 0, 0.4, 0.3));
      hall.add(seat(bench, H.x + bx, H.z + bz, Math.PI, 'hall')); // facing the stage
    }
  }
  group.add(hall);

  // ---------- Ferris wheel ----------
  const W = VENUES.wheel;
  const wheelBase = new THREE.Group();
  wheelBase.position.set(W.x, 0, W.z);
  wheelBase.rotation.y = Math.atan2(-W.x, -W.z); // wheel faces the fountain
  const R = 8;
  const hub = 9.5;
  for (const side of [-1, 1]) {
    for (const lean of [-1, 1]) {
      const leg = at(box(0.35, 10.5, 0.35, 0xf7f3ea), lean * 2.4, 4.9, side * 1.3);
      leg.rotation.z = lean * -0.24;
      wheelBase.add(leg);
    }
  }
  wheelBase.add(at(box(6, 0.3, 3.4, 0xb9b2a5), 0, 0.15, 0)); // platform
  const wheel = new THREE.Group();
  wheel.position.y = hub;
  for (const side of [-0.9, 0.9]) {
    const rim = new THREE.Mesh(new THREE.TorusGeometry(R, 0.14, 6, 40), lam(0xe85d24));
    rim.position.z = side;
    wheel.add(rim);
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const spoke = box(0.12, R, 0.12, 0xf7f3ea);
    spoke.position.set(Math.cos(a) * (R / 2), Math.sin(a) * (R / 2), 0);
    spoke.rotation.z = a - Math.PI / 2;
    wheel.add(spoke);
  }
  wheelBase.add(wheel);
  const cabins = [];
  const cabinColors = [0xe85d5d, 0x3d7cf5, 0xf2b134, 0x45b36b, 0x8e5cd9, 0x2bb3b3, 0xf07ab1, 0xff8a3d];
  for (let i = 0; i < 8; i++) {
    const cabin = new THREE.Group();
    cabin.add(at(box(1.6, 1.1, 1.4, cabinColors[i]), 0, -1.2, 0));
    cabin.add(at(box(1.8, 0.15, 1.6, 0xf7f3ea), 0, -0.55, 0));
    cabin.userData.ride = true;
    cabin.userData.box = cabin.children[0];
    wheelBase.add(cabin);
    cabins.push(cabin);
  }
  group.add(wheelBase);

  // ---------- playground: two swings and a dice table ----------
  const P = VENUES.playground;
  const play = new THREE.Group();
  play.position.set(P.x, 0, P.z);
  for (const x of [-4.6, -0.6]) play.add(at(box(0.25, 4.2, 0.25, 0x3d7cf5), x, 2.1, 0));
  play.add(at(box(4.4, 0.25, 0.25, 0x3d7cf5), -2.6, 4.2, 0));
  const swings = [];
  for (const x of [-3.6, -1.6]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 4.1, 0);
    for (const dx of [-0.35, 0.35]) pivot.add(at(box(0.04, 3, 0.04, 0x8a8a8a), dx, -1.5, 0));
    const s = at(box(0.9, 0.1, 0.5, 0xf2b134), 0, -3, 0);
    pivot.add(s);
    play.add(pivot);
    swings.push(pivot);
    s.userData.seat = { x: P.x + x, z: P.z, h: 0, kind: 'swing', pivot };
    seats.push(s.userData.seat);
  }
  const table = at(new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.12, 14), lam(0x45b36b)), 3, 1.1, 0);
  table.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 1.1, 8), lam(0x3a3f4a)), 0, -0.55, 0));
  const die = at(box(0.45, 0.45, 0.45, 0xffffff), 0, 0.3, 0);
  table.add(die);
  table.userData.dice = true;
  die.userData.dice = true;
  play.add(table);
  group.add(play);

  let spin = 0;
  return {
    group,
    seats,
    screens: [screen],
    cabins,
    // World position of cabin i (for riding).
    cabinWorld(i, out = new THREE.Vector3()) {
      return cabins[i].getWorldPosition(out).add(new THREE.Vector3(0, -1.5, 0));
    },
    lowestCabin() {
      let best = 0;
      let y = Infinity;
      const v = new THREE.Vector3();
      cabins.forEach((c, i) => {
        c.getWorldPosition(v);
        if (v.y < y) {
          y = v.y;
          best = i;
        }
      });
      return best;
    },
    boarding: { x: W.x - Math.sin(Math.atan2(-W.x, -W.z)) * -4, z: W.z - Math.cos(Math.atan2(-W.x, -W.z)) * -4 },
    rollDie(n) {
      const r = [
        [0, 0, 0], [0, 0, Math.PI / 2], [Math.PI / 2, 0, 0], [-Math.PI / 2, 0, 0], [0, 0, -Math.PI / 2], [Math.PI, 0, 0],
      ][n - 1];
      die.rotation.set(...r);
    },
    // Night lights on the wheel (a town goal): cabins glow after dark.
    setLights(on) {
      for (const c of cabins) {
        const m = c.userData.box.material;
        m.emissive.setHex(on ? m.color.getHex() : 0x000000);
        m.emissiveIntensity = on ? 0.8 : 0;
      }
    },
    update(t, dt, swingingSeat) {
      spin += dt * 0.15;
      wheel.rotation.z = spin;
      cabins.forEach((c, i) => {
        const a = spin + (i / 8) * Math.PI * 2;
        c.position.set(Math.cos(a) * R, hub + Math.sin(a) * R, 0);
      });
      for (const p of swings) p.rotation.x = p === swingingSeat?.pivot ? Math.sin(t * 2.4) * 0.5 : Math.sin(t * 0.8 + p.position.x) * 0.04;
    },
  };
}
