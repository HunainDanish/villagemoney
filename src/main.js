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
  ITEMS, RECIPES, SKILLS, WALL_PAINTS, ROOF_PAINTS, PAINT_PRICE, HOUSE_TIERS,
  levelFor, xpForLevel, dailyQuests, questProgress,
} from '../shared/game.js';
import { YARD_SLOTS, PLAZA } from '../shared/nodes.js';
import { JOBS, COOKBOOK, SNACKS, ENERGY_MAX, defenceScore, STAY, HOUSE_POINT_COST } from '../shared/life.js';
import { energyNow } from '../shared/game.js';
import { createLifeUI } from './life-ui.js';
import { Joystick } from './joystick.js';
import { Navigator, doorPoint } from './nav.js';
import { REACTIONS, Bubbles } from './reactions.js';
import { GAME } from '../shared/features.js';
import { PALETTES, PREMIUM, PREMIUM_TIER, PART_UNLOCK, PART_NAMES, STARTER_STYLES, lookFor, paletteFor } from '../shared/style.js';

const $ = (id) => document.getElementById(id);
const fmt = new Intl.NumberFormat();
const LABELS = 32;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
// Phones: open a DM in the Instagram app. Desktop: ig.me DM links often show
// "page isn't available", so open the profile, which has a Message button.
const dmLink = (handle) =>
  matchMedia('(pointer: coarse)').matches
    ? `https://ig.me/m/${encodeURIComponent(handle)}`
    : `https://www.instagram.com/${encodeURIComponent(handle)}/`;
const hex = (n) => '#' + n.toString(16).padStart(6, '0');

const world = new World($('scene'));
const particles = new Particles(world.scene);
const store = new Store();
store.onNotice = (msg) => ui.toast(msg);
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
  openGrocer: () => life.openGrocer(),
  openShowroom: () => life.openShowroom(),
  // Tapped a garden bed: your own opens the garden, others open the house card.
  openBed: (bed, knock) => (me && bed.house.id === me.id ? life.openGarden() : openHouse(bed.house, knock)),
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
    v.set(h.x, h.height || 10, h.z).project(world.camera);
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
  $('sheet').classList.remove('short');
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
  const mine = me?.id === h.id || (me?.home_id && me.home_id === h.id);
  if (!GAME) return openPlainHouse(h, mine, onKnock);
  if (mine) return openMyHouse();
  openSheet(h.label || (h.u ? `@${h.u}` : 'A neighbour'), (el) => {
    const job = h.j && JOBS[h.j] ? `${JOBS[h.j].icon} ${JOBS[h.j].name}` : '';
    const def = h.df ? (h.df.lock || 0) + (h.df.dog ? 2 : 0) + (h.df.alarm ? 1 : 0) + (h.j === 'guard' ? 2 : 0) : h.j === 'guard' ? 2 : 0;
    const tags = [
      `House #${fmt.format(h.id)}`,
      HOUSE_TIERS[(h.t || 1) - 1]?.name,
      job,
      world.houses.get(h.id)?.lit ? 'porch light on 🏮' : '',
      h.r ? ((h.sh || 0) > Date.now() ? '🛡️ shielded' : `⚔️ raid mode · defence ${def}`) : '',
    ].filter(Boolean);
    el.innerHTML = `
      <p>${tags.join(' · ')}</p>
      <div class="stack">
        <button class="btn primary" id="h-knock">👋 Knock on the door</button>
        ${life.houseActions(h)}
        ${h.u ? `<a class="btn" target="_blank" rel="noopener" href="https://www.instagram.com/${encodeURIComponent(h.u)}/">Open on Instagram</a>` : ''}
      </div>`;
    el.querySelector('#h-knock')?.addEventListener('click', () => (closeSheet(), onKnock(h)));
    life.bindHouseActions(el, h, (house, then) => onKnock(house, then));
  });
}

