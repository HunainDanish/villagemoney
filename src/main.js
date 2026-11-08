import './style.css';
import * as THREE from 'three';
import { World } from './world.js';
import { Player } from './player.js';
import { Net } from './net.js';
import { Store } from './store.js';
import { Activities } from './activities.js';
import { Particles, sfx, isMuted, setMuted } from './fx.js';
import { loadConfig, loadStats, loadMe, findHouse, send, isDemo } from './api.js';
import { housePosition, blockOfHouse, normalizeUsername } from '../shared/layout.js';
import {
  ITEMS, RECIPES, SKILLS, WALL_PAINTS, ROOF_PAINTS, PAINT_PRICE,
  levelFor, xpForLevel, dailyQuests, questProgress,
} from '../shared/game.js';
import { YARD_SLOTS, PLAZA } from '../shared/nodes.js';

const $ = (id) => document.getElementById(id);
const fmt = new Intl.NumberFormat();
const LABELS = 32;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const hex = (n) => '#' + n.toString(16).padStart(6, '0');

const world = new World($('scene'));
const particles = new Particles(world.scene);
const store = new Store();
let me = null;
let cfg = null;

// ---------- UI helpers used by activities ----------
let toastTimer;
let celebrateTimer;
const ui = {
  toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 3200);
  },
  celebrate(msg) {
    const c = $('celebrate');
    c.textContent = msg;
    c.hidden = false;
    c.style.animation = 'none';
    void c.offsetWidth;
    c.style.animation = '';
    clearTimeout(celebrateTimer);
    celebrateTimer = setTimeout(() => (c.hidden = true), 2800);
  },
  prompt(text, onTap) {
    const p = $('prompt');
    if (!text) return void (p.hidden = true);
    p.textContent = text;
    p.hidden = false;
    p.classList.toggle('action', Boolean(onTap));
    p.onclick = onTap || null;
  },
  bumpBag() {
    const b = $('bag-btn');
    b.classList.remove('bump');
    void b.offsetWidth;
    b.classList.add('bump');
  },
  openHouse,
  openCraft,
  openShop,
  openQuests,
};

const player = new Player(world, $('scene'), {
  onTap: (hit) => activities.tap(hit),
  onStep: (x, z, running) => running && particles.dust(x, z),
});
const activities = new Activities({ world, player, store, particles, labels: $('labels'), ui });
const net = new Net(world, $('labels'));

// ---------- house name labels ----------
const pool = Array.from({ length: LABELS }, () => {
  const el = document.createElement('div');
  el.className = 'label';
  el.style.display = 'none';
  $('labels').append(el);
  return el;
});
const v = new THREE.Vector3();
function drawLabels() {
  const near = world.nearest(player.pos.x, player.pos.z, 60, LABELS);
  pool.forEach((el, i) => {
    const h = near[i];
    if (!h) return void (el.style.display = 'none');
    v.set(h.x, h.style === 1 ? 11.5 : 9.5, h.z).project(world.camera);
    if (v.z > 1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1) return void (el.style.display = 'none');
    el.style.display = '';
    const text = h.u ? `@${h.u}` : 'A neighbour';
    if (el.textContent !== text) el.textContent = text;
    el.classList.toggle('mine', me?.id === h.id);
    el.style.transform = `translate(-50%,-50%) translate(${((v.x + 1) / 2) * innerWidth}px,${((1 - v.y) / 2) * innerHeight}px)`;
  });
}

// ---------- sheets ----------
let sheetRender = null;
function openSheet(title, render) {
  $('sheet-title').textContent = title;
  sheetRender = render;
  $('sheet').hidden = false;
  render($('sheet-body'));
}
function closeSheet() {
  $('sheet').hidden = true;
  sheetRender = null;
}
$('sheet').querySelector('.close').onclick = closeSheet;
const rerender = () => sheetRender && !$('sheet').hidden && sheetRender($('sheet-body'));

