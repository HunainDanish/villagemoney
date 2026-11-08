// Talks to /api, or fakes a town when there is no backend (demo mode).
// Demo mode kicks in automatically under `npm run dev` (Vite has no /api)
// and on a deployment without database environment variables.

import { HOUSES_PER_BLOCK, firstHouseOfBlock } from '../shared/layout.js';

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

export async function loadStats() {
  if (demo) return { residents: DEMO_HOUSES, maxId: DEMO_HOUSES };
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
  } catch {
    return { resident: null };
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
  for (let id = from; id < from + HOUSES_PER_BLOCK && id <= DEMO_HOUSES; id++) {
    const h = { id, u: id % 23 === 0 ? null : demoName(id), lit: id % 3 === 0 ? 1 : undefined }; // a few hidden, some porch lights on
    const t = id % 11 === 0 ? 4 : id % 5 === 0 ? 3 : id % 3 === 0 ? 2 : 0;
    if (t && id !== 7) h.t = t; // house 7 is yours in the demo
    if (id % 4 === 0 && id !== 7) h.p = { wall: id % 10, roof: (id >> 2) % 8 };
    houses.push(h);
  }
  return { b, houses };
}

function demoFind(username) {
  const m = /(\d+)$/.exec(username.replace(/^@/, ''));
  const id = m ? Number(m[1]) : 0;
  return id >= 1 && id <= DEMO_HOUSES && demoName(id) === username.replace(/^@/, '').toLowerCase() && id % 23 !== 0 ? id : 0;
}
