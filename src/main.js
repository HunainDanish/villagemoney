import './style.css';
import * as THREE from 'three';
import { World } from './world.js';
import { Player } from './player.js';
import { Net } from './net.js';
import { loadConfig, loadStats, loadMe, findHouse, send, isDemo } from './api.js';
import { housePosition, blockOfHouse, normalizeUsername } from '../shared/layout.js';

const $ = (id) => document.getElementById(id);
const fmt = new Intl.NumberFormat();
const LABELS = 36;

const world = new World($('scene'));
const player = new Player(world, $('scene'), { onTap: openCard });
const net = new Net(world, $('labels'));
let me = null;

// ---------- house name labels (a small reused pool of divs) ----------
const pool = Array.from({ length: LABELS }, () => {
  const el = document.createElement('div');
  el.className = 'label';
  el.style.display = 'none';
  $('labels').append(el);
  return el;
});
const v = new THREE.Vector3();
function drawLabels() {
  const near = world.nearest(player.pos.x, player.pos.z, 70, LABELS);
  pool.forEach((el, i) => {
    const h = near[i];
    if (!h) return void (el.style.display = 'none');
    v.set(h.x, 9.5, h.z).project(world.camera);
    if (v.z > 1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1) return void (el.style.display = 'none');
    el.style.display = '';
    const text = h.u ? `@${h.u}` : 'A neighbour';
    if (el.textContent !== text) el.textContent = text;
    el.classList.toggle('mine', me?.id === h.id);
    el.style.transform = `translate(-50%,-50%) translate(${((v.x + 1) / 2) * innerWidth}px,${((1 - v.y) / 2) * innerHeight}px)`;
  });
}

// ---------- UI ----------
let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3500);
}

function openCard(h) {
  $('settings').hidden = true;
  $('card-name').textContent = h.u ? `@${h.u}` : 'A neighbour';
  $('card-num').textContent = `House #${fmt.format(h.id)}${me?.id === h.id ? ' · this is you' : ''}`;
  const ig = $('card-ig');
  ig.hidden = !h.u;
  if (h.u) ig.href = `https://www.instagram.com/${encodeURIComponent(h.u)}/`;
  $('card').hidden = false;
}
for (const el of document.querySelectorAll('.card .close')) el.onclick = () => (el.parentElement.hidden = true);

function goToHouse(id) {
  const p = housePosition(id);
  const dx = Math.sin(p.facing);
  const dz = Math.cos(p.facing);
  player.teleport(p.x + dx * 8, p.z + dz * 8, p.x, p.z);
  world.showMarker(id);
}

$('search').onsubmit = async (e) => {
  e.preventDefault();
  const u = normalizeUsername($('search-input').value);
  if (!u) return toast('Type an Instagram username');
  try {
    const r = await findHouse(u);
    if (!r.found) return toast(`No house for @${u} yet`);
    goToHouse(r.id);
    $('search-input').blur();
    toast(`Walking you to @${u}'s house`);
  } catch (err) {
    toast(err.message);
  }
};

function renderMe() {
  $('guest').hidden = Boolean(me);
  $('member').hidden = !me;
  net.name = me && !me.hidden ? me.username : 'Neighbour';
  if (me) {
    $('me-line').textContent = `@${me.username} · House #${fmt.format(me.id)}`;
    $('hide-toggle').checked = me.hidden;
  }
}

$('home-btn').onclick = () => me && goToHouse(me.id);
$('settings-btn').onclick = () => {
  $('card').hidden = true;
  $('settings').hidden = false;
};
$('hide-toggle').onchange = async (e) => {
  try {
    ({ resident: me } = await send('PATCH', '/api/me', { hidden: e.target.checked }));
    renderMe();
    world.refreshBlock(blockOfHouse(me.id));
    toast(me.hidden ? 'Your name is hidden' : 'Your name is visible');
  } catch (err) {
    e.target.checked = !e.target.checked;
    toast(err.message);
  }
};
$('logout-btn').onclick = async () => {
  await send('POST', '/api/auth/logout').catch(() => {});
  me = null;
  renderMe();
  $('settings').hidden = true;
  toast('Signed out');
};
$('delete-btn').onclick = async () => {
  if (!confirm('Delete your house and account? This cannot be undone.')) return;
  try {
    const id = me.id;
    await send('DELETE', '/api/me');
    me = null;
    renderMe();
    $('settings').hidden = true;
    world.showMarker(null);
    world.refreshBlock(blockOfHouse(id));
    toast('Your house was removed');
  } catch (err) {
    toast(err.message);
  }
};

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
  const cfg = await loadConfig();
  document.title = `${cfg.townName}: a home for every follower`;
  $('town-name').textContent = cfg.townName;
  $('demo-badge').hidden = !isDemo();
  const keyBtn = $('key-btn');
  if (cfg.igHandle) keyBtn.href = `https://ig.me/m/${encodeURIComponent(cfg.igHandle)}`;
  else keyBtn.onclick = (e) => (e.preventDefault(), toast(isDemo() ? 'Sign-in is off in demo mode' : 'Instagram sign-in is coming soon'));

  await refreshStats();
  setInterval(refreshStats, 60000);

  ({ resident: me } = await loadMe());
  renderMe();
  const params = new URLSearchParams(location.search);
  if (me && params.has('home')) {
    goToHouse(me.id);
    toast(`Welcome home, @${me.username}!`);
    history.replaceState(null, '', '/');
  }

  if (await net.connect(cfg.supabaseUrl, cfg.supabaseAnonKey)) addEventListener('pagehide', () => net.leave());
  else if (isDemo()) net.startBots();
  net.onCount = (n) => ($('online').textContent = n);
}

addEventListener('resize', () => world.resize());
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  player.update(dt);
  world.update(player.pos.x, player.pos.z, now / 1000);
  net.update(player, dt, now);
  world.render();
  drawLabels();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
boot();
