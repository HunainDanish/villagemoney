import { db } from './db.js';
import { json, errorJson, readJson, cdn } from './http.js';
import { currentResident } from './auth.js';
import { applyForResident, loadProgress } from './progress.js';
import { normalizeUsername } from '../shared/layout.js';
import { ITEMS, raidProblem, resolveRaid, initialState } from '../shared/game.js';
import { defenceScore, raidChance } from '../shared/life.js';

// Friends, rivals, moving in together, gifts, inbox and raids.
// Everything here involves two residents, so it runs on the server only.

const today = () => new Date().toISOString().slice(0, 10);
const pair = (x, y) => (x < y ? [x, y] : [y, x]);

async function me(request) {
  const r = await currentResident(request);
  if (!r) throw Object.assign(new Error('Sign in first'), { status: 401 });
  if (r.missingMigration) throw Object.assign(new Error('Run the database updates (supabase/002-004) first'), { status: 503 });
  return r;
}

async function byUsername(raw) {
  const username = normalizeUsername(raw);
  if (!username) throw Object.assign(new Error('That is not a valid username'), { status: 400 });
  const { data, error } = await db().from('residents').select('id, username, home_id').eq('username', username).maybeSingle();
  if (error) throw error;
  if (!data) throw Object.assign(new Error(`No resident called @${username}`), { status: 404 });
  return data;
}

async function relation(a, b, kind) {
  const [x, y] = kind === 'rival' ? [a, b] : pair(a, b);
  const { data, error } = await db().from('relations').select('*').eq('a', x).eq('b', y).eq('kind', kind).maybeSingle();
  if (error) throw error;
  return data;
}

async function notify(toId, fromId, kind, payload = {}) {
  const { error } = await db().from('inbox').insert({ to_id: toId, from_id: fromId, kind, payload });
  if (error) throw error;
}

// Deliver any unclaimed gifts into the resident's progress. Each gift row is
// claimed atomically first, so a gift can never be delivered twice.
export async function deliverGifts(resident) {
  const { data, error } = await db()
    .from('inbox')
    .select('id, payload, from_id')
    .eq('to_id', resident.id)
    .eq('kind', 'gift')
    .eq('claimed', false)
    .limit(20);
  if (error || !data?.length) return [];
  const events = [];
  for (const g of data) {
    const { data: claimed } = await db().from('inbox').update({ claimed: true }).eq('id', g.id).eq('claimed', false).select('id');
    if (!claimed?.length) continue;
    const r = await applyForResident(resident, [{ a: 'receive', items: g.payload.items, from: g.payload.from }], { trusted: true });
    events.push(...(r.results[0]?.events || []));
  }
  return events;
}

