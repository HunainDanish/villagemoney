import * as THREE from 'three';
import { Character } from './character.js';
import { carGeometry } from './props.js';
import { CARS } from '../shared/life.js';
import { encodeAvatar, decodeAvatar } from '../shared/look.js';
import { reactionByKey } from './reactions.js';
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

// Demo bots answer chat with something friendly.
function botReply(text) {
  const t = text.toLowerCase();
  if (/\b(hi|hey|hello|salam|assalam)/.test(t)) return ['hey! 👋', 'hi there!', 'salam! how are you?'][(Math.random() * 3) | 0];
  if (t.includes('?')) return ['good question 😄', 'not sure, have you tried the café?', 'yes!', 'maybe later?'][(Math.random() * 4) | 0];
  return ['haha nice', 'same here', 'love this town 🏡', 'see you at the fountain!', 'cool 😎'][(Math.random() * 5) | 0];
}

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
    this.onChat = () => {}; // ({ id, name, text }) a message for you
    this.onPeerTap = () => {}; // (id) their name tag was tapped
    this.onPeerGone = () => {}; // (id) they left your area
    this.online = 0; // everyone in town right now (lobby presence)
    this.regionCounts = {}; // region -> people there
  }

  async connect(url, anonKey) {
    if (!url || !anonKey) return false;
    const { createClient } = await import('@supabase/supabase-js');
    this.client = createClient(url, anonKey, { auth: { persistSession: false } });
    this.status = 'connecting';
    return true;
  }

  // Town-wide presence ("N online · Join"): one small update when you join,
  // leave or move to another area; no positions are sent here.
  joinLobby() {
    if (!this.client || this.lobby) return;
    const ch = this.client.channel('town:lobby', { config: { presence: { key: this.id } } });
    ch.on('presence', { event: 'sync' }, () => {
      const state = ch.presenceState();
      this.online = Object.keys(state).length;
      const counts = {};
      for (const [id, metas] of Object.entries(state)) {
        if (id === this.id) continue;
        const r = metas[0]?.r;
        if (typeof r === 'string') counts[r] = (counts[r] || 0) + 1;
      }
      this.regionCounts = counts;
    });
    ch.subscribe((status) => status === 'SUBSCRIBED' && this.#trackLobby());
    this.lobby = ch;
  }

  #trackLobby() {
    if (!this.lobby || this.lobby.state !== 'joined') return;
    if (this.hidden) return void this.lobby.untrack();
    this.lobby.track({ r: this.regionOverride ? 'inside' : this.region });
  }

  refreshLobby() {
    this.#trackLobby();
  }

  // The busiest area other than yours (for "Join"), or null.
  busiestRegion() {
    let best = null;
    let n = 0;
    for (const [r, c] of Object.entries(this.regionCounts)) {
      if (r !== this.region && r !== 'inside' && c > n) {
        best = r;
        n = c;
      }
    }
    return best ? { region: best, people: n, center: this.regionCenter(best) } : null;
  }

  regionCenter(r) {
    const [rx, rz] = r.split(':').map(Number);
    const s = REGION * PITCH;
    return { x: rx * s, z: rz * s };
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
    if (this.regionOverride) return this.regionOverride; // e.g. inside a house
    const s = REGION * PITCH;
    return `${Math.floor(x / s + 0.5)}:${Math.floor(z / s + 0.5)}`;
  }

  #me(player) {
    return { i: this.id, n: this.name, x: +player.pos.x.toFixed(1), z: +player.pos.z.toFixed(1), h: +player.heading.toFixed(2), v: player.vehicle || null, l: encodeAvatar(player.avatar) };
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
    ch.on('broadcast', { event: 'c' }, ({ payload }) => this.#chatIn(payload));
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
      const id = p.i;
      label.onclick = () => this.onPeerTap(id); // tap a name tag to chat
      this.labelLayer.append(label);
      peer = { char, label, to: new THREE.Vector3(p.x, 0, p.z), h: p.h, last: 0, name };
      this.peers.set(p.i, peer);
    }
    if (peer.name !== name || !peer.label.textContent) {
      peer.label.textContent = name;
      peer.name = name;
    }
    // Their look changed (My look): rebuild their character.
    const l = typeof p.l === 'string' ? p.l : null;
    if (l !== (peer.l ?? null) && (l === null || decodeAvatar(l))) {
      const old = peer.char;
      peer.char = new Character({ seed: name, shadow: false, avatar: decodeAvatar(l) });
      peer.char.group.position.copy(old.group.position);
      peer.char.heading = old.heading;
      peer.char.group.visible = old.group.visible;
      this.world.scene.remove(old.group);
      this.world.scene.add(peer.char.group);
      peer.l = l;
    }
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
    const anim = reactionByKey[p.k]?.anim;
    if (anim) peer.char.play(anim);
    this.onReact(peer.car && peer.v ? peer.car : peer.char.group, p.k.slice(0, 12));
  }

  // Send one of your reactions to everyone nearby (only if someone is there).
  react(key) {
    if (!this.hidden && this.channel?.state === 'joined' && this.others > 0) {
      this.channel.send({ type: 'broadcast', event: 'e', payload: { i: this.id, k: key } });
    }
  }

  // ---------- chat ----------
  // One-to-one messages to someone in your area, sent over the area's live
  // channel and addressed to them; other browsers ignore them. Only people
  // you can see can message you.
  #chatIn(p) {
    if (!p || p.to !== this.id || typeof p.i !== 'string' || typeof p.t !== 'string') return;
    const peer = this.peers.get(p.i);
    if (!peer) return;
    const text = p.t.replace(/\s+/g, ' ').trim().slice(0, 200);
    if (text) this.onChat({ id: p.i, name: peer.name, text });
  }

  // Send a message; returns false if they can't get it right now.
  chat(id, text) {
    const peer = this.peers.get(id);
    if (!peer || this.hidden) return false;
    if (id.startsWith('bot')) {
      setTimeout(() => this.peers.has(id) && this.onChat({ id, name: peer.name, text: botReply(text) }), 900 + Math.random() * 1500);
      return true;
    }
    if (this.channel?.state !== 'joined') return false;
    this.channel.send({ type: 'broadcast', event: 'c', payload: { i: this.id, to: id, t: text } });
    return true;
  }

  peerName(id) {
    return this.peers.get(id)?.name ?? null;
  }

  peerObject(id) {
    const peer = this.peers.get(id);
    return peer ? (peer.car && peer.v ? peer.car : peer.char.group) : null;
  }

  // People here, nearest first: [{ id, name, dist }].
  nearby(x, z) {
    return [...this.peers.entries()]
      .map(([id, p]) => ({ id, name: p.name, dist: Math.hypot(p.char.group.position.x - x, p.char.group.position.z - z) }))
      .sort((a, b) => a.dist - b.dist);
  }

  // Who is under a tap on the screen (within a finger's width), or null.
  peerAt(cx, cy) {
    const v = new THREE.Vector3();
    let best = null;
    let bestD = 46;
    for (const [id, peer] of this.peers) {
      const g = peer.car && peer.v ? peer.car : peer.char.group;
      if (!g.visible && !peer.v) continue;
      for (const y of [1, 2.4]) {
        v.copy(g.position).setY(y).project(this.world.camera);
        if (v.z > 1) continue;
        const d = Math.hypot(((v.x + 1) / 2) * innerWidth - cx, ((1 - v.y) / 2) * innerHeight - cy);
        if (d < bestD) {
          bestD = d;
          best = id;
        }
      }
    }
    return best;
  }

  setUnread(id, on) {
    this.peers.get(id)?.label.classList.toggle('unread', on);
  }

  #remove(id) {
    const peer = this.peers.get(id);
    if (!peer) return;
    this.onPeerGone(id);
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
        this.#trackLobby();
      }
      const joined = this.channel?.state === 'joined';
      if (joined && now - (this.lastResync || 0) > 5000) {
        this.lastResync = now;
        this.#syncPresence(true);
      }
      // Hide me: leave the presence list and send nothing (you still see others).
      if (joined && this.hidden) {
        if (this.tracked) {
          this.channel.untrack();
          this.tracked = null;
        }
        return this.#drawPeers(dt, now);
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
        if (!t || t.n !== me.n || t.v !== me.v || t.l !== me.l || Math.hypot(t.x - me.x, t.z - me.z) > 0.5) {
          this.tracked = me;
          this.lastTrack = now;
          this.channel.track(me);
        }
      }
    }

    this.#drawPeers(dt, now);
  }

  #drawPeers(dt, now) {
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
