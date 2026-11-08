import * as THREE from 'three';

// A simple walking character. Also used for other people in town.
export function makeCharacter(color = 0x3d7cf5) {
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.8, 1.4, 4, 12), mat);
  body.position.y = 1.5;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.75, 16, 12), new THREE.MeshLambertMaterial({ color: 0xf3d2b3 }));
  head.position.y = 3.3;
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), mat);
  nose.position.set(0, 3.3, 0.75);
  g.add(body, head, nose);
  g.userData.body = body;
  return g;
}

export const colorForName = (name) => {
  let h = 0;
  for (const ch of name || '') h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return new THREE.Color().setHSL((h % 360) / 360, 0.65, 0.55);
};

// Keyboard (WASD / arrows, Shift to run), tap/click-to-walk, drag to turn,
// wheel to zoom. Collision is delegated to world.blocked().
export class Player {
  constructor(world, canvas, { onTap }) {
    this.world = world;
    this.mesh = makeCharacter();
    world.scene.add(this.mesh);
    this.pos = new THREE.Vector3(0, 0, 22);
    this.heading = Math.PI;
    this.yaw = 0; // camera yaw around the player
    this.zoom = innerWidth < innerHeight ? 1.7 : 1; // portrait phones see more
    this.keys = new Set();
    this.target = null;
    this.moving = false;
    this.onTap = onTap;

    addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      this.keys.add(e.key.toLowerCase());
      this.target = null;
    });
    addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    addEventListener('blur', () => this.keys.clear());
    canvas.addEventListener('wheel', (e) => {
      this.zoom = THREE.MathUtils.clamp(this.zoom * (e.deltaY > 0 ? 1.1 : 0.9), 0.45, 2.2);
    }, { passive: true });

    let down = null;
    const touches = new Map(); // active pointers, for pinch-to-zoom
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
      if (pinch) {
        this.zoom = THREE.MathUtils.clamp(pinch.zoom * (pinch.d / Math.max(1, spread())), 0.45, 2.2);
        return;
      }
      if (!down) return;
      const dx = e.clientX - down.x;
      if (Math.abs(dx) > 6 || Math.abs(e.clientY - down.y) > 6) down.dragged = true;
      if (down.dragged) this.yaw = down.yaw - dx * 0.008;
    });
    canvas.addEventListener('pointerup', (e) => {
      lift(e);
      if (down && !down.dragged) {
        const ndcX = (e.clientX / innerWidth) * 2 - 1;
        const ndcY = -(e.clientY / innerHeight) * 2 + 1;
        const hit = world.pick(ndcX, ndcY);
        if (hit?.house) this.onTap(hit.house);
        else if (hit?.ground) this.target = new THREE.Vector2(hit.ground.x, hit.ground.z);
      }
      down = null;
    });
  }

  teleport(x, z, faceX, faceZ) {
    this.pos.set(x, 0, z);
    this.target = null;
    if (faceX !== undefined) this.heading = Math.atan2(faceX - x, faceZ - z);
    this.yaw = this.heading + Math.PI; // camera behind, looking the same way
  }

  update(dt) {
    const k = this.keys;
    let fx = 0;
    let fz = 0;
    if (k.has('w') || k.has('arrowup')) fz -= 1;
    if (k.has('s') || k.has('arrowdown')) fz += 1;
    if (k.has('a') || k.has('arrowleft')) fx -= 1;
    if (k.has('d') || k.has('arrowright')) fx += 1;

    let dir = null;
    if (fx || fz) {
      // Movement is relative to the camera's yaw.
      const s = Math.sin(this.yaw);
      const c = Math.cos(this.yaw);
      dir = new THREE.Vector2(fx * c + fz * s, -fx * s + fz * c).normalize();
    } else if (this.target) {
      const d = new THREE.Vector2(this.target.x - this.pos.x, this.target.y - this.pos.z);
      if (d.length() < 0.8) this.target = null;
      else dir = d.normalize();
    }

    this.moving = Boolean(dir);
    if (dir) {
      const speed = (k.has('shift') ? 26 : 14) * dt;
      const nx = this.pos.x + dir.x * speed;
      const nz = this.pos.z + dir.y * speed;
      let moved = false;
      if (!this.world.blocked(nx, this.pos.z)) { this.pos.x = nx; moved = true; }
      if (!this.world.blocked(this.pos.x, nz)) { this.pos.z = nz; moved = true; }
      if (!moved) this.target = null;
      const want = Math.atan2(dir.x, dir.y);
      let diff = want - this.heading;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.heading += diff * Math.min(1, dt * 12);
    }

    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = this.heading;
    this.mesh.userData.body.position.y = 1.5 + (this.moving ? Math.abs(Math.sin(performance.now() / 90)) * 0.25 : 0);

    // Third-person camera.
    // Steep angle so houses don't hide the player in the narrow lanes.
    const dist = 26 * this.zoom;
    const cam = this.world.camera;
    cam.position.set(
      this.pos.x + Math.sin(this.yaw) * dist,
      38 * this.zoom + 4,
      this.pos.z + Math.cos(this.yaw) * dist,
    );
    cam.lookAt(this.pos.x, 3, this.pos.z);
  }
}
