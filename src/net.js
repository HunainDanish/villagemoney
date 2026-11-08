import * as THREE from 'three';
import { makeCharacter, colorForName } from './player.js';
import { PITCH } from '../shared/layout.js';

// Live "who is walking near me" using Supabase Realtime broadcast.
//
// Scaling: the town is split into regions (REGION x REGION blocks). Each
// browser joins only its own region's channel, so a message is delivered to
// people nearby, not to everyone in town. Positions are sent a few times a
// second while moving and rarely while standing still, and nothing is stored.

const REGION = 2; // blocks per region side
const SEND_MOVING_MS = 250;
const SEND_IDLE_MS = 4000;
const PEER_TIMEOUT_MS = 12000;

export class Net {
  constructor(world, labelLayer) {
    this.world = world;
    this.labelLayer = labelLayer;
    this.peers = new Map(); // id -> { mesh, label, to, last }
    this.id = crypto.randomUUID().slice(0, 12);
    this.name = 'Neighbour';
    this.channel = null;
    this.region = null;
    this.lastSend = 0;
    this.client = null;
    this.onCount = () => {};
  }

  async connect(url, anonKey) {
    if (!url || !anonKey) return false;
    const { createClient } = await import('@supabase/supabase-js');
    this.client = createClient(url, anonKey, { auth: { persistSession: false } });
    return true;
  }

  // Demo mode: a few wandering bots so the town doesn't feel empty.
  startBots(n = 6) {
    this.bots = Array.from({ length: n }, (_, i) => ({
      id: `bot${i}`,
      name: ['amna', 'zaid', 'sara', 'omar', 'hira', 'ali', 'noor', 'bilal'][i % 8],
      x: (Math.random() - 0.5) * 80,
      z: (Math.random() - 0.5) * 80,
      a: Math.random() * Math.PI * 2,
    }));
  }

  #regionOf(x, z) {
    const s = REGION * PITCH;
    return `${Math.floor(x / s + 0.5)}:${Math.floor(z / s + 0.5)}`;
  }

  #join(region) {
    if (this.channel) this.client.removeChannel(this.channel);
    this.region = region;
    this.channel = this.client.channel(`town:${region}`, { config: { broadcast: { self: false, ack: false } } });
    this.channel.on('broadcast', { event: 'p' }, ({ payload }) => this.#receive(payload));
    this.channel.on('broadcast', { event: 'bye' }, ({ payload }) => this.#remove(payload?.i));
    this.channel.subscribe();
  }

  #receive(p) {
    if (!p || typeof p.i !== 'string' || p.i === this.id) return;
    if (![p.x, p.z, p.h].every(Number.isFinite)) return;
    const name = typeof p.n === 'string' ? p.n.slice(0, 30) : 'Neighbour';
    let peer = this.peers.get(p.i);
    if (!peer) {
      const mesh = makeCharacter(colorForName(name));
      mesh.position.set(p.x, 0, p.z);
      this.world.scene.add(mesh);
      const label = document.createElement('div');
      label.className = 'label peer';
      this.labelLayer.append(label);
      peer = { mesh, label, to: new THREE.Vector3(p.x, 0, p.z), h: p.h, last: 0 };
      this.peers.set(p.i, peer);
    }
    peer.label.textContent = name;
    peer.to.set(p.x, 0, p.z);
    peer.h = p.h;
    peer.last = performance.now();
  }

  #remove(id) {
    const peer = this.peers.get(id);
    if (!peer) return;
    this.world.scene.remove(peer.mesh);
    peer.label.remove();
    this.peers.delete(id);
  }

  update(player, dt, now) {
    if (this.bots) this.#tickBots(dt, now);

    if (this.client) {
      const region = this.#regionOf(player.pos.x, player.pos.z);
      if (region !== this.region) {
        for (const id of [...this.peers.keys()]) this.#remove(id);
        this.#join(region);
      }
      const every = player.moving ? SEND_MOVING_MS : SEND_IDLE_MS;
      if (now - this.lastSend > every && this.channel?.state === 'joined') {
        this.lastSend = now;
        this.channel.send({
          type: 'broadcast',
          event: 'p',
          payload: { i: this.id, n: this.name, x: +player.pos.x.toFixed(1), z: +player.pos.z.toFixed(1), h: +player.heading.toFixed(2) },
        });
      }
    }

    const cam = this.world.camera;
    const v = new THREE.Vector3();
    for (const [id, peer] of this.peers) {
      if (now - peer.last > PEER_TIMEOUT_MS) {
        this.#remove(id);
        continue;
      }
      const moving = peer.mesh.position.distanceToSquared(peer.to) > 0.01;
      peer.mesh.position.lerp(peer.to, Math.min(1, dt * 6));
      peer.mesh.rotation.y = peer.h;
      peer.mesh.userData.body.position.y = 1.5 + (moving ? Math.abs(Math.sin(now / 90)) * 0.25 : 0);
      v.copy(peer.mesh.position).setY(5.2).project(cam);
      const on = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
      peer.label.style.display = on ? '' : 'none';
      if (on) peer.label.style.transform = `translate(-50%,-50%) translate(${((v.x + 1) / 2) * innerWidth}px,${((1 - v.y) / 2) * innerHeight}px)`;
    }
    this.onCount(this.peers.size);
  }

  #tickBots(dt, now) {
    for (const b of this.bots) {
      b.a += (Math.random() - 0.5) * dt * 2;
      const nx = b.x + Math.sin(b.a) * dt * 9;
      const nz = b.z + Math.cos(b.a) * dt * 9;
      if (this.world.blocked(nx, nz) || Math.hypot(nx, nz) > 160) b.a += Math.PI / 2;
      else { b.x = nx; b.z = nz; }
      this.#receive({ i: b.id, n: b.name, x: b.x, z: b.z, h: b.a });
    }
  }

  leave() {
    this.channel?.send({ type: 'broadcast', event: 'bye', payload: { i: this.id } });
  }
}
