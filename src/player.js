import * as THREE from 'three';
import { Character } from './character.js';
import { carGeometry } from './props.js';
import { CARS } from '../shared/life.js';

const damp = THREE.MathUtils.damp;

function readPref(k) {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function writePref(k, v) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* storage blocked */
  }
}

// Keyboard (WASD / arrows, Shift to run), tap to walk or interact, drag to
// turn, wheel / pinch to zoom. Camera follows with damping and looks slightly
// ahead of where you are walking. Collision is delegated to world.blocked().
export class Player {
  constructor(world, canvas, { onTap, onStep }) {
    this.world = world;
    this.char = new Character({ seed: 'me', shadow: true });
    world.scene.add(this.char.group);
    this.pos = new THREE.Vector3(0, 0, -22); // south of the fountain, facing it
    this.heading = 0;
    this.char.heading = 0;
    this.yaw = Math.PI; // camera yaw around the player (behind you at the start)
    this.zoom = innerWidth < innerHeight ? 1.45 : 1;
    // Camera: 'street' = low, close behind you; 'high' = the overview angle.
    this.camMode = readPref('pl_cam') || 'street';
    this.joy = null; // on-screen joystick (phones)
    this.runToggle = false; // Run button
    this.dragging = false;
    this.keys = new Set();
    this.target = null; // { x, z, range, onArrive }
    this.moving = false;
    this.speed = 0;
    this.onTap = onTap;
    this.onStep = onStep;
    this.onCancel = () => {};
    this.camPos = new THREE.Vector3();
    this.camLook = new THREE.Vector3();
    this.camReady = false;
    this.stepAcc = 0;

    addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      const k = e.key.toLowerCase();
      this.keys.add(k);
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) this.cancel();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    addEventListener('blur', () => this.keys.clear());
    canvas.addEventListener('wheel', (e) => {
      this.zoom = THREE.MathUtils.clamp(this.zoom * (e.deltaY > 0 ? 1.1 : 0.9), 0.5, 2.2);
    }, { passive: true });

