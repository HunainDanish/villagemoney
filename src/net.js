import * as THREE from 'three';
import { Character } from './character.js';
import { PITCH } from '../shared/layout.js';

// Live "who is walking near me" using Supabase Realtime.
//
// Message budget is the scarcest free-tier resource, so:
// - The town is split into regions; each browser joins only its own region.
// - Presence (sent only on join and when you stop walking) tells everyone
//   who is in the region and where they are standing.
// - Positions are broadcast only while you are MOVING and only if somebody
//   else is actually in your region. Alone = zero messages per second.
// - Moving updates go out twice a second; peers are smoothly interpolated.

const REGION = 3; // blocks per region side (bigger = fewer border splits)
const SEND_MOVING_MS = 500;
const PEER_TIMEOUT_MS = 90000; // fallback if a "leave" is ever missed

export class Net {
  constructor(world, labelLayer) {
    this.world = world;
    this.labelLayer = labelLayer;
    this.peers = new Map(); // id -> { char, label, to, h, last }
    this.id = crypto.randomUUID().slice(0, 12);
    this.name = 'Neighbour';
    this.look = {};
    this.channel = null;
    this.region = null;
    this.lastSend = 0;
    this.wasMoving = false;
    this.others = 0;
    this.client = null;
    this.status = 'off'; // off | connecting | live | error
    this.onCount = () => {};
  }

  async connect(url, anonKey) {
    if (!url || !anonKey) return false;
    const { createClient } = await import('@supabase/supabase-js');
    this.client = createClient(url, anonKey, { auth: { persistSession: false } });
    this.status = 'connecting';
    return true;
  }

  // Demo mode: a few wandering bots so the town doesn't feel empty.
  startBots(n = 7) {
    const names = ['amna', 'zaid', 'sara', 'omar', 'hira', 'ali', 'noor', 'bilal'];
    this.bots = Array.from({ length: n }, (_, i) => ({
      id: `bot${i}`,
      name: names[i % names.length],
      x: (Math.random() - 0.5) * 70,
      z: (Math.random() - 0.5) * 70,
      a: Math.random() * Math.PI * 2,
      pause: 0,
    }));
  }

