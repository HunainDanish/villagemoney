import * as THREE from 'three';
import { Character } from './character.js';
import { carGeometry } from './props.js';
import { CARS } from '../shared/life.js';
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
    this.others = 0;
    this.client = null;
    this.status = 'off'; // off | connecting | live | error
    this.onCount = () => {};
    this.onReact = () => {}; // (character group, reaction key)
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
    return { i: this.id, n: this.name, x: +player.pos.x.toFixed(1), z: +player.pos.z.toFixed(1), h: +player.heading.toFixed(2), v: player.vehicle || null };
  }

  #join(region, player) {
    if (this.channel) this.client.removeChannel(this.channel);
    this.region = region;
    this.others = 0;
    const ch = this.client.channel(`town:${region}`, {
      config: { broadcast: { self: false, ack: false }, presence: { key: this.id } },
    });
    ch.on('broadcast', { event: 'p' }, ({ payload }) => this.#receive(payload));
    ch.on('broadcast', { event: 'e' }, ({ payload }) => this.#reacted(payload));
    ch.on('presence', { event: 'sync' }, () => this.#syncPresence());
    ch.subscribe((status, err) => {
      if (status === 'SUBSCRIBED') {
        this.status = 'live';
        this.tracked = this.#me(player);
        this.lastTrack = performance.now();
        ch.track(this.tracked);
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        this.status = 'error';
        this.error = err?.message || status;
        console.warn('live players:', status, err);
      }
    });
    this.channel = ch;
  }

  // Rebuild the list of people here from the presence state. Runs on every
  // presence change, and every 5 s with onlyMissing (local state only, no
  // messages) to bring back anyone a missed update left out. The periodic
  // pass never moves people, so walkers aren't snapped back to where they stood.
  #syncPresence(onlyMissing = false) {
    const ch = this.channel;
    if (!ch) return;
    const state = ch.presenceState();
    const ids = new Set(Object.keys(state));
    this.others = Math.max(0, ids.size - (ids.has(this.id) ? 1 : 0));
    for (const [id, metas] of Object.entries(state)) {
      if (id === this.id || !metas[0]) continue;
      if (!onlyMissing || !this.peers.has(id)) this.#receive({ ...metas[0], i: id });
      const peer = this.peers.get(id);
      if (peer) peer.present = true; // still here, even if standing still
    }
    for (const id of [...this.peers.keys()]) if (!ids.has(id) && !id.startsWith('bot')) this.#remove(id);
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
    // Driving? Show their car instead of their character.
    const v = CARS[p.v] ? p.v : null;
    if (v !== (peer.v || null)) {
      if (peer.car) this.world.scene.remove(peer.car);
      peer.car = null;
      if (v) {
        peer.car = new THREE.Mesh(carGeometry(v), new THREE.MeshLambertMaterial({ vertexColors: true, color: CARS[v].color }));
        peer.car.position.copy(peer.char.group.position).setY(0.3);
        this.world.scene.add(peer.car);
      }
      peer.v = v;
      peer.char.group.visible = !v;
    }
    peer.to.set(p.x, 0, p.z);
    peer.h = p.h;
    peer.last = performance.now();
  }

  // A nearby player reacted: wave if it's a wave, and show their bubble.
  #reacted(p) {
    const peer = this.peers.get(p?.i);
    if (!peer || typeof p.k !== 'string') return;
    if (p.k === 'wave') peer.char.play('wave');
    this.onReact(peer.car && peer.v ? peer.car : peer.char.group, p.k.slice(0, 12));
  }

  // Send one of your reactions to everyone nearby (only if someone is there).
  react(key) {
    if (this.channel?.state === 'joined' && this.others > 0) {
      this.channel.send({ type: 'broadcast', event: 'e', payload: { i: this.id, k: key } });
    }
  }

  #remove(id) {
    const peer = this.peers.get(id);
    if (!peer) return;
    this.world.scene.remove(peer.char.group);
    if (peer.car) this.world.scene.remove(peer.car);
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
      if (joined && now - (this.lastResync || 0) > 5000) {
        this.lastResync = now;
        this.#syncPresence(true);
      }
      if (joined && this.others > 0 && player.moving && now - this.lastSend > SEND_MOVING_MS) {
        this.lastSend = now;
        this.channel.send({ type: 'broadcast', event: 'p', payload: this.#me(player) });
      }
      // Whenever you're standing somewhere new (stopped walking, or jumped via
      // Home / Plaza / search) or your name changed (signed in), update your
      // presence so everyone sees you in the right place. Max ~1 update/second.
      if (joined && !player.moving && now - (this.lastTrack || 0) > 1000) {
        const me = this.#me(player);
        const t = this.tracked;
        if (!t || t.n !== me.n || t.v !== me.v || Math.hypot(t.x - me.x, t.z - me.z) > 0.5) {
          this.tracked = me;
          this.lastTrack = now;
          this.channel.track(me);
        }
      }
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
      let dist = g.position.distanceTo(peer.to);
      // Far jump (they used Home / Plaza / search): appear there, don't slide.
      if (dist > 40) {
        g.position.copy(peer.to);
        dist = 0;
      }
      // Otherwise walk toward the last known position at walking speed.
      const step = Math.min(dist, Math.max(14, dist * 2) * dt);
      if (dist > 0.05) {
        const dir = peer.to.clone().sub(g.position).normalize();
        g.position.addScaledVector(dir, step);
        peer.char.face(Math.atan2(dir.x, dir.z), dt);
      } else {
        peer.char.face(peer.h, dt);
      }
      peer.char.update(dt, dist > 0.05 ? step / dt : 0);
      if (peer.car) {
        peer.car.position.copy(g.position).setY(0.3);
        peer.car.rotation.y = peer.char.heading;
      }
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
      if (Math.random() < dt * 0.04) {
        const keys = ['wave', 'hi', 'heart', 'laugh', 'party', 'nice'];
        this.#reacted({ i: b.id, k: keys[(Math.random() * keys.length) | 0] });
      }
    }
  }

  leave() {
    if (this.channel) this.client.removeChannel(this.channel);
  }
}