// Just houses: a simple card. Your own house, or a neighbour's with knock.
function openPlainHouse(h, mine, onKnock) {
  openSheet(mine ? 'Your home 🏠' : h.u ? `@${h.u}` : 'A neighbour', (el) => {
    const tierName = HOUSE_TIERS[(h.t || 1) - 1]?.name || 'Starter home';
    el.innerHTML = `
      <p>House #${fmt.format(h.id)} · ${tierName}${world.houses.get(h.id)?.lit ? ' · porch light is on tonight 🏮' : ''}</p>
      ${mine ? upgradeByPointsHTML() : ''}
      <div class="stack">
        ${mine ? '' : '<button class="btn primary" id="h-knock">👋 Knock on the door</button>'}
        <button class="btn" id="h-walk">🧭 ${player.vehicle ? 'Drive' : 'Walk'} here</button>
        ${h.u ? `<a class="btn" target="_blank" rel="noopener" href="https://www.instagram.com/${encodeURIComponent(h.u)}/">Open on Instagram</a>` : ''}
      </div>`;
    el.querySelector('#h-knock')?.addEventListener('click', () => (closeSheet(), onKnock(h)));
    el.querySelector('#customize-btn')?.addEventListener('click', openCustomize);
    el.querySelector('#h-walk')?.addEventListener('click', () => {
      closeSheet();
      directionsToHouse(h.id, mine ? 'your house' : h.u ? `@${h.u}'s house` : 'this house');
    });
    el.querySelector('#pt-up')?.addEventListener('click', async () => {
      const r = await act({ a: 'pointUpgrade' });
      if (!r.ok) return;
      sfx.level();
      syncOwnHouse();
      const p = housePosition(me.home_id || me.id);
      for (let i = 0; i < 4; i++) setTimeout(() => particles.sparkle(p.x + (Math.random() - 0.5) * 8, 4 + Math.random() * 4, p.z + (Math.random() - 0.5) * 6), i * 180);
      player.shake = 0.4;
      ui.celebrate(`🏡 Upgraded to ${r.events.find((e) => e.type === 'upgrade')?.name}!`);
      openPlainHouse({ ...h, t: store.state.tier }, true, onKnock);
    });
  });
}

// Customise your house: free; upgrades unlock more parts. Every change shows
// on your house right away (it's visible just above this sheet).
function openCustomize() {
  if (!me) return;
  openSheet('Customize my house', (el) => {
    $('sheet').classList.add('short'); // keep your house visible above
    const s = store.state;
    const tier = s.tier || 1;
    const look = lookFor(me.home_id || me.id, s.paint);
    const tierName = (t) => HOUSE_TIERS[t - 1]?.name;
    const section = (part) => {
      const locked = tier < PART_UNLOCK[part];
      const head = `<h3>${PART_NAMES[part]}${locked ? ` · 🔒 unlocks with ${tierName(PART_UNLOCK[part])}` : ''}</h3>`;
      if (part === 'style') {
        return head + `<div class="wrap">${STARTER_STYLES.map((n, i) => `<button class="btn ${look.style === i ? 'primary' : ''}" data-part="style" data-i="${i}" ${locked ? 'disabled' : ''}>${n}</button>`).join('')}</div>${tier > 1 ? '<p>Your style shows when your house is a starter home; upgraded houses have their own shape.</p>' : ''}`;
      }
      const base = PALETTES[part].length;
      return head + `<div class="swatches">${paletteFor(part).map((c, i) => {
        const premium = i >= base;
        const off = locked || (premium && tier < PREMIUM_TIER);
        return `<button class="swatch ${look[part] === i ? 'on' : ''} ${off ? 'locked' : ''}" style="background:${hex(c)}" data-part="${part}" data-i="${i}" ${off ? 'disabled' : ''} title="${premium ? 'Mansion colour' : ''}" aria-label="${PART_NAMES[part]} colour ${i + 1}">${premium ? '✨' : ''}</button>`;
      }).join('')}</div>`;
    };
    el.innerHTML = `
      <p>Free to change any time. Every house starts with its own unique look, and upgrading unlocks more to customise. ✨ colours unlock with the Mansion.</p>
      ${['style', 'wall', 'roof', 'door', 'trim', 'shutter'].map(section).join('')}
      <p>${tier < 4 ? 'Shutters appear on cottages, family homes, two-storey houses and manors.' : ''}</p>`;
    el.querySelectorAll('[data-part]').forEach((b) =>
      (b.onclick = async () => {
        const r = await act({ a: 'customize', part: b.dataset.part, index: Number(b.dataset.i) });
        if (r.ok) {
          sfx.click();
          syncOwnHouse();
        }
      }),
    );
  });
}

