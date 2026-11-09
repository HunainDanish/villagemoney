// Screens for town life: grocer, car showroom, garden, kitchen, jobs,
// defences & raid mode, garage, friends & inbox, and house-card actions
// (add friend, rival, move in, gift, raid). main.js passes in its helpers.

import { ITEMS, cropReadyAt, energyNow, raidProblem, resolveRaid, initialState } from '../shared/game.js';
import {
  CROPS, GROCER, COOKBOOK, SNACKS, JOBS, LOCKS, GUARD_DOG, ALARM, CARS, RAID, ENERGY_MAX,
  defenceScore, raidChance,
} from '../shared/life.js';

const costText = (cost, s) =>
  Object.entries(cost)
    .map(([k, n]) => (k === 'coins' ? `🪙 ${s.coins}/${n}` : `${ITEMS[k].icon} ${s.items[k] || 0}/${n}`))
    .join(' · ');
const canPay = (cost, s) => Object.entries(cost).every(([k, n]) => (k === 'coins' ? s.coins >= n : (s.items[k] || 0) >= n));
const mins = (ms) => (ms < 60e3 ? `${Math.ceil(ms / 1000)} s` : `${Math.ceil(ms / 60e3)} min`);
const builderCost = (cost, s) => {
  const out = { ...cost };
  if (s.job === 'builder') for (const k of ['log', 'stone']) if (out[k]) out[k] = Math.ceil(out[k] * 0.8);
  return out;
};

