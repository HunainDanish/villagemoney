// Talks to /api, or fakes a town when there is no backend (demo mode).
// Demo mode kicks in automatically under `npm run dev` (Vite has no /api)
// and on a deployment without database environment variables.

import { firstHouseOfBlock, lastHouseOfBlock } from '../shared/layout.js';
import { GAME } from '../shared/features.js';

const DEMO_HOUSES = 2600;
let demo = false;

async function get(path) {
  const res = await fetch(path, { credentials: 'same-origin' });
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) throw new Error('no api');
  const data = await res.json();
  if (!res.ok && res.status !== 404) throw Object.assign(new Error(data.error || 'Request failed'), { status: res.status });
  return data;
}

export async function loadConfig() {
  try {
    const cfg = await get('/api/config');
    demo = cfg.demo;
    return cfg;
  } catch {
    demo = true;
    return { demo: true, townName: 'Porchlight', igHandle: '', supabaseUrl: '', supabaseAnonKey: '' };
  }
}

export const isDemo = () => demo;
export const demoBricks = [0, 0]; // villa bricks added in the demo

export async function loadStats() {
  if (demo) {
    const latest = [];
    for (let id = DEMO_HOUSES; latest.length < 8; id--) if (id % 23) latest.push({ id, u: demoName(id) });
    return { residents: DEMO_HOUSES, maxId: DEMO_HOUSES, latest, villas: [12 + demoBricks[0], 40 + demoBricks[1]] };
  }
  return get('/api/stats');
}

export async function loadBlock(b) {
  if (demo) return demoBlock(b);
  return get(`/api/block?b=${b}`);
}

export async function findHouse(username) {
  if (demo) {
    const id = demoFind(username);
    return id ? { found: true, id } : { found: false };
  }
  return get(`/api/find?u=${encodeURIComponent(username)}`);
}

export async function loadMe() {
  if (demo) return { resident: null };
  try {
    return await get('/api/me');
  } catch (e) {
    // Don't silently look signed out: pass the reason on so the page shows it.
    return { resident: null, error: e.message };
  }
}

export async function send(method, path, body) {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// ---------- demo data ----------
const A = ['sunny', 'misty', 'lazy', 'brave', 'tiny', 'cosmic', 'velvet', 'lucky', 'quiet', 'neon', 'golden', 'salty', 'mango', 'paper', 'urban', 'retro'];
const B = ['fox', 'otter', 'chai', 'pixel', 'river', 'moon', 'biryani', 'koala', 'sparrow', 'cloud', 'tiger', 'falcon', 'lotus', 'comet', 'panda', 'mint'];

export function demoName(id) {
  let h = Math.imul(id ^ 0x9e3779b9, 2654435761) >>> 0;
  const a = A[h % A.length];
  h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0;
  const b = B[h % B.length];
  return `${a}.${b}${id}`;
}

function demoBlock(b) {
  const houses = [];
  const from = firstHouseOfBlock(b);
  for (let id = from; id <= lastHouseOfBlock(b) && id <= DEMO_HOUSES; id++) {
    const h = { id, u: id % 23 === 0 ? null : demoName(id), lit: id % 3 === 0 ? 1 : undefined }; // a few hidden, some porch lights on
    const t = id % 17 === 0 ? 5 : id % 11 === 0 ? 4 : id % 5 === 0 ? 3 : id % 3 === 0 ? 2 : 0;
    if (t && id !== 7) h.t = t; // house 7 is yours in the demo
    if (id % 4 === 0 && id !== 7) h.p = { wall: id % 10, roof: (id >> 2) % 8 };
    if (id !== 7 && GAME) {
      const crops = ['wheat', 'carrot', 'tomato', 'pumpkin'];
      if (id % 2 === 0) h.g = [0, 1, 2].map((k) => ((id + k) % 3 ? { c: crops[(id + k) % 4], at: Date.now() - ((id * 7 + k * 13) % 30) * 60e3 } : null));
      if (id % 6 === 0 || id % 5 === 0) h.df = { lock: id % 4, dog: id % 6 === 0, alarm: id % 5 === 0 };
      if (id % 9 === 0) h.r = 1;
      if (id % 7 === 0) h.c = ['hatch', 'pickup', 'van', 'sports'][id % 4];
      if (id % 13 === 0) h.m = [demoName(id + 1000)];
      if (id % 8 === 0) h.j = ['farmer', 'guard', 'merchant', 'woodcutter'][id % 4];
    }
    houses.push(h);
  }
  return { b, houses };
}

function demoFind(username) {
  const m = /(\d+)$/.exec(username.replace(/^@/, ''));
  const id = m ? Number(m[1]) : 0;
  return id >= 1 && id <= DEMO_HOUSES && demoName(id) === username.replace(/^@/, '').toLowerCase() && id % 23 !== 0 ? id : 0;
}