// Today's progress, points and the next upgrade, for your own house card.
function upgradeByPointsHTML() {
  const s = store.state;
  const mins = Math.min(STAY.minutesPerPoint, s.counts?.minutes || 0);
  const done = mins >= STAY.minutesPerPoint;
  const tier = s.tier || 1;
  const nextCost = HOUSE_POINT_COST[tier + 1];
  const next = HOUSE_TIERS[tier];
  const pts = s.points || 0;
  return `
    <p>This is your house. Spend <b>15 active minutes</b> in town each day to earn <b>1 house point</b>, then use points to upgrade.</p>
    <div class="row"><span class="ico">⏳</span><div class="grow"><b>Today: ${mins}/${STAY.minutesPerPoint} min${done ? ' ✓ point earned' : ''}</b><div class="bar"><i style="width:${(mins / STAY.minutesPerPoint) * 100}%"></i></div><small>${done ? 'Come back tomorrow for another point.' : 'Only counts while this tab is open and you are moving around.'}</small></div></div>
    <div class="stack"><button class="btn primary" id="customize-btn">🎨 Customize my house</button></div>
    ${next ? `<div class="row"><span class="ico">⬆️</span><div class="grow"><b>Upgrade to ${next.name}</b><small>${next.blurb}</small><small>🏠 ${pts}/${nextCost} house points</small></div><button class="btn ${pts >= nextCost ? 'good' : ''}" id="pt-up" ${pts >= nextCost ? '' : 'disabled'}>Upgrade</button></div>` : '<p>🏆 Your house is fully upgraded: a mansion!</p>'}`;
}

function openBag() {
  openSheet('Bag', (el) => {
    const s = store.state;
    const items = Object.entries(s.items).filter(([, n]) => n > 0);
    const food = items.filter(([k]) => COOKBOOK[k] || SNACKS[k]);
    const skills = Object.entries(SKILLS).map(([k, name]) => {
      const xp = s.xp[k] || 0;
      const lvl = levelFor(xp);
      const pct = Math.round(((xp - xpForLevel(lvl)) / (xpForLevel(lvl + 1) - xpForLevel(lvl))) * 100);
      return `<div class="row"><div class="grow"><b>${name} · level ${lvl}</b><div class="bar"><i style="width:${pct}%"></i></div></div></div>`;
    });
    el.innerHTML = `
      <p>🪙 ${fmt.format(s.coins)} coins · 🔥 ${s.streak || 0}-day streak</p>
      ${items.length ? `<div class="grid">${items.map(([k, n]) => `<div class="cell"><span class="qty">${n}</span><span class="ico">${ITEMS[k]?.icon || '❔'}</span>${esc(ITEMS[k]?.name || k)}</div>`).join('')}</div>` : '<p>Your bag is empty. Tap a tree to chop it, or a flower to pick it.</p>'}
      ${food.length ? `<h3>Food · ⚡ ${energyNow(s, Date.now())}/${ENERGY_MAX}</h3>${food.map(([k, n]) => `<div class="row"><span class="ico">${ITEMS[k].icon}</span><div class="grow"><b>${ITEMS[k].name} × ${n}</b><small>+${COOKBOOK[k]?.energy ?? SNACKS[k]} ⚡</small></div><button class="btn" data-eat="${k}">Eat</button></div>`).join('')}` : ''}
      <h3>Skills</h3>${skills.join('')}
      ${!store.member ? `<p>${isDemo() ? 'Demo mode: progress is saved in this browser.' : 'Playing as a guest: progress is saved in this browser only. Get a house key to keep it.'}</p>` : ''}`;
    el.querySelectorAll('[data-eat]').forEach((b) => (b.onclick = () => life.eat(b.dataset.eat)));
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
    el.innerHTML = `
      <p>🪙 ${fmt.format(s.coins)} coins. Sell what you gather, then repaint your house.</p>
      ${sellable.length ? sellable.map(([k, n]) => `<div class="row"><span class="ico">${ITEMS[k].icon}</span><div class="grow"><b>${ITEMS[k].name} × ${n}</b><small>${ITEMS[k].sell} 🪙 each</small></div><button class="btn" data-sell="${k}" data-n="1">Sell 1</button><button class="btn good" data-sell="${k}" data-n="${n}">All</button></div>`).join('') : '<p>Nothing to sell yet.</p>'}
      <p>Spend coins on paint and upgrades in <b>🏠 My house</b>.</p>
      ${me ? '<button class="btn primary" id="shop-home">🏠 Go to my house</button>' : ''}`;
    el.querySelector('#shop-home')?.addEventListener('click', () => goHome());
    el.querySelectorAll('[data-sell]').forEach((b) =>
      (b.onclick = async () => {
        const r = await act({ a: 'sell', item: b.dataset.sell, qty: Number(b.dataset.n) });
        if (r.ok) sfx.pickup();
      }),
    );
  });
}