export function createLifeUI(ctx) {
  const { store, world, player, particles, sfx, ui, openSheet, closeSheet, act, send, isDemo, esc, fmt } = ctx;
  const me = () => ctx.getMe();
  const s = () => store.state;
  const needsHouse = (el) => {
    el.innerHTML = '<p>You need your own house for this. Tap 🔑 Sign in to get one.</p>';
  };

  // ---------- grocer ----------
  function openGrocer() {
    openSheet('Grocer', (el) => {
      const st = s();
      el.innerHTML = `<p>🪙 ${fmt.format(st.coins)} · Seeds for your garden and ingredients for your kitchen.</p>${Object.entries(GROCER)
        .map(([k, price]) => {
          const it = ITEMS[k];
          const crop = it.seed ? CROPS[it.seed] : null;
          const note = crop ? `Grows in ${mins(crop.growMs)} · gives ${crop.yield} ${crop.icon}` : 'For cooking';
          return `<div class="row"><span class="ico">${crop ? crop.icon : it.icon}</span><div class="grow"><b>${it.name}</b><small>${note} · ${price} 🪙</small></div><button class="btn" data-buy="${k}" data-n="1">Buy 1</button><button class="btn good" data-buy="${k}" data-n="5">Buy 5</button></div>`;
        })
        .join('')}`;
      el.querySelectorAll('[data-buy]').forEach((b) =>
        (b.onclick = async () => {
          const r = await act({ a: 'buy', item: b.dataset.buy, qty: Number(b.dataset.n) });
          if (r.ok) sfx.pickup();
        }),
      );
    });
  }

  // ---------- garden ----------
  function openGarden() {
    if (!me()) return openSheet('Garden', needsHouse);
    openSheet('My garden', (el) => {
      const st = s();
      const now = Date.now();
      const seeds = Object.keys(CROPS).filter((c) => (st.items[`${c}_seed`] || 0) > 0);
      const plots = (st.garden || []).map((g, i) => {
        if (!g) {
          const opts = seeds.map((c) => `<button class="btn" data-plant="${c}" data-plot="${i}">${CROPS[c].icon} ${CROPS[c].name} (${st.items[`${c}_seed`]})</button>`).join('');
          return `<div class="row"><span class="ico">🟫</span><div class="grow"><b>Bed ${i + 1}: empty</b><small>${seeds.length ? 'Plant:' : 'Buy seeds at the grocer in the plaza.'}</small><div class="wrap">${opts}</div></div></div>`;
        }
        const ready = cropReadyAt(st, i);
        const left = ready - now;
        const crop = CROPS[g.c];
        const pct = Math.min(100, Math.round(((now - g.at) / (ready - g.at)) * 100));
        return `<div class="row"><span class="ico">${crop.icon}</span><div class="grow"><b>Bed ${i + 1}: ${crop.name}</b><small>${left > 0 ? `Ready in ${mins(left)}` : 'Ready to harvest!'}</small><div class="bar"><i style="width:${pct}%"></i></div></div>${left > 0 ? '' : `<button class="btn good" data-reap="${i}">Harvest</button>`}</div>`;
      });
      el.innerHTML = `<p>Three beds behind your house. Crops grow in real time, even while you're away.${st.job === 'farmer' ? ' 👩‍🌾 Farmer: twice as fast, +1 harvest.' : ''}</p>${plots.join('')}`;
      el.querySelectorAll('[data-plant]').forEach((b) =>
        (b.onclick = async () => {
          const r = await act({ a: 'plant', plot: Number(b.dataset.plot), crop: b.dataset.plant });
          if (r.ok) {
            sfx.pickup();
            ctx.syncOwnHouse();
          }
        }),
      );
      el.querySelectorAll('[data-reap]').forEach((b) =>
        (b.onclick = async () => {
          const r = await act({ a: 'reap', plot: Number(b.dataset.reap) });
          if (r.ok) {
            sfx.pickup();
            particles.sparkle(player.pos.x, 2, player.pos.z);
            const g = r.events.find((e) => e.type === 'gain');
            if (g) ui.celebrate(`Harvested ${g.qty} ${ITEMS[g.item].icon}`);
            ctx.syncOwnHouse();
          }
        }),
      );
    });
  }

  // ---------- kitchen ----------
  function openKitchen() {
    openSheet('Kitchen', (el) => {
      const st = s();
      const energy = energyNow(st, Date.now());
      const hasFish = ['minnow', 'perch', 'trout', 'koi', 'goldfish'].some((f) => (st.items[f] || 0) > 0);
      const rows = Object.entries(COOKBOOK).map(([k, r]) => {
        const can = Object.entries(r.needs).every(([i, n]) => (i === 'fish' ? hasFish : (st.items[i] || 0) >= n));
        const needs = Object.entries(r.needs).map(([i, n]) => (i === 'fish' ? `🐟 any fish ${hasFish ? '✓' : '0/1'}` : `${ITEMS[i].icon} ${st.items[i] || 0}/${n}`)).join(' · ');
        return `<div class="row"><span class="ico">${ITEMS[k].icon}</span><div class="grow"><b>${ITEMS[k].name} · +${r.energy} ⚡</b><small>${needs}${st.items[k] ? ` · you have ${st.items[k]}` : ''}</small></div><button class="btn ${can ? 'good' : ''}" data-cook="${k}" ${can ? '' : 'disabled'}>Cook</button>${st.items[k] ? `<button class="btn" data-eat="${k}">Eat</button>` : ''}</div>`;
      });
      const snacks = Object.entries(SNACKS).filter(([k]) => (st.items[k] || 0) > 0);
      el.innerHTML = `<p>⚡ Energy ${energy}/${ENERGY_MAX}. Chopping, mining, fishing, planting and raids use energy; it refills slowly (1 every 2 min) or quickly by eating.</p>
        ${rows.join('')}
        ${snacks.length ? `<h3>Snacks</h3>${snacks.map(([k, e]) => `<div class="row"><span class="ico">${ITEMS[k].icon}</span><div class="grow"><b>${ITEMS[k].name} × ${st.items[k]}</b><small>+${e} ⚡ each</small></div><button class="btn" data-eat="${k}">Eat</button></div>`).join('')}` : ''}
        <p>Ingredients: grow wheat, carrots, tomatoes and pumpkins; buy milk, eggs and cheese at the grocer; catch fish at the pond.</p>`;
      el.querySelectorAll('[data-cook]').forEach((b) =>
        (b.onclick = async () => {
          const r = await act({ a: 'cook', r: b.dataset.cook });
          if (r.ok) {
            sfx.pickup();
            ui.celebrate(`Cooked ${ITEMS[b.dataset.cook].name} ${ITEMS[b.dataset.cook].icon}`);
          }
        }),
      );
      el.querySelectorAll('[data-eat]').forEach((b) => (b.onclick = () => eat(b.dataset.eat)));
    });
  }

  async function eat(item) {
    const r = await act({ a: 'eat', item });
    if (r.ok) {
      sfx.level();
      particles.sparkle(player.pos.x, 3, player.pos.z);
      ui.toast(`Yum! +${r.events.find((e) => e.type === 'energy')?.energy} ⚡`);
    }
  }

  // ---------- jobs ----------
  function openJob() {
    openSheet('Your job', (el) => {
      const st = s();
      el.innerHTML = `<p>Pick a job for a bonus. You can switch once a day. Your job shows on your house card.</p>${Object.entries(JOBS)
        .map(([k, j]) => `<div class="row"><span class="ico">${j.icon}</span><div class="grow"><b>${j.name}${st.job === k ? ' · your job' : ''}</b><small>${j.perk}</small></div>${st.job === k ? '' : `<button class="btn" data-job="${k}">Choose</button>`}</div>`)
        .join('')}`;
      el.querySelectorAll('[data-job]').forEach((b) =>
        (b.onclick = async () => {
          const r = await act({ a: 'job', job: b.dataset.job });
          if (r.ok) {
            sfx.level();
            ui.celebrate(`You're now a ${JOBS[b.dataset.job].name} ${JOBS[b.dataset.job].icon}`);
            ctx.syncOwnHouse();
          }
        }),
      );
    });
  }

  // ---------- defences & raid mode ----------
  function openDefence() {
    if (!me()) return openSheet('Defences', needsHouse);
    openSheet('Defences & raids', (el) => {
      const st = s();
      const d = st.defence || {};
      const now = Date.now();
      const nextLock = LOCKS[(d.lock || 0) + 1];
      const item = (key, icon, title, owned, ownedText, cost) => {
        if (owned) return `<div class="row"><span class="ico">${icon}</span><div class="grow"><b>${title}</b><small>${ownedText}</small></div></div>`;
        const c = builderCost(cost, st);
        return `<div class="row"><span class="ico">${icon}</span><div class="grow"><b>${title}</b><small>${costText(c, st)}</small></div><button class="btn ${canPay(c, st) ? 'good' : ''}" data-def="${key}" ${canPay(c, st) ? '' : 'disabled'}>Build</button></div>`;
      };
      const raidOn = st.raid?.on;
      const lockLeft = raidOn ? RAID.lockInMs - (now - (st.raid.since || 0)) : 0;
      const shield = (st.raid?.shield || 0) - now;
      el.innerHTML = `
        <p>🛡️ Defence score: <b>${defenceScore(st)}</b> (lock + dog + alarm${st.job === 'guard' ? ' + guard job' : ''}). Higher means raiders fail more often.</p>
        ${item('lock', '🔒', nextLock ? `Upgrade lock: ${nextLock.name}` : 'Vault door', !nextLock, 'Best lock in town', nextLock?.cost || {})}
        ${item('dog', '🐕', 'Guard dog (+2)', d.dog, 'Sleeping by the kennel, one ear open', GUARD_DOG.cost)}
        ${item('alarm', '🔔', 'Alarm bell (+1)', d.alarm, 'Rings when someone sneaks in', ALARM.cost)}
        <h3>⚔️ Raid mode</h3>
        <p>Raid mode is <b>optional</b>. Only players with raid mode on can raid or be raided. A successful raid takes 10% of stored materials (max 15 each) and 5% of coins (max 60). Raided houses get a 6-hour shield; friends can't raid each other.</p>
        <label class="toggle"><input type="checkbox" id="raid-toggle" ${raidOn ? 'checked' : ''} ${raidOn && lockLeft > 0 ? 'disabled' : ''}/> Raid mode ${raidOn ? 'ON' : 'off'}</label>
        ${raidOn && lockLeft > 0 ? `<p>Raid mode stays on for 24 hours once switched on (${Math.ceil(lockLeft / 3600e3)} h left).</p>` : ''}
        ${shield > 0 ? `<p>🛡️ Shielded for another ${mins(shield)}.</p>` : ''}
        <p>Find raid-mode houses by their <b style="color:#d94141">red flag</b>; a <b style="color:#3d7cf5">blue flag</b> means shielded.</p>`;
      el.querySelectorAll('[data-def]').forEach((b) =>
        (b.onclick = async () => {
          const r = await act({ a: 'defend', what: b.dataset.def });
          if (r.ok) {
            sfx.level();
            ctx.syncOwnHouse();
          }
        }),
      );
      el.querySelector('#raid-toggle').onchange = async (e) => {
        if (e.target.checked && !confirm('Turn on raid mode? Other raiders can then loot your house, and it stays on for at least 24 hours.')) {
          e.target.checked = false;
          return;
        }
        const r = await act({ a: 'raidMode', on: e.target.checked });
        if (!r.ok) e.target.checked = !e.target.checked;
        else ctx.syncOwnHouse();
      };
    });
  }

  // ---------- showroom & garage ----------
  function openShowroom() {
    openSheet('Car showroom', (el) => {
      const st = s();
      el.innerHTML = `<p>🪙 ${fmt.format(st.coins)} · Your car parks in your driveway, and you can drive it around town (🚗 in the bar).</p>${Object.entries(CARS)
        .map(([k, c]) => {
          const owned = st.cars?.includes(k);
          return `<div class="row"><span class="ico" style="color:#${c.color.toString(16).padStart(6, '0')}">🚗</span><div class="grow"><b>${c.name}</b><small>Top speed ${c.speed} · ${fmt.format(c.price)} 🪙</small></div>${owned ? (st.car === k ? '<small>✓ yours</small>' : `<button class="btn" data-pick="${k}">Use</button>`) : `<button class="btn ${st.coins >= c.price ? 'good' : ''}" data-car="${k}" ${st.coins >= c.price ? '' : 'disabled'}>Buy</button>`}</div>`;
        })
        .join('')}`;
      el.querySelectorAll('[data-car]').forEach((b) =>
        (b.onclick = async () => {
          if (!confirm(`Buy the ${CARS[b.dataset.car].name} for ${fmt.format(CARS[b.dataset.car].price)} coins?`)) return;
          const r = await act({ a: 'buyCar', model: b.dataset.car });
          if (r.ok) {
            sfx.level();
            ui.celebrate(`🚗 You bought a ${CARS[b.dataset.car].name}! Tap 🚗 to drive.`);
            ctx.syncOwnHouse();
            ctx.renderDrive();
          }
        }),
      );
      el.querySelectorAll('[data-pick]').forEach((b) =>
        (b.onclick = async () => {
          const r = await act({ a: 'pickCar', model: b.dataset.pick });
          if (r.ok) {
            ctx.syncOwnHouse();
            ctx.renderDrive();
          }
        }),
      );
    });
  }

  // ---------- friends & inbox ----------
  async function openFriends() {
    if (isDemo()) {
      return openSheet('Friends', (el) => {
        el.innerHTML = '<p>Friends, gifts, moving in together and raids need real residents. They work on your live site once players are signed in.</p>';
      });
    }
    if (!me()) return openSheet('Friends', needsHouse);
    openSheet('Friends', (el) => (el.innerHTML = '<p>Loading…</p>'));
    let data;
    try {
      data = await ctx.getJSON('/api/social/list');
    } catch (e) {
      return openSheet('Friends', (el) => (el.innerHTML = `<p>${esc(e.message)}</p>`));
    }
    send('POST', '/api/social/seen').catch(() => {});
    ctx.setUnseen(0);
    openSheet('Friends', (el) => {
      const person = (p, buttons) => `<div class="row"><span class="ico">🙂</span><div class="grow"><b>@${esc(p.username)}</b>${p.hearts !== undefined ? `<small>${'❤️'.repeat(Math.min(p.hearts, 10)) || '🤍'} ${p.hearts}/10</small>` : ''}</div>${buttons}</div>`;
      const visit = (p) => `<button class="btn" data-visit="${p.home}">Visit</button>`;
      const inboxText = (m) =>
        ({
          friend_request: `@${esc(m.from)} wants to be friends`,
          friend_accepted: `@${esc(m.from)} is now your friend 🤝`,
          movein_request: `@${esc(m.from)} asked to move in with you 🏡`,
          movein_accepted: `@${esc(m.from)} said yes: you moved in together 🏡`,
          rival: `@${esc(m.from)} marked you as a rival 😤`,
          gift: `@${esc(m.from)} sent you ${Object.entries(m.payload.items || {}).map(([k, n]) => `${n} ${ITEMS[k]?.icon || k}`).join(' ')} 🎁`,
          raid: m.payload.ok
            ? `@${esc(m.from)} raided your house and took ${Object.entries(m.payload.loot || {}).map(([k, n]) => `${n} ${ITEMS[k]?.icon}`).join(' ') || 'nothing'}${m.payload.coins ? ` + ${m.payload.coins} 🪙` : ''} 🗡️`
            : `@${esc(m.from)} tried to raid you and got caught! You got ${m.payload.fine} 🪙 🛡️`,
        })[m.kind] || m.kind;
      el.innerHTML = `
        <form id="add-friend" class="form" autocomplete="off"><label>Add a friend by username<input name="u" placeholder="instagram_username" autocapitalize="none" /></label><button class="btn primary">Send request</button></form>
        ${data.requests.length ? `<h3>Requests</h3>${data.requests.map((p) => person(p, `<button class="btn good" data-accept="${esc(p.username)}">Accept</button><button class="btn" data-decline="${esc(p.username)}">✕</button>`)).join('')}` : ''}
        ${data.housemateRequest && !data.housemateRequest.mine ? `<h3>Move-in request</h3>${person(data.housemateRequest, `<button class="btn good" data-acceptmove="${esc(data.housemateRequest.username)}">Let them move in</button>`)}` : ''}
        ${data.housemate ? `<h3>🏡 Living with</h3>${person(data.housemate, `${visit(data.housemate)}<button class="btn" data-moveout="${esc(data.housemate.username)}">Move out</button>`)}` : ''}
        <h3>Friends (${data.friends.length})</h3>
        ${data.friends.length ? data.friends.map((p) => person(p, `${visit(p)}<button class="btn" data-gift="${esc(p.username)}">🎁</button>`)).join('') : '<p>No friends yet. Tap someone\'s house and choose ➕ Add friend.</p>'}
        ${data.sent.length ? `<p>Waiting for: ${data.sent.map((p) => `@${esc(p.username)}`).join(', ')}</p>` : ''}
        ${data.rivals.length ? `<h3>😤 Rivals</h3>${data.rivals.map((p) => person(p, `${visit(p)}<button class="btn" data-unrival="${esc(p.username)}">✕</button>`)).join('')}` : ''}
        <h3>Inbox</h3>
        ${data.inbox.length ? data.inbox.map((m) => `<div class="row"><div class="grow"><small>${new Date(m.created_at).toLocaleString()}</small><b>${inboxText(m)}</b></div></div>`).join('') : '<p>Nothing yet.</p>'}`;
      const post = async (path, body, done) => {
        try {
          const r = await send('POST', `/api/social/${path}`, body);
          if (r.state) store.setServerState(r.state);
          if (r.message) ui.toast(r.message);
          done?.(r);
          openFriends();
        } catch (e) {
          ui.toast(e.message);
        }
      };
      el.querySelector('#add-friend').onsubmit = (e) => {
        e.preventDefault();
        post('friend', { username: e.target.u.value.replace(/^@/, '').trim() });
      };
      el.querySelectorAll('[data-accept]').forEach((b) => (b.onclick = () => post('accept', { username: b.dataset.accept, kind: 'friend' })));
      el.querySelectorAll('[data-decline]').forEach((b) => (b.onclick = () => post('remove', { username: b.dataset.decline, kind: 'friend' })));
      el.querySelectorAll('[data-acceptmove]').forEach((b) => (b.onclick = () => post('accept', { username: b.dataset.acceptmove, kind: 'housemate' }, () => ctx.refreshWorld())));
      el.querySelectorAll('[data-moveout]').forEach((b) => (b.onclick = () => confirm('Move out?') && post('remove', { username: b.dataset.moveout, kind: 'housemate' }, () => ctx.refreshWorld())));
      el.querySelectorAll('[data-unrival]').forEach((b) => (b.onclick = () => post('rival', { username: b.dataset.unrival })));
      el.querySelectorAll('[data-visit]').forEach((b) => (b.onclick = () => (closeSheet(), ctx.goToHouse(Number(b.dataset.visit)))));
      el.querySelectorAll('[data-gift]').forEach((b) => (b.onclick = () => openGift(b.dataset.gift)));
    });
  }

  function openGift(username) {
    openSheet(`Gift @${username}`, (el) => {
      const st = s();
      const items = Object.entries(st.items).filter(([k, n]) => n > 0 && ITEMS[k]);
      el.innerHTML = `<p>Gifts arrive in their inbox. Each day you gift a friend, your ❤️ hearts grow (move in together at 3 ❤️). Up to 10 gifts a day.</p>
        ${items.length ? items.map(([k, n]) => `<div class="row"><span class="ico">${ITEMS[k].icon}</span><div class="grow"><b>${ITEMS[k].name} × ${n}</b></div><button class="btn good" data-give="${k}">Give 1</button></div>`).join('') : '<p>Your bag is empty.</p>'}`;
      el.querySelectorAll('[data-give]').forEach((b) =>
        (b.onclick = async () => {
          try {
            await store.flush(); // the server must see your latest items first
            const r = await send('POST', '/api/social/gift', { username, item: b.dataset.give, qty: 1 });
            if (r.state) store.setServerState(r.state);
            sfx.pickup();
            ui.toast(`${r.message} · ❤️ ${r.hearts}/10`);
            openGift(username);
          } catch (e) {
            ui.toast(e.message);
          }
        }),
      );
    });
  }

  // Extra buttons on another resident's house card.
  function houseActions(h) {
    if (!me() || isDemo()) {
      return isDemo() && h.r
        ? '<button class="btn danger" data-act="raid">🗡️ Sneak in (raid)</button>'
        : '';
    }
    const owner = h.u;
    if (!owner) return '';
    return `
      <button class="btn" data-act="friend">➕ Add friend</button>
      <button class="btn" data-act="gift">🎁 Send a gift</button>
      <button class="btn" data-act="movein">🏡 Ask to move in</button>
      <button class="btn" data-act="rival">😤 Mark as rival</button>
      ${h.r ? '<button class="btn danger" data-act="raid">🗡️ Sneak in (raid)</button>' : ''}`;
  }

  function bindHouseActions(el, h, knock) {
    const post = async (path, body) => {
      try {
        const r = await send('POST', `/api/social/${path}`, body);
        ui.toast(r.message || 'Done');
      } catch (e) {
        ui.toast(e.message);
      }
    };
    el.querySelectorAll('[data-act]').forEach((b) =>
      (b.onclick = () => {
        const a = b.dataset.act;
        if (a === 'friend') post('friend', { username: h.u });
        else if (a === 'rival') post('rival', { username: h.u });
        else if (a === 'movein') post('movein', { username: h.u });
        else if (a === 'gift') openGift(h.u);
        else if (a === 'raid') {
          closeSheet();
          knock(h, () => raid(h));
        }
      }),
    );
  }

  // ---------- raids ----------
  // Lock-pick mini-game: a marker sweeps a bar; tap when it's in the middle.
  // Three tries; the average accuracy (0..1) is your raid skill.
  function lockpick() {
    return new Promise((resolve) => {
      const wrap = document.createElement('div');
      wrap.className = 'lockpick';
      wrap.innerHTML = '<p>🗝️ Pick the lock: tap when the pin is in the green!</p><div class="lp-bar"><div class="lp-zone"></div><div class="lp-pin"></div></div><p class="lp-count">3 tries left</p><button class="btn primary lp-tap">Tap!</button>';
      document.body.append(wrap);
      const pin = wrap.querySelector('.lp-pin');
      const scores = [];
      let t0 = performance.now();
      let raf;
      let pos = 0;
      const speed = 1.6 + Math.random() * 0.8;
      const loop = (now) => {
        pos = (Math.sin(((now - t0) / 1000) * speed * Math.PI) + 1) / 2;
        pin.style.left = `${pos * 100}%`;
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
      const tap = () => {
        scores.push(Math.max(0, 1 - Math.abs(pos - 0.5) * 2.5));
        sfx.click();
        wrap.querySelector('.lp-count').textContent = `${3 - scores.length} tries left`;
        t0 = performance.now() - Math.random() * 500;
        if (scores.length >= 3) {
          cancelAnimationFrame(raf);
          wrap.remove();
          resolve(scores.reduce((a, b) => a + b, 0) / scores.length);
        }
      };
      wrap.querySelector('.lp-tap').onclick = tap;
    });
  }

  async function raid(h) {
    const st = s();
    if (isDemo()) {
      // Demo: practise against a pretend stash.
      const fakeTarget = { ...initialState(), raid: { on: true, since: 0, at: 0, shield: 0 } };
      const problem = raidProblem({ ...st, raid: { ...(st.raid || {}), on: true } }, fakeTarget, Date.now());
      if (problem) return ui.toast(problem);
    } else {
      await store.flush();
      const problem = raidProblem(st, { raid: { on: true, shield: h.sh || 0 } }, Date.now());
      if (problem) return ui.toast(problem.charAt(0).toUpperCase() + problem.slice(1));
    }
    const skill = await lockpick();
    if (isDemo()) {
      const fake = { items: { log: 40 + (h.id % 60), stone: 20 + (h.id % 30), berry: 12 }, coins: 300 };
      const out = resolveRaid(fake, (h.df?.lock || 0) + (h.df?.dog ? 2 : 0) + (h.df?.alarm ? 1 : 0), skill, Math.random, raidChance);
      store.applyLocal({ a: 'raidResult', ...out });
      return showRaid(out, h.u);
    }
    try {
      const r = await send('POST', '/api/social/raid', { house: h.id, skill });
      if (r.state) store.setServerState(r.state);
      showRaid(r.outcome, r.target);
    } catch (e) {
      ui.toast(e.message);
    }
  }

  function showRaid(out, who) {
    if (out.ok) {
      sfx.level();
      particles.sparkle(player.pos.x, 3, player.pos.z);
      const loot = Object.entries(out.loot).map(([k, n]) => `${n} ${ITEMS[k].icon}`).join(' ');
      ui.celebrate(`🗡️ Raid on @${who || 'a neighbour'} worked! ${loot || ''}${out.coins ? ` +${out.coins} 🪙` : ''}`);
    } else {
      sfx.bite();
      ui.celebrate(`🚨 Caught! You paid a ${out.fine} 🪙 fine.`);
    }
  }

  return {
    openGrocer, openGarden, openKitchen, openJob, openDefence, openShowroom, openFriends, openGift,
    houseActions, bindHouseActions, eat,
  };
}