const handlers = {
  // GET /api/social/list -> relations + latest inbox
  async list(request) {
    const r = await me(request);
    const [{ data: rels, error: e1 }, { data: inbox, error: e2 }] = await Promise.all([
      db().from('relations').select('a, b, kind, status, requested_by, hearts').or(`a.eq.${r.id},b.eq.${r.id}`),
      db().from('inbox').select('id, kind, payload, from_id, seen_at, created_at').eq('to_id', r.id).order('created_at', { ascending: false }).limit(30),
    ]);
    if (e1 || e2) throw e1 || e2;
    const ids = new Set();
    for (const x of rels) ids.add(x.a === r.id ? x.b : x.a);
    for (const m of inbox) if (m.from_id) ids.add(m.from_id);
    const { data: people } = ids.size
      ? await db().from('residents').select('id, username, home_id').in('id', [...ids])
      : { data: [] };
    const name = Object.fromEntries((people || []).map((p) => [p.id, p.username]));
    const homeOf = Object.fromEntries((people || []).map((p) => [p.id, p.home_id || p.id]));
    const out = { friends: [], requests: [], sent: [], rivals: [], rivalOf: [], housemate: null, housemateRequest: null };
    for (const x of rels) {
      const other = x.a === r.id ? x.b : x.a;
      const person = { id: other, username: name[other], home: homeOf[other], hearts: x.hearts };
      if (x.kind === 'friend') {
        if (x.status === 'accepted') out.friends.push(person);
        else if (x.requested_by === r.id) out.sent.push(person);
        else out.requests.push(person);
      } else if (x.kind === 'rival') {
        if (x.a === r.id) out.rivals.push(person);
        else out.rivalOf.push(person);
      } else if (x.kind === 'housemate') {
        if (x.status === 'accepted') out.housemate = person;
        else out.housemateRequest = { ...person, mine: x.requested_by === r.id };
      }
    }
    out.inbox = inbox.map((m) => ({ ...m, from: m.from_id ? name[m.from_id] : null }));
    out.unseen = inbox.filter((m) => !m.seen_at).length;
    return json(out);
  },

  // POST { username } -> send a friend request (or accept theirs)
  async friend(request) {
    const r = await me(request);
    const other = await byUsername((await readJson(request)).username);
    if (other.id === r.id) return errorJson("That's you!");
    const [a, b] = pair(r.id, other.id);
    const row = await relation(r.id, other.id, 'friend');
    if (row?.status === 'accepted') return json({ ok: true, message: `You and @${other.username} are already friends` });
    if (row && row.requested_by !== r.id) {
      await db().from('relations').update({ status: 'accepted' }).eq('a', a).eq('b', b).eq('kind', 'friend');
      await notify(other.id, r.id, 'friend_accepted');
      return json({ ok: true, message: `You and @${other.username} are now friends 🤝` });
    }
    if (row) return json({ ok: true, message: 'Request already sent' });
    const { error } = await db().from('relations').insert({ a, b, kind: 'friend', status: 'pending', requested_by: r.id });
    if (error) throw error;
    await notify(other.id, r.id, 'friend_request');
    return json({ ok: true, message: `Friend request sent to @${other.username}` });
  },

  // POST { username, kind } -> accept a pending friend / move-in request
  async accept(request) {
    const r = await me(request);
    const body = await readJson(request);
    const kind = body.kind === 'housemate' ? 'housemate' : 'friend';
    const other = await byUsername(body.username);
    const row = await relation(r.id, other.id, kind);
    if (!row || row.status !== 'pending' || row.requested_by === r.id) return errorJson('No request to accept');
    const [a, b] = pair(r.id, other.id);
    if (kind === 'housemate') {
      // The person who asked moves into the house of the person accepting.
      const { data: both } = await db().from('residents').select('id, home_id').in('id', [r.id, other.id]);
      if (both?.some((p) => p.home_id)) return errorJson('One of you already lives with someone');
      const { count } = await db().from('residents').select('id', { count: 'exact', head: true }).eq('home_id', r.id);
      if (count) return errorJson('Someone already lives with you');
      const { error } = await db().from('residents').update({ home_id: r.id }).eq('id', other.id);
      if (error) throw error;
    }
    await db().from('relations').update({ status: 'accepted' }).eq('a', a).eq('b', b).eq('kind', kind);
    await notify(other.id, r.id, kind === 'housemate' ? 'movein_accepted' : 'friend_accepted');
    return json({ ok: true, message: kind === 'housemate' ? `@${other.username} moved in with you 🏡` : `You and @${other.username} are now friends 🤝` });
  },

  // POST { username, kind } -> unfriend, cancel, un-rival, or move out
  async remove(request) {
    const r = await me(request);
    const body = await readJson(request);
    const kind = ['friend', 'rival', 'housemate'].includes(body.kind) ? body.kind : 'friend';
    const other = await byUsername(body.username);
    const [a, b] = kind === 'rival' ? [r.id, other.id] : pair(r.id, other.id);
    await db().from('relations').delete().eq('a', a).eq('b', b).eq('kind', kind);
    if (kind === 'housemate') {
      await db().from('residents').update({ home_id: null }).in('id', [r.id, other.id]).in('home_id', [r.id, other.id]);
    }
    if (kind === 'friend') {
      // Housemates must be friends: unfriending also ends living together.
      await db().from('relations').delete().eq('a', a).eq('b', b).eq('kind', 'housemate');
      await db().from('residents').update({ home_id: null }).in('id', [r.id, other.id]).in('home_id', [r.id, other.id]);
    }
    return json({ ok: true });
  },

  // POST { username } -> toggle rival
  async rival(request) {
    const r = await me(request);
    const other = await byUsername((await readJson(request)).username);
    if (other.id === r.id) return errorJson("You can't be your own rival");
    const row = await relation(r.id, other.id, 'rival');
    if (row) {
      await db().from('relations').delete().eq('a', r.id).eq('b', other.id).eq('kind', 'rival');
      return json({ ok: true, rival: false, message: `@${other.username} is no longer your rival` });
    }
    const { error } = await db().from('relations').insert({ a: r.id, b: other.id, kind: 'rival', status: 'accepted', requested_by: r.id });
    if (error) throw error;
    await notify(other.id, r.id, 'rival');
    return json({ ok: true, rival: true, message: `@${other.username} is now your rival 😤` });
  },

  // POST { username } -> ask to move in with a friend
  async movein(request) {
    const r = await me(request);
    const other = await byUsername((await readJson(request)).username);
    const friends = await relation(r.id, other.id, 'friend');
    if (friends?.status !== 'accepted') return errorJson('You can only move in with a friend');
    if ((friends.hearts || 0) < 3) return errorJson('You need 3 ❤️ with them first (send gifts to grow hearts)');
    const [a, b] = pair(r.id, other.id);
    const existing = await relation(r.id, other.id, 'housemate');
    if (existing) return json({ ok: true, message: 'Request already sent' });
    const { error } = await db().from('relations').insert({ a, b, kind: 'housemate', status: 'pending', requested_by: r.id });
    if (error) throw error;
    await notify(other.id, r.id, 'movein_request');
    return json({ ok: true, message: `Asked @${other.username} if you can move in` });
  },

  // POST { username, item, qty } -> gift items to a friend (grows hearts)
  async gift(request) {
    const r = await me(request);
    const body = await readJson(request);
    const other = await byUsername(body.username);
    const item = String(body.item || '');
    const qty = Number(body.qty) || 1;
    if (!ITEMS[item]) return errorJson('Unknown item');
    const rel = await relation(r.id, other.id, 'friend');
    if (rel?.status !== 'accepted') return errorJson('You can only send gifts to friends');
    const { results, state } = await applyForResident(r, [{ a: 'giftOut', item, qty }], { trusted: true });
    if (!results[0].ok) return errorJson(results[0].reason);
    await notify(other.id, r.id, 'gift', { items: { [item]: qty }, from: r.username });
    // Hearts grow by 1 per day per friendship (max 10).
    let hearts = rel.hearts || 0;
    if (rel.heart_day !== today() && hearts < 10) {
      hearts += 1;
      const [a, b] = pair(r.id, other.id);
      await db().from('relations').update({ hearts, heart_day: today() }).eq('a', a).eq('b', b).eq('kind', 'friend');
    }
    return json({ ok: true, state, hearts, message: `Sent ${qty} ${ITEMS[item].icon} to @${other.username}` });
  },

  // POST { house, skill } -> raid a house (both in raid mode)
  async raid(request) {
    const r = await me(request);
    const body = await readJson(request);
    const houseId = Number(body.house);
    if (!Number.isInteger(houseId) || houseId < 1) return errorJson('Bad house');
    const { data: target, error } = await db().from('residents').select('id, username, home_id').eq('id', houseId).maybeSingle();
    if (error) throw error;
    if (!target) return errorJson('Nobody lives there');
    if (target.id === r.id || target.id === r.home_id) return errorJson("You can't raid your own home");
    const friends = await relation(r.id, target.id, 'friend');
    if (friends?.status === 'accepted') return errorJson("You can't raid a friend");

    const [mine, theirs] = await Promise.all([loadProgress(r.id), loadProgress(target.id)]);
    const ms = mine.state?.v ? mine.state : initialState();
    const ts = theirs.state?.v ? theirs.state : initialState();
    const now = Date.now();
    const problem = raidProblem(ms, ts, now);
    if (problem) return errorJson(problem.charAt(0).toUpperCase() + problem.slice(1));

    const outcome = resolveRaid(ts, defenceScore(ts), body.skill, Math.random, raidChance);
    const result = await applyForResident(r, [{ a: 'raidResult', ...outcome }], { trusted: true });
    await applyForResident(target, [{ a: 'raided', ...outcome }], { trusted: true });
    await notify(target.id, r.id, 'raid', outcome);
    return json({ ok: true, outcome, state: result.state, target: target.username });
  },

  // POST -> mark the inbox as seen
  async seen(request) {
    const r = await me(request);
    await db().from('inbox').update({ seen_at: new Date().toISOString() }).eq('to_id', r.id).is('seen_at', null);
    return json({ ok: true });
  },
};