async function act(action) {
  const r = await store.act(action);
  if (!r.ok) ui.toast(r.reason.charAt(0).toUpperCase() + r.reason.slice(1));
  return r;
}

function openHouse(h, onKnock) {
  const mine = me?.id === h.id;
  openSheet(h.u ? `@${h.u}` : 'A neighbour', (el) => {
    el.innerHTML = `
      <p>House #${fmt.format(h.id)}${mine ? ' · this is your home' : ''}${world.houses.get(h.id)?.lit ? ' · porch light is on tonight 🏮' : ''}</p>
      <div class="stack">
        ${mine ? '<button class="btn primary" id="h-decor">🪴 Decorate my yard</button>' : '<button class="btn primary" id="h-knock">👋 Knock on the door</button>'}
        ${h.u ? `<a class="btn" target="_blank" rel="noopener" href="https://www.instagram.com/${encodeURIComponent(h.u)}/">Open on Instagram</a>` : ''}
      </div>`;
    el.querySelector('#h-knock')?.addEventListener('click', () => (closeSheet(), onKnock()));
    el.querySelector('#h-decor')?.addEventListener('click', openDecor);
  });
}

function openBag() {
  openSheet('Bag', (el) => {
    const s = store.state;
    const items = Object.entries(s.items).filter(([, n]) => n > 0);
    const skills = Object.entries(SKILLS).map(([k, name]) => {
      const xp = s.xp[k] || 0;
      const lvl = levelFor(xp);
      const pct = Math.round(((xp - xpForLevel(lvl)) / (xpForLevel(lvl + 1) - xpForLevel(lvl))) * 100);
      return `<div class="row"><div class="grow"><b>${name} · level ${lvl}</b><div class="bar"><i style="width:${pct}%"></i></div></div></div>`;
    });
    el.innerHTML = `
      <p>🪙 ${fmt.format(s.coins)} coins · 🔥 ${s.streak || 0}-day streak</p>
      ${items.length ? `<div class="grid">${items.map(([k, n]) => `<div class="cell"><span class="qty">${n}</span><span class="ico">${ITEMS[k]?.icon || '❔'}</span>${esc(ITEMS[k]?.name || k)}</div>`).join('')}</div>` : '<p>Your bag is empty. Tap a tree to chop it, or a flower to pick it.</p>'}
      <h3>Skills</h3>${skills.join('')}
      ${!store.member ? `<p>${isDemo() ? 'Demo mode: progress is saved in this browser.' : 'Playing as a guest: progress is saved in this browser only. Get a house key to keep it.'}</p>` : ''}`;
  });
}

function openCraft() {
  openSheet('Workbench', (el) => {
    const s = store.state;
    el.innerHTML = `<p>Craft decorations for your yard.</p>${Object.entries(RECIPES)
      .map(([k, r]) => {
        const can = Object.entries(r).every(([i, n]) => (s.items[i] || 0) >= n);
        const cost = Object.entries(r).map(([i, n]) => `${ITEMS[i].icon} ${s.items[i] || 0}/${n}`).join(' · ');
        return `<div class="row"><span class="ico">${ITEMS[k].icon}</span><div class="grow"><b>${ITEMS[k].name}</b><small>${cost}${s.items[k] ? ` · you have ${s.items[k]}` : ''}</small></div><button class="btn ${can ? 'good' : ''}" data-r="${k}" ${can ? '' : 'disabled'}>Craft</button></div>`;
      })
      .join('')}`;
    el.querySelectorAll('[data-r]').forEach((b) =>
      (b.onclick = async () => {
        player.char.play('chop', 'axe');
        sfx.chop();
        setTimeout(sfx.chop, 300);
        const r = await act({ a: 'craft', r: b.dataset.r });
        setTimeout(() => player.char.stop(), 700);
        if (r.ok) {
          sfx.pickup();
          particles.sparkle(player.pos.x, 3, player.pos.z);
          ui.celebrate(`Crafted: ${ITEMS[b.dataset.r].name} ${ITEMS[b.dataset.r].icon}`);
        }
      }),
    );
  });
}