// My house: upgrade, paint and decorate, standing in front of it so every
// change is visible immediately.
function openMyHouse() {
  if (!GAME && me) {
    const id = me.home_id || me.id;
    const rec = (world.drawnAll || []).find((x) => x.id === id) || { id, u: me.username };
    return openPlainHouse({ ...rec, t: store.state.tier || 1 }, true, () => {});
  }
  if (!me) {
    return openSheet('Your own house', (el) => {
      el.innerHTML = `<p>Every follower gets a house in town. ${isDemo() ? 'Sign-in is off in demo mode.' : 'DM us the word <b>key</b> on Instagram to get yours, then upgrade, paint and decorate it here.'}</p>
        ${cfg?.igHandle ? `<a class="btn primary" target="_blank" rel="noopener" href="${dmLink(cfg.igHandle)}">🔑 Get my house key</a>` : ''}`;
    });
  }
  openSheet('My house', (el) => {
    const s = store.state;
    const tier = s.tier || 1;
    const cur = HOUSE_TIERS[tier - 1];
    const next = HOUSE_TIERS[tier];
    let upgrade = '<p>🏆 Your house is fully upgraded. Neighbours can see your mansion from down the street.</p>';
    if (next) {
      const { coins = 0, ...mats } = next.cost;
      const have = (i) => s.items[i] || 0;
      const can = Object.entries(mats).every(([i, n]) => have(i) >= n) && s.coins >= coins;
      const cost = [...Object.entries(mats).map(([i, n]) => `${ITEMS[i].icon} ${have(i)}/${n}`), `🪙 ${fmt.format(s.coins)}/${coins}`].join(' · ');
      upgrade = `<div class="row"><span class="ico">⬆️</span><div class="grow"><b>Upgrade to ${next.name}</b><small>${next.blurb}</small><small>${cost}</small></div><button class="btn ${can ? 'good' : ''}" id="up-btn" ${can ? '' : 'disabled'}>Upgrade</button></div>
        ${can ? '' : '<p>Chop trees for logs, mine rocks for stone, and sell at the market for coins.</p>'}`;
    }
    const swatches = (list, part) =>
      `<div class="swatches">${list.map((c, i) => `<button class="swatch ${s.paint?.[part] === i ? 'on' : ''}" style="background:${hex(c)}" data-part="${part}" data-c="${i}" aria-label="${part} colour ${i + 1}"></button>`).join('')}</div>`;
    el.innerHTML = `
      <p>House #${fmt.format(me.id)} · <b>${cur.name}</b> (level ${tier} of ${HOUSE_TIERS.length}) · 🪙 ${fmt.format(s.coins)}</p>
      ${upgrade}
      <h3>Wall paint · ${PAINT_PRICE} 🪙 each</h3>${swatches(WALL_PAINTS, 'wall')}
      <h3>Roof paint · ${PAINT_PRICE} 🪙 each</h3>${swatches(ROOF_PAINTS, 'roof')}
      <div class="stack">
        <button class="btn" id="decor-btn">🪴 Decorate my yard</button>
        <button class="btn" id="garden-btn">🌱 Garden</button>
        <button class="btn" id="kitchen-btn">🍳 Kitchen</button>
        <button class="btn" id="job-btn">💼 Job${s.job && JOBS[s.job] ? `: ${JOBS[s.job].icon} ${JOBS[s.job].name}` : ''}</button>
        <button class="btn" id="defence-btn">🛡️ Defences &amp; raid mode · ${defenceScore(s)}</button>
        <button class="btn" id="garage-btn">🚗 Cars${s.cars?.length ? ` (${s.cars.length})` : ''}</button>
      </div>`;
    el.querySelector('#decor-btn').onclick = openDecor;
    el.querySelector('#garden-btn').onclick = life.openGarden;
    el.querySelector('#kitchen-btn').onclick = life.openKitchen;
    el.querySelector('#job-btn').onclick = life.openJob;
    el.querySelector('#defence-btn').onclick = life.openDefence;
    el.querySelector('#garage-btn').onclick = life.openShowroom;
    el.querySelector('#up-btn')?.addEventListener('click', async () => {
      const r = await act({ a: 'upgrade' });
      if (!r.ok) return;
      sfx.level();
      syncOwnHouse();
      const p = housePosition(me.id);
      for (let i = 0; i < 4; i++) setTimeout(() => particles.sparkle(p.x + (Math.random() - 0.5) * 8, 4 + Math.random() * 4, p.z + (Math.random() - 0.5) * 6), i * 180);
      player.shake = 0.4;
      ui.celebrate(`🏡 Upgraded to ${r.events.find((e) => e.type === 'upgrade')?.name}!`);
    });
    el.querySelectorAll('[data-part]').forEach((b) =>
      (b.onclick = async () => {
        const part = b.dataset.part;
        const color = Number(b.dataset.c);
        if (s.paint?.[part] === color) return;
        if (!confirm(`Paint your ${part === 'wall' ? 'walls' : 'roof'} this colour for ${PAINT_PRICE} coins?`)) return;
        const r = await act({ a: 'paint', part, color });
        if (r.ok) {
          sfx.pickup();
          syncOwnHouse();
          ui.celebrate('Fresh paint! 🎨');
        }
      }),
    );
  });
}

