import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

// Minimal browser stubs so src/net.js (and the Character it draws) can run in Node.
globalThis.innerWidth = 800;
globalThis.innerHeight = 600;
globalThis.document = {
  createElement: () => ({ style: {}, className: '', textContent: '', remove() {} }),
};

const { Net } = await import('../src/net.js');

// A fake Supabase Realtime hub: channels with presence and broadcast,
// shared by several clients, delivering messages asynchronously like the real one.
function makeHub() {
  const channels = new Map(); // name -> Set of client channels
  const flush = () => new Promise((r) => setTimeout(r, 0));
  class FakeChannel {
    constructor(name, opts) {
      this.name = name;
      this.key = opts.config.presence.key;
      this.handlers = [];
      this.state = 'closed';
      this.meta = null;
    }
    on(type, filter, cb) {
      this.handlers.push({ type, event: filter.event, cb });
      return this;
    }
    members() {
      return channels.get(this.name) || new Set();
    }
    emitPresence() {
      for (const ch of this.members()) for (const h of ch.handlers) if (h.type === 'presence' && h.event === 'sync') h.cb();
    }
    subscribe(cb) {
      if (!channels.has(this.name)) channels.set(this.name, new Set());
      this.members().add(this);
      setTimeout(() => {
        this.state = 'joined';
        cb('SUBSCRIBED');
      }, 0);
      return this;
    }
    track(meta) {
      this.meta = meta;
      setTimeout(() => this.emitPresence(), 0);
    }
    presenceState() {
      const out = {};
      for (const ch of this.members()) if (ch.meta) out[ch.key] = [ch.meta];
      return out;
    }
    send(msg) {
      setTimeout(() => {
        for (const ch of this.members()) {
          if (ch === this) continue;
          for (const h of ch.handlers) if (h.type === 'broadcast' && h.event === msg.event) h.cb({ payload: msg.payload });
        }
      }, 0);
    }
    leave() {
      this.members().delete(this);
      this.state = 'closed';
      setTimeout(() => this.emitPresence(), 0);
    }
  }
  const client = () => ({
    channel: (name, opts) => new FakeChannel(name, opts),
    removeChannel: (ch) => ch.leave(),
  });
  return { client, flush };
}

function makePlayer(x, z) {
  return { pos: new THREE.Vector3(x, 0, z), heading: 0, moving: false };
}

function makeNet(hub, name) {
  const world = { scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), blocked: () => false };
  const net = new Net(world, { append() {} });
  net.client = hub.client();
  net.status = 'connecting';
  net.name = name;
  return net;
}

async function tick(nets, players, ms = 100, steps = 5) {
  for (let i = 0; i < steps; i++) {
    nets.forEach((n, k) => n.update(players[k], ms / 1000, (tick.t += ms)));
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
  }
}
tick.t = 1000;

test('two players standing near each other both see each other', async () => {
  const hub = makeHub();
  const a = makeNet(hub, 'hunain_danish');
  const b = makeNet(hub, 'dravidfc');
  const pa = makePlayer(10, 30);
  const pb = makePlayer(14, 32);
  await tick([a, b], [pa, pb]);
  assert.equal(a.status, 'live');
  assert.equal(b.status, 'live');
  assert.equal(a.peers.size, 1, 'A should see B');
  assert.equal(b.peers.size, 1, 'B should see A');
});

test('someone who joins later sees people already standing there, and vice versa', async () => {
  const hub = makeHub();
  const a = makeNet(hub, 'early');
  const pa = makePlayer(0, 20);
  await tick([a], [pa]);
  const b = makeNet(hub, 'late');
  const pb = makePlayer(5, 25);
  await tick([a, b], [pa, pb]);
  assert.equal(a.peers.size, 1);
  assert.equal(b.peers.size, 1);
});

test('standing still for minutes does not make you disappear', async () => {
  const hub = makeHub();
  const a = makeNet(hub, 'a');
  const b = makeNet(hub, 'b');
  const pa = makePlayer(0, 20);
  const pb = makePlayer(3, 22);
  await tick([a, b], [pa, pb]);
  tick.t += 5 * 60 * 1000; // five minutes pass with nobody moving
  await tick([a, b], [pa, pb]);
  assert.equal(a.peers.size, 1);
  assert.equal(b.peers.size, 1);
});

test('walking is broadcast and the other player follows', async () => {
  const hub = makeHub();
  const a = makeNet(hub, 'a');
  const b = makeNet(hub, 'b');
  const pa = makePlayer(0, 20);
  const pb = makePlayer(3, 22);
  await tick([a, b], [pa, pb]);
  pa.moving = true;
  pa.pos.set(30, 0, 20);
  await tick([a, b], [pa, pb], 600, 3);
  const seen = [...b.peers.values()][0];
  assert.ok(seen.to.x > 25, `B should see A at x~30, saw ${seen.to.x}`);
});

test('jumping (Home / Plaza / search) is announced, and others draw you there', async () => {
  const hub = makeHub();
  const a = makeNet(hub, 'hunain_danish');
  const b = makeNet(hub, 'dravidfc');
  const pa = makePlayer(0, 24); // where everyone starts
  const pb = makePlayer(120, 60); // standing at a house
  await tick([a, b], [pa, pb]);
  pa.pos.set(118, 0, 64); // A presses Home and lands next to B, without walking
  await tick([a, b], [pa, pb], 600, 4);
  const seenByB = [...b.peers.values()][0];
  assert.ok(seenByB, 'B should see A');
  assert.ok(seenByB.char.group.position.distanceTo(pa.pos) < 1, `B draws A at ${seenByB.char.group.position.toArray()}`);
});

test('signing in updates the name others see', async () => {
  const hub = makeHub();
  const a = makeNet(hub, 'Neighbour');
  const b = makeNet(hub, 'b');
  const pa = makePlayer(0, 20);
  const pb = makePlayer(3, 22);
  await tick([a, b], [pa, pb]);
  a.name = 'hunain_danish';
  await tick([a, b], [pa, pb], 600, 4);
  assert.equal([...b.peers.values()][0].label.textContent, 'hunain_danish');
});