// GET ?h=<house> -> { total, recent } (public, CDN-cached). Hidden
// residents are never named.
async function visitors(request) {
  const id = Number(new URL(request.url).searchParams.get('h'));
  if (!Number.isInteger(id) || id < 1) throw Object.assign(new Error('Bad house'), { status: 400 });
  const [all, latest] = await Promise.all([
    db().from('visits').select('visitor_id', { count: 'exact', head: true }).eq('house_id', id),
    db().from('visits').select('visitor_id').eq('house_id', id).order('day', { ascending: false }).limit(20),
  ]);
  if (all.error || latest.error) {
    console.error('visitors (run supabase/006_visits.sql)', (all.error || latest.error).message);
    return json({ total: 0, recent: [] }, { cache: cdn(30) });
  }
  const ids = [...new Set(latest.data.map((v) => v.visitor_id))].slice(0, 5);
  const { data: people } = ids.length
    ? await db().from('residents').select('id, username, hidden').in('id', ids)
    : { data: [] };
  const name = Object.fromEntries((people || []).filter((p) => !p.hidden).map((p) => [p.id, p.username]));
  return json({ total: all.count || 0, recent: ids.map((v) => name[v]).filter(Boolean) }, { cache: cdn(30) });
}
handlers.visitors = visitors;

const GET_ONLY = new Set(['list', 'visitors']);

// Route /api/social/<name> to a handler, with consistent error responses.
export async function handleSocial(request, method) {
  const name = new URL(request.url).pathname.split('/').filter(Boolean).pop();
  const h = Object.hasOwn(handlers, name) ? handlers[name] : null;
  if (!h) return errorJson('Not found', 404);
  if ((method === 'GET') !== GET_ONLY.has(name)) return errorJson('Method not allowed', 405);
  try {
    return await h(request);
  } catch (e) {
    if (e.status) return errorJson(e.message, e.status);
    console.error('social', name, e);
    return errorJson('Something went wrong, try again', 500);
  }
}