  #regionOf(x, z) {
    const s = REGION * PITCH;
    return `${Math.floor(x / s + 0.5)}:${Math.floor(z / s + 0.5)}`;
  }

  #me(player) {
    return { i: this.id, n: this.name, x: +player.pos.x.toFixed(1), z: +player.pos.z.toFixed(1), h: +player.heading.toFixed(2) };
  }

  #join(region, player) {
    if (this.channel) this.client.removeChannel(this.channel);
    this.region = region;
    this.others = 0;
    const ch = this.client.channel(`town:${region}`, {
      config: { broadcast: { self: false, ack: false }, presence: { key: this.id } },
    });
    ch.on('broadcast', { event: 'p' }, ({ payload }) => this.#receive(payload));
    ch.on('presence', { event: 'sync' }, () => {
      const state = ch.presenceState();
      const ids = new Set(Object.keys(state));
      this.others = Math.max(0, ids.size - (ids.has(this.id) ? 1 : 0));
      for (const [id, metas] of Object.entries(state)) {
        if (id === this.id || !metas[0]) continue;
        this.#receive({ ...metas[0], i: id });
        const peer = this.peers.get(id);
        if (peer) peer.present = true; // still here, even if standing still
      }
      for (const id of [...this.peers.keys()]) if (!ids.has(id) && !id.startsWith('bot')) this.#remove(id);
    });
    ch.subscribe((status, err) => {
      if (status === 'SUBSCRIBED') {
        this.status = 'live';
        ch.track(this.#me(player));
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        this.status = 'error';
        this.error = err?.message || status;
        console.warn('live players:', status, err);
      }
    });
    this.channel = ch;
  }

  #receive(p) {
    if (!p || typeof p.i !== 'string' || p.i === this.id) return;
    if (![p.x, p.z, p.h].every(Number.isFinite)) return;
    const name = typeof p.n === 'string' ? p.n.slice(0, 30) : 'Neighbour';
    let peer = this.peers.get(p.i);
    if (!peer && this.peers.size >= 20) return; // draw at most 20 other people
    if (!peer) {
      const char = new Character({ seed: name, shadow: false });
      char.group.position.set(p.x, 0, p.z);
      this.world.scene.add(char.group);
      const label = document.createElement('div');
      label.className = 'label peer';
      this.labelLayer.append(label);
      peer = { char, label, to: new THREE.Vector3(p.x, 0, p.z), h: p.h, last: 0 };
      this.peers.set(p.i, peer);
    }
    if (peer.label.textContent !== name) peer.label.textContent = name;
    peer.to.set(p.x, 0, p.z);
    peer.h = p.h;
    peer.last = performance.now();
  }

  #remove(id) {
    const peer = this.peers.get(id);
    if (!peer) return;
    this.world.scene.remove(peer.char.group);
    peer.char.dispose();
    peer.label.remove();
    this.peers.delete(id);
  }

  update(player, dt, now) {
    if (this.bots) this.#tickBots(dt);

    if (this.client) {
      const region = this.#regionOf(player.pos.x, player.pos.z);
      if (region !== this.region) {
        for (const id of [...this.peers.keys()]) if (!id.startsWith('bot')) this.#remove(id);
        this.#join(region, player);
      }
      const joined = this.channel?.state === 'joined';
      if (joined && this.others > 0 && player.moving && now - this.lastSend > SEND_MOVING_MS) {
        this.lastSend = now;
        this.channel.send({ type: 'broadcast', event: 'p', payload: this.#me(player) });
      }
      // Stopped walking: one presence update so newcomers see where you stand.
      if (joined && this.wasMoving && !player.moving) this.channel.track(this.#me(player));
      this.wasMoving = player.moving;
    }

    const cam = this.world.camera;
    const v = new THREE.Vector3();
    for (const [id, peer] of this.peers) {
      // People who are present (per presence) stay even while standing still.
      if (!peer.present && now - peer.last > PEER_TIMEOUT_MS) {
        this.#remove(id);
        continue;
      }
      const g = peer.char.group;
      const dist = g.position.distanceTo(peer.to);
      // Walk toward the last known position at walking speed (no teleporting).
      const step = Math.min(dist, Math.max(14, dist * 2) * dt);
      if (dist > 0.05) {
        const dir = peer.to.clone().sub(g.position).normalize();
        g.position.addScaledVector(dir, step);
        peer.char.face(Math.atan2(dir.x, dir.z), dt);
      } else {
        peer.char.face(peer.h, dt);
      }
      peer.char.update(dt, dist > 0.05 ? step / dt : 0);
      v.copy(g.position).setY(4.8).project(cam);
      const on = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
      peer.label.style.display = on ? '' : 'none';
      if (on) peer.label.style.transform = `translate(-50%,-50%) translate(${((v.x + 1) / 2) * innerWidth}px,${((1 - v.y) / 2) * innerHeight}px)`;
    }
    this.onCount(this.peers.size);
  }

  #tickBots(dt) {
    for (const b of this.bots) {
      if (b.pause > 0) {
        b.pause -= dt;
        continue;
      }
      if (Math.random() < dt * 0.15) b.pause = 1 + Math.random() * 3;
      b.a += (Math.random() - 0.5) * dt * 1.5;
      const nx = b.x + Math.sin(b.a) * dt * 7;
      const nz = b.z + Math.cos(b.a) * dt * 7;
      if (this.world.blocked(nx, nz) || Math.hypot(nx, nz) > 140) b.a += Math.PI / 2;
      else {
        b.x = nx;
        b.z = nz;
      }
      this.#receive({ i: b.id, n: b.name, x: b.x, z: b.z, h: b.a });
    }
  }

  leave() {
    if (this.channel) this.client.removeChannel(this.channel);
  }
}
