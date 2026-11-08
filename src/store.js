import { applyBatch, initialState } from '../shared/game.js';

// Game progress on the client.
// - Guests: the shared rules run locally; progress lives in localStorage.
// - Residents: actions apply locally at once (so it feels instant), are queued,
//   and sent to /api/actions every 20 s (or immediately for actions where the
//   server decides, like fishing). The server's answer replaces local state.

const KEY = 'pl_game_v1';
const FLUSH_MS = 20000;
const SERVER_DECIDES = new Set(['fish']);
const URGENT = new Set(['craft', 'place', 'sell', 'paint', 'claim', 'upgrade']);

function readLocal(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}
function writeLocal(key, v) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage blocked: progress lasts this tab only */
  }
}

export class Store {
  constructor() {
    this.state = initialState();
    this.member = false;
    this.queue = [];
    this.inflight = null;
    this.listeners = new Set();
    let gid = readLocal('pl_guest');
    if (!gid) writeLocal('pl_guest', (gid = Math.random().toString(36).slice(2)));
    this.seed = gid;
    setInterval(() => this.flush(), FLUSH_MS);
    addEventListener('pagehide', () => this.flush(true));
    document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && this.flush(true));
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  #emit(events = []) {
    for (const fn of this.listeners) fn(this.state, events);
  }

  // Start as a guest (local progress) or as a signed-in resident.
  initGuest() {
    this.member = false;
    const saved = readLocal(KEY);
    this.state = saved?.v ? saved : initialState();
    return this.act({ a: 'checkin' });
  }

  initMember(resident, serverState, events = []) {
    this.member = true;
    this.seed = String(resident.id);
    this.state = serverState?.v ? serverState : initialState();
    this.#emit(events);
  }

  ctx() {
    return { now: Date.now(), rng: Math.random, seed: this.seed };
  }

  // Apply an action. Resolves to { ok, reason, events }.
  async act(action) {
    if (this.member && SERVER_DECIDES.has(action.a)) {
      this.queue.push(action);
      const res = await this.flush();
      const r = res?.results?.at(-1);
      if (!res) return { ok: false, reason: 'offline, try again', events: [] };
      // The server's events aren't returned; diff the inventory to describe the catch.
      return r?.ok ? { ok: true, events: res.gained } : { ok: false, reason: r?.reason || 'failed', events: [] };
    }
    const { state, results } = applyBatch(this.state, [action], this.ctx());
    const r = results[0];
    if (!r.ok) return r;
    this.state = state;
    if (this.member) {
      this.queue.push(action);
      if (URGENT.has(action.a) || this.queue.length >= 25) this.flush();
    } else {
      writeLocal(KEY, this.state);
    }
    this.#emit(r.events);
    return r;
  }

  // Send queued actions. With `beacon`, use sendBeacon (page is closing).
  async flush(beacon = false) {
    if (!this.member || !this.queue.length) return null;
    if (beacon) {
      const body = JSON.stringify({ actions: this.queue });
      if (navigator.sendBeacon?.('/api/actions', body)) this.queue = [];
      return null;
    }
    if (this.inflight) {
      await this.inflight;
      if (!this.queue.length) return null;
    }
    const batch = this.queue;
    this.queue = [];
    const before = { ...this.state.items };
    this.inflight = fetch('/api/actions', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ actions: batch }),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (res.status === 401) {
          this.member = false; // signed out elsewhere: keep playing as a guest
          return null;
        }
        if (!res.ok || !data.state) throw new Error(data.error || 'sync failed');
        // Server state + anything queued while the request was in flight.
        const { state } = applyBatch(data.state, this.queue, this.ctx());
        const downgraded = (state.tier || 1) < (this.state.tier || 1);
        this.state = state;
        if (downgraded) this.onNotice?.('The server could not confirm your upgrade. Your materials are back in your bag.');
        const gained = [];
        for (const [item, n] of Object.entries(data.state.items || {})) {
          const d = n - (before[item] || 0);
          if (d > 0) gained.push({ type: 'gain', item, qty: d });
        }
        this.#emit([]);
        return { results: data.results, gained };
      })
      .catch(() => {
        this.queue = batch.concat(this.queue); // retry next time
        return null;
      })
      .finally(() => {
        this.inflight = null;
      });
    return this.inflight;
  }
}