function openShop() {
  openSheet('Market stall', (el) => {
    const s = store.state;
    const sellable = Object.entries(s.items).filter(([k, n]) => n > 0 && ITEMS[k]?.sell);
    const paints = (list, part) =>
      `<div class="swatches">${list.map((c, i) => `<button class="swatch ${s.paint?.[part] === i ? 'on' : ''}" style="background:${hex(c)}" data-part="${part}" data-c="${i}" aria-label="${part} colour ${i + 1}"></button>`).join('')}</div>`;
    el.innerHTML = `
      <p>🪙 ${fmt.format(s.coins)} coins. Sell what you gather, then repaint your house.</p>
      ${sellable.length ? sellable.map(([k, n]) => `<div class="row"><span class="ico">${ITEMS[k].icon}</span><div class="grow"><b>${ITEMS[k].name} × ${n}</b><small>${ITEMS[k].sell} 🪙 each</small></div><button class="btn" data-sell="${k}" data-n="1">Sell 1</button><button class="btn good" data-sell="${k}" data-n="${n}">All</button></div>`).join('') : '<p>Nothing to sell yet.</p>'}
      <h3>Wall paint · ${PAINT_PRICE} 🪙</h3>${paints(WALL_PAINTS, 'wall')}
      <h3>Roof paint · ${PAINT_PRICE} 🪙</h3>${paints(ROOF_PAINTS, 'roof')}
      ${me ? '' : '<p>Paint shows on your house once you have one.</p>'}`;
    el.querySelectorAll('[data-sell]').forEach((b) =>
      (b.onclick = async () => {
        const r = await act({ a: 'sell', item: b.dataset.sell, qty: Number(b.dataset.n) });
        if (r.ok) sfx.pickup();
      }),
    );
    el.querySelectorAll('[data-part]').forEach((b) =>
      (b.onclick = async () => {
        if (!confirm(`Buy this ${b.dataset.part} paint for ${PAINT_PRICE} coins?`)) return;
        const r = await act({ a: 'paint', part: b.dataset.part, color: Number(b.dataset.c) });
        if (r.ok) {
          sfx.level();
          syncOwnHouse();
          ui.celebrate('Fresh paint! 🎨');
        }
      }),
    );
  });
}

function openQuests() {
  openSheet('Daily quests', (el) => {
    const s = store.state;
    const qs = dailyQuests(s.day, store.seed);
    el.innerHTML = `<p>New quests every day. Finish all three for a 30 🪙 bonus. 🔥 Streak: ${s.streak || 0} day${s.streak === 1 ? '' : 's'}.</p>${qs
      .map((q, i) => {
        const prog = questProgress(s, q);
        const claimed = s.quests & (1 << i);
        const done = prog >= q.n;
        return `<div class="row"><span class="ico">${claimed ? '✅' : '📜'}</span><div class="grow"><b>${esc(q.text)}</b><small>${prog}/${q.n} · reward ${q.coins} 🪙</small><div class="bar"><i style="width:${(prog / q.n) * 100}%"></i></div></div>${claimed ? '' : `<button class="btn ${done ? 'good' : ''}" data-q="${i}" ${done ? '' : 'disabled'}>Claim</button>`}</div>`;
      })
      .join('')}`;
    el.querySelectorAll('[data-q]').forEach((b) =>
      (b.onclick = async () => {
        const r = await act({ a: 'claim', q: Number(b.dataset.q) });
        if (r.ok) {
          sfx.level();
          ui.celebrate(`Quest complete! +${r.events.reduce((a, e) => a + (e.coins || 0), 0)} 🪙`);
        }
      }),
    );
  });
}