// Sign in: password for returning residents, or get a house key by DM.
function openSignIn() {
  openSheet('Sign in', (el) => {
    el.innerHTML = `
      <form id="signin-form" class="form" autocomplete="on">
        <label>Instagram username
          <input name="username" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="your_username" required maxlength="31" />
        </label>
        <label>Password
          <input name="password" type="password" autocomplete="current-password" required maxlength="200" />
        </label>
        <button class="btn primary" type="submit">Sign in</button>
        <p class="form-error" id="signin-error" hidden></p>
      </form>
      <h3>New here, or forgot your password?</h3>
      <p>DM us the word <b>key</b> on Instagram and we'll send you a sign-in link. Once you're in, you can set a password in ⚙️ Menu.</p>
      ${cfg?.igHandle ? `<a class="btn" target="_blank" rel="noopener" href="${dmLink(cfg.igHandle)}">💬 DM @${esc(cfg.igHandle)}</a>` : ''}`;
    const form = el.querySelector('#signin-form');
    form.onsubmit = async (e) => {
      e.preventDefault();
      const err = el.querySelector('#signin-error');
      const btn = form.querySelector('button');
      err.hidden = true;
      btn.disabled = true;
      try {
        const data = new FormData(form);
        await send('POST', '/api/auth/login', { username: String(data.get('username')).replace(/^@/, '').trim(), password: data.get('password') });
        location.replace('/?home=1');
      } catch (ex) {
        err.textContent = ex.message;
        err.hidden = false;
        btn.disabled = false;
      }
    };
  });
}

// Set or change your password (signed in only).
function openPassword() {
  openSheet(me?.has_password ? 'Change my password' : 'Set a password', (el) => {
    el.innerHTML = `
      <p>Sign in on any device with <b>@${esc(me.username)}</b> and this password, without needing a new key. Use at least 8 characters, and don't reuse your Instagram password.</p>
      <form id="pw-form" class="form">
        <input name="username" autocomplete="username" value="${esc(me.username)}" hidden />
        <label>New password
          <input name="pw" type="password" autocomplete="new-password" minlength="8" maxlength="200" required />
        </label>
        <label>Type it again
          <input name="pw2" type="password" autocomplete="new-password" minlength="8" maxlength="200" required />
        </label>
        <button class="btn primary" type="submit">Save password</button>
        <p class="form-error" id="pw-error" hidden></p>
      </form>`;
    const form = el.querySelector('#pw-form');
    form.onsubmit = async (e) => {
      e.preventDefault();
      const err = el.querySelector('#pw-error');
      const data = new FormData(form);
      if (data.get('pw') !== data.get('pw2')) {
        err.textContent = "The two passwords don't match.";
        err.hidden = false;
        return;
      }
      try {
        await send('POST', '/api/auth/password', { password: data.get('pw') });
        me = { ...me, has_password: true };
        closeSheet();
        ui.celebrate('Password saved 🔒 You can now sign in on any device.');
      } catch (ex) {
        err.textContent = ex.message;
        err.hidden = false;
      }
    };
  });
}

// Live players status line for the Menu.
function liveStatus() {
  const n = net.peers.size;
  if (isDemo()) return '👥 Demo mode: the walkers are bots.';
  if (net.status === 'live') {
    const here = net.channel ? Object.keys(net.channel.presenceState()).length : 0;
    return `🟢 Live: you can see other players · ${n} nearby<br><small>Channel ${esc(net.region || '?')} · ${here} connected here (including you) · id ${esc(net.id.slice(0, 6))}</small>`;
  }
  if (net.status === 'connecting') return '🟡 Connecting to live players…';
  if (net.status === 'error') return `🔴 Live players unavailable (${esc(net.error || 'connection error')}). Check Supabase → Realtime settings.`;
  return '⚪ Live players are off: the Supabase publishable key is not set.';
}