    let down = null;
    const touches = new Map();
    let pinch = null;
    const spread = () => {
      const [a, b] = [...touches.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    const lift = (e) => {
      touches.delete(e.pointerId);
      if (touches.size < 2) pinch = null;
    };
    canvas.addEventListener('pointercancel', lift);
    canvas.addEventListener('pointerdown', (e) => {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 2) {
        pinch = { d: spread(), zoom: this.zoom };
        down = null;
        return;
      }
      down = { x: e.clientX, y: e.clientY, yaw: this.yaw, dragged: false };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.dragging = Boolean(down?.dragged);
      if (pinch) {
        this.zoom = THREE.MathUtils.clamp(pinch.zoom * (pinch.d / Math.max(1, spread())), 0.5, 2.2);
        return;
      }
      if (!down) return;
      const dx = e.clientX - down.x;
      if (Math.abs(dx) > 6 || Math.abs(e.clientY - down.y) > 6) down.dragged = true;
      if (down.dragged) this.yaw = down.yaw - dx * 0.008;
    });
    canvas.addEventListener('pointerup', (e) => {
      lift(e);
      this.dragging = false;
      if (down && !down.dragged) {
        const hit = world.pick((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
        if (hit) this.onTap(hit);
      }
      down = null;
    });
  }

  // Drive a car (model id) or walk again (null). While driving you move at the
  // car's speed and are drawn as the car.
  setVehicle(model) {
    if (this.carMesh) {
      this.world.scene.remove(this.carMesh);
      this.carMesh = null;
    }
    this.vehicle = CARS[model] ? model : null;
    if (this.vehicle) {
      const mesh = new THREE.Mesh(carGeometry(model), new THREE.MeshLambertMaterial({ vertexColors: true, color: CARS[model].color }));
      mesh.castShadow = true;
      mesh.position.copy(this.pos);
      mesh.rotation.y = this.char.heading;
      this.world.scene.add(mesh);
      this.carMesh = mesh;
    }
    this.char.group.visible = !this.vehicle;
  }

  // What to draw for the player (used by the see-through-houses outline).
  get body() {
    return this.carMesh || this.char.group;
  }

  // Look like other players see you: your chosen look, or one from your name.
  setName(name) {
    this.setLook(name, this.avatar);
  }

  setLook(name, avatar = null) {
    const key = `${name}|${avatar ? Object.values(avatar).join('.') : ''}`;
    if (key === this.lookKey) return;
    this.lookKey = key;
    this.lookName = name;
    this.avatar = avatar;
    const old = this.char;
    this.char = new Character({ seed: name, shadow: true, avatar });
    if (this.ghost) this.char.setGhost(true);
    this.char.heading = old.heading;
    this.char.group.position.copy(old.group.position);
    this.char.group.rotation.y = old.group.rotation.y;
    this.world.scene.remove(old.group);
    this.world.scene.add(this.char.group);
    this.char.group.visible = !this.vehicle; // stay hidden while driving
  }

  toggleCamera() {
    this.camMode = this.camMode === 'street' ? 'high' : 'street';
    writePref('pl_cam', this.camMode);
    return this.camMode;
  }

  // Walk to (x, z); call onArrive when within `range`.
  walkTo(x, z, range = 0.8, onArrive = null) {
    this.cancel();
    this.target = { x, z, range, onArrive };
  }

  // Stop walking and stop any activity.
  cancel() {
    this.target = null;
    this.leaveSeat();
    this.onCancel();
  }

  // Sit on a chair / bench / swing: stay put until you move.
  sitOn(seat, y) {
    this.target = null;
    this.seat = seat;
    this.seatY = y;
    this.pos.set(seat.x, 0, seat.z);
    this.heading = seat.h;
    this.char.heading = seat.h;
  }

  leaveSeat() {
    if (!this.seat) return;
    const h = this.seat.h;
    this.seat = null;
    this.seatY = 0;
    this.char.stop();
    // Step back off the seat.
    this.pos.x -= Math.sin(h) * 1.3;
    this.pos.z -= Math.cos(h) * 1.3;
    this.onStand?.();
  }

  teleport(x, z, faceX, faceZ) {
    this.cancel();
    this.pos.set(x, 0, z);
    if (faceX !== undefined) this.heading = Math.atan2(faceX - x, faceZ - z);
    this.char.heading = this.heading;
    this.yaw = this.heading + Math.PI;
    this.camReady = false;
  }

  face(x, z) {
    this.heading = Math.atan2(x - this.pos.x, z - this.pos.z);
  }

  update(dt) {
    const k = this.keys;
    let fx = 0;
    let fz = 0;
    if (k.has('w') || k.has('arrowup')) fz -= 1;
    if (k.has('s') || k.has('arrowdown')) fz += 1;
    if (k.has('a') || k.has('arrowleft')) fx -= 1;
    if (k.has('d') || k.has('arrowright')) fx += 1;

    // Joystick (phones): push direction relative to the camera, like WASD.
    let analog = 1;
    if (!fx && !fz && this.joy && this.joy.length > 0.12) {
      fx = this.joy.value.x;
      fz = this.joy.value.y;
      analog = Math.min(1, this.joy.length * 1.15);
      this.target = null;
    }

    // Seated or riding: any move input stands you up (riding ends via Get off).
    if (this.seat && (fx || fz)) this.leaveSeat();
    if (this.seat || this.riding) {
      fx = 0;
      fz = 0;
      this.target = null;
    }

    let dir = null;
    if (fx || fz) {
      const s = Math.sin(this.yaw);
      const c = Math.cos(this.yaw);
      dir = new THREE.Vector2(fx * c + fz * s, -fx * s + fz * c).normalize();
    } else if (this.target) {
      const d = new THREE.Vector2(this.target.x - this.pos.x, this.target.z - this.pos.z);
      if (d.length() <= this.target.range) {
        const t = this.target;
        this.target = null;
        this.face(t.x, t.z);
        t.onArrive?.();
      } else dir = d.normalize();
    }

    const running = this.runToggle || k.has('shift') || (this.target && Math.hypot(this.target.x - this.pos.x, this.target.z - this.pos.z) > 30);
    const want = dir ? (this.vehicle ? CARS[this.vehicle].speed * (running ? 1.25 : 1) : running ? 26 : 14) : 0;
    this.speed = damp(this.speed, want * analog, 10, dt);
    this.moving = Boolean(dir);
    if (dir) {
      const step = this.speed * dt;
      const nx = this.pos.x + dir.x * step;
      const nz = this.pos.z + dir.y * step;
      const before = { x: this.pos.x, z: this.pos.z };
      // Already inside something (e.g. after a teleport)? Let them walk out.
      const stuck = this.world.blocked(this.pos.x, this.pos.z);
      if (stuck || !this.world.blocked(nx, this.pos.z)) this.pos.x = nx;
      if (stuck || !this.world.blocked(this.pos.x, nz)) this.pos.z = nz;
      // Only real progress counts (sliding by zero along a wall doesn't).
      const moved = Math.hypot(this.pos.x - before.x, this.pos.z - before.z) > step * 0.2;
      if (!moved && this.target && !this.target.onArrive) this.target = null;
      if (!moved && this.target?.onArrive && Math.hypot(this.target.x - this.pos.x, this.target.z - this.pos.z) < this.target.range + 2.5) {
        // Close enough to interact even if something is in the way.
        const t = this.target;
        this.target = null;
        this.face(t.x, t.z);
        t.onArrive();
      }
      this.heading = Math.atan2(dir.x, dir.y);
      this.stepAcc += step;
      if (this.stepAcc > (running ? 3 : 4.5)) {
        this.stepAcc = 0;
        this.onStep?.(this.pos.x, this.pos.z, running);
      }
    }

    this.char.group.position.copy(this.pos);
    if (this.seat) this.char.group.position.y = this.seatY;
    this.char.face(this.heading, dt);
    this.char.update(dt, this.moving ? this.speed : 0);
    if (this.carMesh) {
      this.carMesh.position.copy(this.pos).setY(0.3);
      this.carMesh.rotation.y = this.char.heading;
    }

    // Camera. Street: low and close, swings in behind you as you move.
    // High: the overview angle (about 45 degrees down).
    const street = this.camMode === 'street';
    if (street && this.moving && !this.dragging) {
      let d = this.heading + Math.PI - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * (1 - Math.exp(-(this.vehicle ? 3 : 2.2) * dt));
    }
    const car = this.vehicle ? 1.35 : 1;
    const dist = (street ? 11 : 30) * this.zoom * car;
    const height = (street ? (4.2 + 3.2 * this.zoom) * car : 28 * this.zoom + 3) + this.pos.y;
    const ahead = this.moving ? (street ? 5 : 3) : street ? 2 : 0;
    const lookX = this.pos.x + Math.sin(this.heading) * ahead;
    const lookZ = this.pos.z + Math.cos(this.heading) * ahead;
    const lookY = (street ? 2.6 : 3) + this.pos.y;
    const tx = this.pos.x + Math.sin(this.yaw) * dist;
    const tz = this.pos.z + Math.cos(this.yaw) * dist;
    if (!this.camReady) {
      this.camPos.set(tx, height, tz);
      this.camLook.set(lookX, lookY, lookZ);
      this.camReady = true;
    }
    this.camPos.set(damp(this.camPos.x, tx, 6, dt), damp(this.camPos.y, height, 6, dt), damp(this.camPos.z, tz, 6, dt));
    this.camLook.set(damp(this.camLook.x, lookX, 10, dt), damp(this.camLook.y, lookY, 6, dt), damp(this.camLook.z, lookZ, 10, dt));
    const cam = this.world.camera;
    cam.position.copy(this.camPos);
    if (this.shake > 0) {
      this.shake -= dt;
      cam.position.x += (Math.random() - 0.5) * this.shake * 1.2;
      cam.position.y += (Math.random() - 0.5) * this.shake * 1.2;
    }
    cam.lookAt(this.camLook);
    const fov = (street ? 55 : 45) + (running && this.moving ? 5 : 0);
    if (Math.abs(cam.fov - fov) > 0.05) {
      cam.fov = damp(cam.fov, fov, 4, dt);
      cam.updateProjectionMatrix();
    }
  }
}