function openDecor() {
  if (!me) return ui.toast('Get your house key first');
  openSheet('Decorate my yard', (el) => {
    const s = store.state;
    const owned = Object.keys(ITEMS).filter((k) => ITEMS[k].decor && (s.items[k] || 0) > 0);
    el.innerHTML = `<p>Six spots around your house. Neighbours see your yard when they walk by.</p>${YARD_SLOTS.map((_, i) => {
      const cur = s.decor[i];
      const opts = ['<option value="">Empty</option>', ...(cur ? [`<option value="${cur}" selected>${ITEMS[cur].icon} ${ITEMS[cur].name}</option>`] : []), ...owned.filter((k) => k !== cur).map((k) => `<option value="${k}">${ITEMS[k].icon} ${ITEMS[k].name} (${s.items[k]})</option>`)];
      return `<div class="row"><span class="ico">${cur ? ITEMS[cur].icon : '⬜'}</span><div class="grow"><b>Spot ${i + 1}</b></div><select data-slot="${i}">${opts.join('')}</select></div>`;
    }).join('')}${owned.length || s.decor.some(Boolean) ? '' : '<p>Craft decorations at the workbench in the plaza first.</p>'}`;
    el.querySelectorAll('[data-slot]').forEach((sel) =>
      (sel.onchange = async () => {
        const r = await act({ a: 'place', slot: Number(sel.dataset.slot), item: sel.value || null });
        if (r.ok) {
          sfx.pickup();
          syncOwnHouse();
          goToHouse(me.id, false);
        }
      }),
    );
  });
}