// Walk the player to their own front door and open My house.
function goHome() {
  if (!me) return openMyHouse();
  closeSheet();
  goToHouse(me.home_id || me.id);
  openMyHouse();
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
          goToHouse(me.home_id || me.id, false);
        }
      }),
    );
  });
}

function openMenu() {
  openSheet('Menu', (el) => {
    el.innerHTML = `
      ${me ? `<p>Signed in as <b>@${esc(me.username)}</b> · House #${fmt.format(me.id)}</p>` : `<p>${isDemo() ? 'Demo mode.' : 'You are exploring as a guest.'}</p>`}
      <p>${liveStatus()}</p>
      <label class="toggle"><input type="checkbox" id="m-sound" ${isMuted() ? '' : 'checked'} /> Sound effects</label>
      ${me && !me.demo ? `<label class="toggle"><input type="checkbox" id="m-hide" ${me.hidden ? 'checked' : ''} /> Hide my username (shows as “A neighbour”)</label>` : ''}
      <div class="stack">
        ${me ? '<button class="btn" id="m-decor">🪴 Decorate my yard</button>' : ''}
        ${me && !me.demo ? `<button class="btn" id="m-password">🔒 ${me.has_password ? 'Change my password' : 'Set a password'}</button>` : ''}
        ${!me && !isDemo() ? '<button class="btn primary" id="m-signin">Sign in</button>' : ''}
        ${me && !me.demo ? '<button class="btn" id="m-logout">Sign out</button><button class="btn danger" id="m-delete">Delete my house and account</button>' : ''}
        <a class="btn" href="/privacy">Privacy</a>
      </div>`;
    el.querySelector('#m-sound').onchange = (e) => setMuted(!e.target.checked);
    el.querySelector('#m-decor')?.addEventListener('click', openDecor);
    el.querySelector('#m-password')?.addEventListener('click', openPassword);
    el.querySelector('#m-signin')?.addEventListener('click', openSignIn);
    el.querySelector('#m-hide')?.addEventListener('change', async (e) => {
      try {
        const { resident } = await send('PATCH', '/api/me', { hidden: e.target.checked });
        me = { ...me, ...resident };
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
  player.teleport(0, -22, 0, 0); // facing the fountain, camera clear of buildings
  world.showMarker(null);
  ui.toast(GAME ? 'Welcome to the plaza: workbench, market, pond and quest board' : 'Welcome to the plaza ⛲');
};
$('home-btn').onclick = goHome;
$('friends-btn').onclick = () => life.openFriends();
$('drive-btn').onclick = () => {
  if (player.vehicle) {
    player.setVehicle(null);
    world.hiddenCar = null;
    ui.toast('You parked and got out 🚶');
  } else {
    const car = store.state.car;
    if (!car) return life.openShowroom();
    player.setVehicle(car);
    world.hiddenCar = me?.id ?? null;
    ui.toast('Vroom! Tap 🚗 again to get out');
  }
  world.dirtyHouses = true;
  renderDrive();
};

// Show the drive button once you own a car.
// ---------- daily stay timer ----------
// One "tick" per minute while the tab is visible and you've moved or tapped
// in the last 3 minutes. The server checks the timing; 15 a day = 1 point.
let lastInput = performance.now();
for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart']) addEventListener(ev, () => (lastInput = performance.now()), { passive: true });
setInterval(() => {
  if (GAME || !me || document.visibilityState !== 'visible') return;
  const active = performance.now() - lastInput < 3 * 60e3 || player.moving;
  if (active) store.act({ a: 'tick' });
}, STAY.tickMs);

function renderStay() {
  const chip = $('stay');
  chip.hidden = GAME || !me;
  if (chip.hidden) return;
  const s = store.state;
  const mins = Math.min(STAY.minutesPerPoint, s.counts?.minutes || 0);
  chip.textContent = `${mins >= STAY.minutesPerPoint ? '✅' : '⏳'} ${mins}/${STAY.minutesPerPoint} min · 🏠 ${s.points || 0}`;
}

// ---------- joystick, side buttons, GPS, reactions ----------
const joystick = new Joystick($('controls'));
joystick.onStart = () => player.cancel();
player.joy = joystick;

const nav = new Navigator({ world, player, banner: $('nav') });
nav.onArrive = (dest) => {
  sfx.level();
  ui.celebrate(`📍 You reached ${dest.name}!`);
};
function directionsTo(dest) {
  nav.go(dest);
  ui.toast(`🧭 Directions to ${dest.name}. Tap ▶ to walk there automatically.`);
}
function directionsToHouse(id, name) {
  directionsTo({ ...doorPoint(id), name, house: id });
}

const bubbles = new Bubbles($('labels'), world.camera);
net.onReact = (object, key) => bubbles.show(object, key, player.vehicle ? 3 : 4.6);
function react(key) {
  $('react-menu').hidden = true;
  if (key === 'wave') player.char.play('wave');
  bubbles.show(player.body, key, player.vehicle ? 3 : 4.6);
  sfx.click();
  net.react(key);
}
$('react-menu').innerHTML = REACTIONS.map((r) => `<button data-react="${r.k}" class="${r.text ? 'text' : ''}">${r.text || r.icon}</button>`).join('');
$('react-menu').querySelectorAll('[data-react]').forEach((b) => (b.onclick = () => react(b.dataset.react)));
$('react-btn').onclick = () => ($('react-menu').hidden = !$('react-menu').hidden);
$('run-btn').onclick = () => {
  player.runToggle = !player.runToggle;
  $('run-btn').classList.toggle('on', player.runToggle);
};
function renderCam() {
  $('cam-btn').querySelector('small').textContent = player.camMode === 'street' ? 'Street' : 'Above';
}
$('cam-btn').onclick = () => {
  player.toggleCamera();
  renderCam();
  ui.toast(player.camMode === 'street' ? '🎥 Street view' : '🎥 View from above');
};
renderCam();

// Places: landmarks and houses you can get directions to.
function openPlaces() {
  $('react-menu').hidden = true;
  const places = [
    ...(me ? [{ icon: '🏠', name: 'your house', ...doorPoint(me.home_id || me.id), house: me.home_id || me.id }] : []),
    { icon: '⛲', name: 'the plaza fountain', x: 0, z: 14 },
    { icon: '🎣', name: 'the pond', x: PLAZA.pond.x + 13, z: PLAZA.pond.z },
    { icon: '🚗', name: 'the car showroom', x: PLAZA.showroom.x, z: PLAZA.showroom.z - PLAZA.showroom.hd - 3 },
    { icon: '🏪', name: 'the market stall', x: PLAZA.stall.x - 4, z: PLAZA.stall.z - 4 },
    { icon: '🥕', name: 'the grocer', x: PLAZA.grocer.x, z: PLAZA.grocer.z + 4 },
    { icon: '📋', name: 'the notice board', x: PLAZA.board.x + 4, z: PLAZA.board.z + 4 },
    { icon: '🛠️', name: 'the workbench', x: PLAZA.workbench.x - 4, z: PLAZA.workbench.z + 4 },
  ];
  openSheet('Places', (el) => {
    el.innerHTML = `
      <form id="place-find" class="form" autocomplete="off"><label>Directions to someone's house<input name="u" placeholder="instagram_username" autocapitalize="none" /></label><button class="btn primary">🧭 Find &amp; go</button></form>
      ${places.map((p, i) => `<div class="row"><span class="ico">${p.icon}</span><div class="grow"><b>${p.name.charAt(0).toUpperCase() + p.name.slice(1)}</b><small>${Math.round(Math.hypot(p.x - player.pos.x, p.z - player.pos.z))} m away</small></div><button class="btn" data-go="${i}">🧭 Go</button><button class="btn" data-jump="${i}" title="Jump there">⚡</button></div>`).join('')}`;
    el.querySelectorAll('[data-go]').forEach((b) =>
      (b.onclick = () => {
        closeSheet();
        directionsTo(places[Number(b.dataset.go)]);
      }),
    );
    el.querySelectorAll('[data-jump]').forEach((b) =>
      (b.onclick = () => {
        const p = places[Number(b.dataset.jump)];
        closeSheet();
        nav.stop();
        if (p.house) goToHouse(p.house);
        else player.teleport(p.x, p.z + 4, p.x, p.z);
      }),
    );
    el.querySelector('#place-find').onsubmit = async (e) => {
      e.preventDefault();
      const u = normalizeUsername(e.target.u.value);
      if (!u) return ui.toast('Type an Instagram username');
      try {
        const r = await findHouse(u);
        if (!r.found) return ui.toast(`No house for @${u} yet`);
        closeSheet();
        directionsToHouse(r.id, `@${u}'s house`);
      } catch (err) {
        ui.toast(err.message);
      }
    };
  });
}
$('places-btn').onclick = openPlaces;

