import * as THREE from 'three';

// Quick reactions and speech bubbles. A fixed set (no free text), so there is
// nothing to moderate. Shown above a character's head for a few seconds and
// shared live with players nearby (one tiny message each).
export const REACTIONS = [
  { k: 'wave', icon: '👋', anim: 'wave' },
  { k: 'hi', text: 'hi!' },
  { k: 'heart', icon: '❤️' },
  { k: 'laugh', icon: '😂' },
  { k: 'party', icon: '🎉' },
  { k: 'wow', icon: '😮' },
  { k: 'nice', text: 'nice house!' },
  { k: 'follow', text: 'follow me!' },
  { k: 'bye', text: 'bye 👋' },
];
export const reactionByKey = Object.fromEntries(REACTIONS.map((r) => [r.k, r]));

// A bubble that follows a 3D object until it expires.
export class Bubbles {
  constructor(layer, camera) {
    this.layer = layer;
    this.camera = camera;
    this.list = [];
    this.v = new THREE.Vector3();
  }

  show(object, key, height = 4.6) {
    const r = reactionByKey[key];
    if (!r || !object) return;
    // One bubble per character: replace the old one.
    for (const b of this.list) if (b.object === object) b.until = 0;
    const el = document.createElement('div');
    el.className = `bubble${r.text ? ' text' : ''}`;
    el.textContent = r.text || r.icon;
    this.layer.append(el);
    this.list.push({ el, object, height, until: performance.now() + 3200 });
  }

  update() {
    const now = performance.now();
    this.list = this.list.filter((b) => {
      if (now > b.until || !b.object.parent) {
        b.el.remove();
        return false;
      }
      this.v.setFromMatrixPosition(b.object.matrixWorld);
      this.v.y += b.height;
      this.v.project(this.camera);
      const on = this.v.z < 1 && Math.abs(this.v.x) < 1.1 && Math.abs(this.v.y) < 1.1;
      b.el.style.display = on ? '' : 'none';
      if (on) b.el.style.transform = `translate(-50%,-100%) translate(${((this.v.x + 1) / 2) * innerWidth}px,${((1 - this.v.y) / 2) * innerHeight}px)`;
      return true;
    });
  }
}