function openMenu() {
  openSheet('Menu', (el) => {
    el.innerHTML = `
      ${me ? `<p>Signed in as <b>@${esc(me.username)}</b> · House #${fmt.format(me.id)}</p>` : `<p>${isDemo() ? 'Demo mode.' : 'You are exploring as a guest.'}</p>`}
      <label class="toggle"><input type="checkbox" id="m-sound" ${isMuted() ? '' : 'checked'} /> Sound effects</label>
      ${me && !me.demo ? `<label class="toggle"><input type="checkbox" id="m-hide" ${me.hidden ? 'checked' : ''} /> Hide my username (shows as “A neighbour”)</label>` : ''}
      <div class="stack">
        ${me ? '<button class="btn" id="m-decor">🪴 Decorate my yard</button>' : ''}
        ${me && !me.demo ? '<button class="btn" id="m-logout">Sign out</button><button class="btn danger" id="m-delete">Delete my house and account</button>' : ''}
        <a class="btn" href="/privacy">Privacy</a>
      </div>`;
    el.querySelector('#m-sound').onchange = (e) => setMuted(!e.target.checked);
    el.querySelector('#m-decor')?.addEventListener('click', openDecor);
    el.querySelector('#m-hide')?.addEventListener('change', async (e) => {
      try {
        ({ resident: me } = await send('PATCH', '/api/me', { hidden: e.target.checked }));
        renderMe();
        world.refreshBlock(blockOfHouse(me.id));
        ui.toast(me.hidden ? 'Your name is hidden' : 'Your name is visible');
      } catch (err) {
        e.target.checked = !e.target.checked;
        ui.toast(err.message);
      }
    });
    el.querySelector('#m-logout')?.addEventListener('click', async () => {
      await store.flush();
      await send('POST', '/api/auth/logout').catch(() => {});
      location.reload();
    });
    el.querySelector('#m-delete')?.addEventListener('click', async () => {
      if (!confirm('Delete your house, your progress and your account? This cannot be undone.')) return;
      try {
        await send('DELETE', '/api/me');
        location.reload();
      } catch (err) {
        ui.toast(err.message);
      }
    });
  });
}

// ---------- navigation ----------
function goToHouse(id, mark = true) {
  const p = housePosition(id);
  const dx = Math.sin(p.facing);
  const dz = Math.cos(p.facing);
  player.teleport(p.x + dx * 10, p.z + dz * 10, p.x, p.z);
  if (mark) world.showMarker(id);
}

$('search').onsubmit = async (e) => {
  e.preventDefault();
  const u = normalizeUsername($('search-input').value);
  if (!u) return ui.toast('Type an Instagram username');
  try {
    const r = await findHouse(u);
    if (!r.found) return ui.toast(`No house for @${u} yet`);
    goToHouse(r.id);
    $('search-input').blur();
    ui.toast(`Walking you to @${u}'s house`);
  } catch (err) {
    ui.toast(err.message);
  }
};

$('bag-btn').onclick = openBag;
$('quests-btn').onclick = openQuests;
$('settings-btn').onclick = openMenu;
$('plaza-btn').onclick = () => {
  closeSheet();
  player.teleport(0, 22, 0, 0);
  world.showMarker(null);
  ui.toast('Welcome to the plaza: workbench, market, pond and quest board');
};
$('home-btn').onclick = () => me && (closeSheet(), goToHouse(me.id));

function renderMe() {
  $('home-btn').hidden = !me;
  $('key-btn').hidden = Boolean(me);
  net.name = me && !me.hidden ? me.username : 'Neighbour';
}

// Show my own decor/paint right away (the shared CDN copy updates later).
function syncOwnHouse() {
  if (!me) return;
  world.setOverride(me.id, { d: store.state.decor, p: store.state.paint, lit: 1 });
}

store.on((state, events) => {
  $('coins').textContent = `🪙 ${fmt.format(state.coins)}`;
  if (events?.some((e) => e.type === 'coins')) {
    $('coins').classList.remove('bump');
    void $('coins').offsetWidth;
    $('coins').classList.add('bump');
  }
  for (const e of events || []) if (e.type === 'daily') ui.celebrate(`🔥 Day ${e.streak} streak · +${e.coins} 🪙`);
  world.markNodesDirty();
  rerender();
});

async function refreshStats() {
  try {
    const s = await loadStats();
    world.setTotal(s.maxId);
    $('count').textContent = `${fmt.format(s.residents)} people live here`;
  } catch {
    $('count').textContent = 'Town is offline, try again soon';
  }
}

// ---------- boot ----------
async function boot() {
  cfg = await loadConfig();
  document.title = `${cfg.townName}: a home for every follower`;
  $('town-name').textContent = cfg.townName;
  $('demo-badge').hidden = !isDemo();
  const keyBtn = $('key-btn');
  if (cfg.igHandle) keyBtn.href = `https://ig.me/m/${encodeURIComponent(cfg.igHandle)}`;
  else keyBtn.onclick = (e) => (e.preventDefault(), ui.toast(isDemo() ? 'Sign-in is off in demo mode' : 'Instagram sign-in is coming soon'));

  await refreshStats();
  setInterval(refreshStats, 60000);

  const res = await loadMe();
  me = res.resident;
  if (me && res.state) store.initMember(me, res.state, res.events);
  else {
    if (isDemo()) me = { id: 7, username: demoNameFor(7), hidden: false, demo: true };
    await store.initGuest();
  }
  renderMe();
  syncOwnHouse();
  const params = new URLSearchParams(location.search);
  if (me && params.has('home')) {
    goToHouse(me.id);
    ui.celebrate(`Welcome home, @${me.username}! 🏠`);
    history.replaceState(null, '', '/');
  }

  if (await net.connect(cfg.supabaseUrl, cfg.supabaseAnonKey)) addEventListener('pagehide', () => net.leave());
  else if (isDemo()) net.startBots();
  net.onCount = (n) => ($('online').textContent = n);
}

function demoNameFor(id) {
  // Imported lazily to keep demo-only code out of the main path.
  return `you.demo${id}`;
}

addEventListener('resize', () => world.resize());
let last = performance.now();
let clockAt = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const t = now / 1000;
  player.update(dt);
  world.update(player.pos.x, player.pos.z, t, dt);
  activities.update(t);
  net.update(player, dt, now);
  particles.update(dt);
  world.render(player.char.group);
  drawLabels();
  if (now - clockAt > 1000) {
    clockAt = now;
    $('clock').textContent = `${world.night > 0.5 ? '🌙' : '☀️'} ${world.sky.clock()}`;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
boot();

// Expose a tiny debug handle in development only.
if (import.meta.env.DEV) window.__town = { world, player, store, PLAZA };