function renderDrive() {
  const has = GAME && Boolean(store.state.car);
  $('drive-btn').hidden = !has;
  $('drive-btn').classList.toggle('primary', Boolean(player.vehicle));
}

function setUnseen(n) {
  $('friends-badge').hidden = !n;
  $('friends-badge').textContent = n > 9 ? '9+' : String(n);
}

async function getJSON(path) {
  const res = await fetch(path, { credentials: 'same-origin' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

const life = createLifeUI({
  store, world, player, particles, sfx, ui, openSheet, closeSheet, act, send, isDemo, esc, fmt,
  getMe: () => me,
  getJSON,
  setUnseen,
  goToHouse,
  syncOwnHouse: () => syncOwnHouse(),
  renderDrive: () => renderDrive(),
  refreshWorld: () => me && world.refreshBlock(blockOfHouse(me.home_id || me.id)),
});

function renderMe() {
  $('home-btn').hidden = !me;
  $('key-btn').hidden = Boolean(me);
  net.name = me && !me.hidden ? me.username : 'Neighbour';
  player.setName(net.name);
}

// Show my own decor/paint right away (the shared CDN copy updates later).
function syncOwnHouse() {
  if (!me) return;
  const s = store.state;
  world.setOverride(me.id, {
    d: s.decor, p: s.paint, t: s.tier || 1, lit: 1,
    g: s.garden, j: s.job, c: s.car,
    df: s.defence, r: s.raid?.on ? 1 : 0, sh: s.raid?.shield || 0,
  });
}

store.on((state, events) => {
  $('coins').textContent = `🪙 ${fmt.format(state.coins)}`;
  $('energy').textContent = `⚡ ${energyNow(state, Date.now())}`;
  renderDrive();
  renderStay();
  for (const e of events || []) if (e.type === 'point') ui.celebrate(`🏠 +1 house point! You have ${e.points}. Upgrade at your house.`);
  if (events?.some((e) => e.type === 'coins')) {
    $('coins').classList.remove('bump');
    void $('coins').offsetWidth;
    $('coins').classList.add('bump');
  }
  for (const e of events || []) if (e.type === 'daily') ui.celebrate(`🔥 Day ${e.streak} streak · +${e.coins} 🪙`);
  if (events?.some((e) => e.type === 'decor')) syncOwnHouse();
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
  if (!GAME) {
    // Just houses: hide everything that belongs to the game.
    for (const id of ['coins', 'energy', 'bag-btn', 'quests-btn', 'friends-btn', 'drive-btn']) $(id).hidden = true;
    $('hint').innerHTML = 'Walk around and visit your neighbours · WASD or tap to walk · drag to turn · <span id="online">0</span> nearby';
    $('demo-badge').textContent = 'Demo mode · fake residents';
  }
  $('key-btn').onclick = (e) => {
    e.preventDefault();
    if (isDemo()) return ui.toast('Sign-in is off in demo mode');
    openSignIn();
  };

  await refreshStats();
  setInterval(refreshStats, 60000);

  const res = await loadMe();
  me = res.resident;
  // Houses-only mode doesn't use friends / gifts / raids, so don't nag about
  // the database update they need (004_social.sql). Other warnings still show.
  const warning = !GAME && /004_social/.test(res.warning || '') ? null : res.warning;
  if (res.error || warning) setTimeout(() => ui.celebrate(res.error || warning), 600);
  if (me && res.state) store.initMember(me, res.state, res.events);
  else {
    if (isDemo()) me = { id: 7, username: demoNameFor(7), hidden: false, demo: true };
    await store.initGuest();
  }
  renderMe();
  syncOwnHouse();
  renderStay();
  const params = new URLSearchParams(location.search);
  if (me && params.has('home')) {
    goToHouse(me.home_id || me.id);
    ui.celebrate(`Welcome home, @${me.username}! 🏠`);
    if (!me.has_password && !me.demo) setTimeout(() => ui.toast('Tip: set a password in ⚙️ Menu to sign in on any device without a new key.'), 3500);
    history.replaceState(null, '', '/');
  }

  if (GAME && me && !me.demo) getJSON('/api/social/list').then((d) => setUnseen(d.unseen)).catch(() => {});
  setInterval(() => ($('energy').textContent = `⚡ ${energyNow(store.state, Date.now())}`), 30000);
  for (const e of res.events || []) if (e.type === 'received') ui.celebrate(`🎁 Gift from @${e.from}!`);

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
  nav.update(t);
  bubbles.update();
  net.update(player, dt, now);
  particles.update(dt);
  world.render(player.body);
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
if (import.meta.env.DEV) window.__town = { world, player, store, PLAZA, life, nav, net, react, openPlaces, openSignIn, openPassword, setMe: (m) => (me = m) };
