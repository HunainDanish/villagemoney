# Porchlight

A small 3D town in the browser where every follower gets a house. "Porchlight" is a placeholder name: set `TOWN_NAME` to change it.

- **Frontend:** Vite + Three.js (static files on Vercel's CDN)
- **API:** Vercel serverless functions in `api/`
- **Database + live walking:** Supabase (free tier)

## Run it on your computer

```bash
npm install
npm run dev
```

Open http://localhost:5173. With no database configured, the site runs in **demo mode** with 2,600 fake residents and a few walking bots. Try searching `cosmic.panda300`.

```bash
npm test
```

## Free database: Supabase

Supabase's free plan gives you a Postgres database plus Realtime (live walking) in one place, so you don't need a second service. Check the current limits at supabase.com/pricing. Roughly: 500 MB database, about 200 concurrent realtime connections, and the project pauses after a week with no activity.

500 MB is a lot for this app. A resident row is about 100–200 bytes, so a million houses fit easily.

1. Create a project at https://supabase.com.
2. Go to **SQL Editor → New query**, paste all of `supabase/schema.sql`, and click **Run**.
3. Go to **Project Settings → API** and copy the project URL, the `anon` key, and the `service_role` key.

Other free Postgres options, such as Neon, would work for the database, but you'd need a separate service for live walking.

## Deploy free on Vercel

1. Push this folder to a GitHub repository.
2. On https://vercel.com, click **Add New → Project** and import the repository. Vercel detects Vite automatically.
3. Under **Settings → Environment Variables**, add the values from `.env.example`:

| Variable | What it is |
|---|---|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_...` key (or legacy `SUPABASE_ANON_KEY`). Public, only used for live walking; RLS blocks it from every table |
| `SUPABASE_SECRET_KEY` | `sb_secret_...` key (or legacy `SUPABASE_SERVICE_ROLE_KEY`). **Secret.** Server only |
| `ADMIN_SECRET` | A long random password for `/admin` |
| `IG_HANDLE` | Your Instagram handle, used by the "Get my house key" button |
| `TOWN_NAME` | Your town's name |
| `PUBLIC_SITE_URL` | e.g. `https://your-project.vercel.app` |

4. Redeploy. The demo badge disappears once the database is connected.

**Note:** Vercel's free Hobby plan is for personal, non-commercial projects. If you add paid features or ads, you'll need their Pro plan.

## Giving people houses before Instagram is connected

1. Someone DMs your account "key".
2. Open `https://your-site/admin`, enter `ADMIN_SECRET`, type their username, and click **Create key**.
3. Paste the link back into their DM. It works once and expires after 30 days.

Only send a link to the account that actually DMed you. That DM is what proves they own the username.

## Switching on Instagram later

`api/instagram.js` is already written. Once Meta approves your app:

1. In the Meta app dashboard, set the webhook callback to `https://your-site/api/instagram`, choose a verify token, and subscribe to `messages` and `comments`.
2. Add `IG_APP_SECRET`, `IG_ACCESS_TOKEN` and `IG_VERIFY_TOKEN` in Vercel and redeploy.

After that, DMs saying "key" get a link automatically, and 🏠 comments build houses. Check the payload field names against Meta's current Instagram API docs when you set this up, since Meta changes them from time to time.

## Upgrading an existing database (game update)

If you already ran `schema.sql` before the game update, run **`supabase/002_game.sql`** once in Supabase → SQL Editor. It adds the `progress` table and the `last_active` column. Until you run it, signing in will fail.

## The game

| Activity | Where | Reward |
|---|---|---|
| 🪓 Woodcutting | Trees in back gardens and around the plaza | Logs. The tree falls, and its stump regrows in 10 min |
| ⛏️ Mining | Rocks | Stone |
| 🌸 Foraging | Flower beds, berry bushes | Flowers, berries |
| 🎣 Fishing | Plaza pond: tap, wait for the bite, tap again | 5 fish (common to rare), plus the odd boot |
| 🔨 Crafting | Workbench (plaza) | Fence, planter, bench, lantern, birdhouse, gnome |
| 🪴 Decorating | Your house: 6 yard spots | Everyone walking by sees them |
| 🪙 Market | Stall (plaza) | Sell items for coins |
| 🏡 Upgrades and paint | **My house** (🏠 Home button) | Starter home → Family home → Two-storey house → Manor, paid in logs, stone, coins and crafted items. Wall and roof paint show on the spot |
| 📜 Quests | Board (plaza) | 3 a day, plus a bonus for finishing all three |
| 🔥 Streak and 🏮 porch light | Visit daily | Coin gift, and your porch light shines at night |

**How it stays cheap and fair**
- The rules live in one shared file, `shared/game.js`. The browser runs them for instant feedback, and `POST /api/actions` re-runs them on the server with the server's clock: cooldowns, an action budget and daily caps.
- Actions are sent in batches about every 20 s, so playing costs about 3 small requests a minute.
- Trees, rocks and bushes are computed from house numbers (`shared/nodes.js`), so they need no table.
- A chopped tree is a stump only for the player who chopped it, so no realtime messages are needed.
- Yard decor and paint ride along with the CDN-cached `/api/block` response.
- Guests play with progress saved in their browser. Residents' progress is saved on the server.
- The day/night cycle follows the clock (1 real minute = 1 town hour), so every player sees the same sky. Add `?time=0.9` to the URL to preview night.

**Live walking now uses far fewer messages:** positions are sent only while you move, 2 times a second, and only when someone else is in your area. Standing still costs nothing, and at most 20 other people are drawn.

See `docs/design-review.md` for the independent design review this update was built from.

## How it scales

| Concern | How it's handled |
|---|---|
| Town layout | A house's position is computed from its house number (`shared/layout.js`). There's no layout table, and nothing has to be recomputed when people join. |
| Loading the map | The browser only downloads the blocks of 64 houses near the player (25 blocks at most). A town of 10 million loads as fast as a town of 100. |
| Database load | Block and stats responses are cached on Vercel's CDN (20–300 s), so a viral spike mostly hits the cache instead of the database. Each block is a primary-key range scan. |
| Serverless connections | Supabase is reached over HTTPS, so thousands of function instances never run out of Postgres connections. |
| Rendering | Houses are drawn with instanced meshes: about 3 draw calls for 1,600 houses. |
| Live walking | The town is split into regions, and each browser only joins its own region's channel, so messages don't fan out to everyone. |

### What you'll outgrow first

1. **Realtime connections.** The free plan allows about 200 people walking around at the same time. Past that, either upgrade Supabase (about $25 a month) or move live walking to a dedicated service. The town and houses keep working either way.
2. **Supabase pausing.** Free projects pause after a week of no traffic. A live town rarely goes that quiet.
3. **Vercel function invocations.** CDN caching keeps these low, but watch the usage tab.

### Known limitations of this first version

- Names shown on *walking* characters are self-reported over realtime, so someone could spoof one. Names on *houses* are trustworthy because they come from the database. To fix this, sign realtime access with a server-issued token, using Supabase private channels.
- There's no nearby chat, coins or customization yet. The `look` column is reserved for customization.
- `privacy.html` is a template. Fill in the highlighted parts before launch.
