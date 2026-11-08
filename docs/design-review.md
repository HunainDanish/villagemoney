# Porchlight: Design Review

This review is opinionated and ordered by priority. Performance costs assume a mid-range phone at about 1.5x pixel ratio. **Frame budget: ≤ 60 draw calls (DCs), ≤ 250k triangles.**

---

## 1. Diagnosis

**Visuals (`src/world.js`)**
- **Flat, over-bright light.**
  - A hemisphere light at 1.6 and a white sun at 1.6 light every surface almost equally.
  - There is no `toneMapping` and no shadows, so houses float and nothing has form.
- **No surface variation.**
  - Each part has one Lambert colour. Trim is a single brown (`COLORS.trim`) and nothing is vertex-coloured.
- **One silhouette for every house.**
  - Every house is a `BoxGeometry(6,4,6)` with a `ConeGeometry(5,3,4)` pyramid roof: no gable, no overhang.
  - The door and windows are boxes 0.05 proud of the wall, so they read as stickers.
- **Ground.**
  - One grey 1200² plane with a green quad per block.
  - There are no sidewalks, kerbs, door paths, markings or props. Trees exist only around the plaza.
- **Sky.**
  - The background is a single colour (`scene.background`) and the fog is the same colour.
  - There is no gradient, sun or clouds.
- **Camera (`player.update`).**
  - Height is `38*zoom+4` at 26 units back: nearly top-down and undamped (it snaps every frame).
  - It reads as a map, not a diorama.

**Animation (`src/player.js`, `src/net.js`)**
- `makeCharacter` builds a capsule, a sphere and a cube nose. The only motion is `abs(sin(t/90))*0.25` on body y, a pogo hop.
  - There are no limbs, lean, idle, eyes or contact shadow.
  - Speed jumps from 0 to 14 or 26 instantly.
- Peers hop whenever `distanceToSquared > 0.01`, so they flicker as the lerp settles.

**Network (not on the owner's list, but the most urgent problem).** `net.js` sends every **250 ms while moving**, and Supabase counts broadcasts per recipient.
- With 10 players moving in a region, that is about 4×10×9 = 360 msg/s.
- At that rate **the 2M/month quota lasts about 1.5 hours**.
- Fix it first (Milestone step 0).

---

## 2. Graphics & animation plan

**Lighting**
- Set `renderer.toneMapping = AgXToneMapping` (or `NeutralToneMapping`) at exposure 1.0.
- Hemisphere light at about 0.9 (sky blue over green-brown), sun at about 2.2 in warm `#ffe2b8`. Warm light against cool shadows does the colour grading.
- Cost: free.

**Shadows near the player only**
- One `DirectionalLight` with `castShadow` and a 1024² map (2048 on desktop).
- Orthographic shadow camera ±45 units. Each frame put the sun at `player + sunDir*100`, target the player, and snap to the texel grid so shadows don't shimmer.
- `PCFShadowMap` (not Soft) on mobile, `bias -0.0005`, `normalBias 0.04`.
- Houses, trees and the player cast. Ground and lots receive.
- Cost: one depth pass over the nearby DCs, about 15-25% of GPU time.

**Ambient occlusion and grading**
- Bake AO into vertex colours: darken vertices near the ground and under eaves. Cost: free.
- Use a CSS `radial-gradient` vignette instead of post-processing. Cost: free.
- Optional desktop-only bloom for night windows, about 2 ms.

**Materials.** Stay on `MeshLambertMaterial`, with `flatShading` for roofs and trees.

**Sky dome.** Cost: 1 DC.
- `SphereGeometry(500,24,12)` with `BackSide` and `fog:false`.
- A small shader mixes horizon to zenith by `pow(dir.y,0.6)`, plus a soft sun disc and hash-noise stars × `nightFactor`.
- Each frame, set the fog colour to the horizon colour.

**Clouds.** About 14 clusters of 4-6 flattened icosahedra in one InstancedMesh at y≈120, drifting and wrapping around the player. Cost: 1 DC.

**Day/night cycle.** Cost: CPU only, no network.
- `timeOfDay` comes from `Date.now()` on a 24-minute cycle (18 minutes day, 6 night), so all players share it with zero network.
- Keyframes for dawn, noon, dusk and night each set zenith, horizon, sun colour and intensity, hemisphere colours and exposure. The client lerps between them.
- At night the sun becomes a dim blue moon.

**Glowing windows.** Cost: 1 DC per house style.
- Windows become their own InstancedMesh with `MeshBasicMaterial`.
- Lerp the colour from dark glass to `#ffcf7a` by `nightFactor`.
- Per-instance colour, seeded by id, leaves about 70% of houses lit.

**Porch lights.** Cost: 2 DCs.
- An instanced emissive bulb plus an instanced additive glow quad (`depthWrite:false`).
- One real `PointLight` snaps to the lit porch nearest the player.
- Lamp posts and the existing fountain lamp use the same trick.
- An owner's porch light is lit only if they visited today (see Section 4).

**Roads and lots.** Cost: 2 DCs.
- Roads: a procedural `CanvasTexture` (asphalt noise, dashed centre line, kerb) tiled to `PITCH`.
- An instanced sidewalk ring per block.
- Per-block grass tint of ±4% via `instanceColor`.

**Props** (deterministic from house id hash, built in `#rebuild`). Cost: 1 DC each, plus 1 shadow DC.
- Stepping-stone door paths.
- Mailbox on every house; picket fence on 50%.
- Flower beds with 0-6 instanced flowers in 5 colours.
- Hedges.
- 1-2 trees per house in the **back-garden strip** between rows 3 and 4, where the houses face away from each other. Three variants: round, pine, birch.
- Lamp posts on block corners and rocks on intersection corners.
- About 25k instances total. Cache each block's matrices as a `Float32Array` when it loads, and copy them on rebuild.
- Draw small props only in the 3×3 nearest blocks: order those first and lower `count`.

**House variety.** Cost: 16 DCs total, regardless of house count.
- Four styles, chosen by `hash(id)%4`. Each style has 4 InstancedMeshes:
  - body (instance colour);
  - roof (instance colour);
  - detail (merged with vertex colours: door, frames, trim boards, porch, steps, chimney);
  - windows.
- **Cottage:** `ExtrudeGeometry` gable with a 0.5 overhang and a two-post porch.
- **Townhouse:** tall, steep gable, bay window.
- **Bungalow:** wide hip roof, full porch with railing and bench.
- **A-frame:** roof to the ground, triangular window.
- Dark 0.1-unit trims and window frames change the look more than anything else.
- Picking uses a per-style `instanceId → house` table.

**Chimney smoke.** Cost: 1 DC.
- Only the 12 nearest chimneys. One pool of 60 low-poly puffs that rise, grow and shrink to zero.

**Character body.** About 400 tris per character.
- Chibi proportions, with the head about 40% of height.
- Parts: torso capsule, head icosahedron, 2 eyes, and 2 arms and 2 legs pivoting at shoulder and hip.
- One of 4 hats or hair styles, plus palette-picked colours, all seeded by name.

**Character instancing: a `CharacterCrowd` class.** Cost: about 8 DCs for 20 characters, against 160 as separate groups.
- One InstancedMesh per body part.
- Each frame, multiply root × part-local animated matrix.

**Procedural animation**
- Advance `phase += speed*dt*0.9`.
- Legs swing `sin(phase)*0.7`, arms swing opposite at 0.6.
- Bob `abs(sin)*0.12`. Lean forward 0.08 at walk, 0.2 at run, with ×1.3 amplitude when running.
- Idle: breathing (torso scale.y ±1.5%) and a look-around every 4-8 s.
- Blink: eye scale.y drops to 0.1 for 120 ms every 2-5 s.
- Roll into turns based on angular velocity.
- Damp speed (about 0.15 s) so the gait blends.
- Peers take speed from their smoothed velocity, which fixes the flicker.
- Actions (chop, pick, cast, wave) are short keyframe tables on the arm pivots.

**Contact shadow.** Cost: 1 DC.
- An instanced radial-gradient blob quad under every character. Only the local player casts a real shadow.

**Camera**
- Pitch about 40°, FOV 45.
- `MathUtils.damp` on position (λ6), target (λ10), yaw (λ12) and zoom (λ8).
- Look 3 units ahead of movement; FOV +4 while running.
- If houses hide the player, draw a second pass of the player with `depthTest:false` as a tinted silhouette. Cost: 1 DC.

**Particles.** Cost: about 0.2 ms CPU, 1 DC.
- One pool of 256 CPU-simulated instanced billboards.
- Effects: footstep dust, wood chips, leaf burst, pickup sparkles, falling leaves, night fireflies, fountain spray.

**Feedback ("juice")**
- Trees wobble on hit (scale spring).
- The item icon flies to the inventory button, which bounces.
- Short camera shake on a tree fall.

**Audio**
- **ZzFX** (about 1 KB, procedural, no files) for chop, pop, splash and clicks.
- WebAudio noise ambience: birds by day, crickets at night. Start it on first tap.

**UI**
- Fredoka or Nunito font.
- Cream cards with a 2 px border and soft shadow.
- 44 px touch targets.
- A bottom hotbar (Inventory, Craft, Quests, Home) with spring-eased panels.

---

## 3. Engaging activities (ranked by engagement ÷ effort)

**Shared rules**
- **Deterministic nodes.** `shared/nodes.js` derives every tree, bush and rock from the block or house id, so the server can verify a node with no table.
- **Personal node state.** A tree I chop is a stump *for me only*, so syncing it needs no messages.
- An optional single `fx` broadcast (`{i,a:'chop'}`) lets neighbours see the swing.
- **Batched server authority.**
  - The client acts optimistically and flushes queued actions to `POST /api/actions` every 20 s, or when the inventory opens.
  - One transactional Postgres function, `apply_actions()`, checks four things:
    - the node exists;
    - the node's cooldown has passed;
    - batch size ≤ elapsed seconds ÷ minimum action time;
    - the per-skill daily cap is not exceeded.
  - It returns the authoritative inventory, and anything rejected quietly disappears.
- **Guests** keep progress in `localStorage`, with a "sign in to keep your logs" nudge. Signing in requires DMing the Instagram account.

| Rank | Activity | Value/Effort |
|---|---|---|
| 1 | Woodcutting | ★★★★★ |
| 2 | Foraging | ★★★★★ |
| 3 | Daily neighbour quests | ★★★★☆ |
| 4 | Crafting | ★★★★☆ |
| 5 | Yard decorating | ★★★★☆ |
| 6 | Gifting via mailbox | ★★★★☆ |
| 7 | Emotes & benches | ★★★☆☆ (tiny effort) |
| 8 | Fishing at a plaza pond | ★★★☆☆ |
| 9 | Stamp collecting | ★★★☆☆ |
| 10 | Mining | ★★☆☆☆ |
| 11 | Paper-boat race | ★★☆☆☆ |

**1. Woodcutting**
- *Loop:*
  - Tap a tree and the player auto-walks into range.
  - 3-5 swings (fewer with better axes).
  - The tree tips over with an eased rotation about its base, bounces, and becomes 1-3 logs.
  - The stump regrows through 3 sapling stages over 10 minutes.
- *Feel:* wobble per hit, chips, a thunk SFX rising in pitch, and a leaf burst plus slight shake on "timber".
- *Server:* inventory and `harvests`. *Client:* animation, and stump state derived from the harvest time.
- *Network:* 0-1 realtime messages per tree, plus a batched HTTP call.
- *Anti-abuse:* ≥ 2.5 s per tree, 150 logs a day, 10-minute cooldown per node.

**2. Foraging**
- *Loop:* flowers in front beds, berries on fence bushes and mushrooms under trees sparkle when ready. Tap to pick (pluck animation and pop). Regrows in 15 minutes.
- What can be picked rotates by real month.
- You can't forage your own beds, which pushes you to walk the town.
- *Storage and abuse:* as woodcutting, with a cap of 200 a day.

**3. Daily neighbour quests**
- *Loop:* three per day, seeded by `hash(date, resident_id)`, so no table is needed. Examples:
  - "Bring 5 logs to @user's porch"
  - "Pick 3 tulips"
  - "Visit house #1,204"
- *Rewards:* coins and XP, plus a bonus for all three. Using real neighbours drives exploration and makes residents feel seen.
- *Server:* a `quest_day` and `quest_done` bitmask. `apply_actions` verifies completion against the inventory spent.

**4. Crafting**
- *Loop:* recipes live in `shared/items.js`:
  - 4 logs → fence
  - 3 logs + 2 flowers → planter
  - 2 logs + 1 stone → bench
  - 6 flowers → wreath
  - berries → jam (a gift item)
- 1.5 s hammer animation with sparkles.
- *Server only.* Crafting just converts items, so it's nothing to farm.

**5. Yard decorating**
- *Loop:* 12 fixed slots in each front yard, so there's no free placement and no collision work. At home, tap a slot to place, rotate or remove.
- **`/api/block` returns the decor**, so every visitor sees it through the CDN cache with no realtime cost.
- Decorated houses become landmarks and get screenshotted to Instagram.
- *Abuse:* 30 edits an hour.

**6. Gifting**
- *Loop:* give 1 item at any mailbox and its flag goes up. The owner sees "3 gifts waiting" with an opening animation on their next login.
- *Limits:* 5 sent a day, 1 per recipient per day, giftable items only.
- The giver gets a small kindness bonus.
- This is the strongest social hook in the list.

**7. Emotes & benches.** Wave, dance and sit, one broadcast each. Plaza benches let players sit together. Almost free, and very warm.

**8. Fishing**
- *Loop:* a pond in a plaza corner. Cast, wait 3-10 s, tap within 0.7 s of the bobber dipping. 12 species with rarities and size records.
- *Server:* the client only reports "reeled at t"; the server rolls the fish.
- *Limits:* one cast every 6 s, 60 fish a day.
- It gathers players at the plaza, so the town feels populated.

**9. Stamps.** Each block hides one stamp on a seeded prop. Ten stamps buy a hat. Stored as a bitset. Rewards exploring outward.

**10. Mining.** Intersection rocks give stone, plus gems 2% of the time. It's the woodcutting loop again, so add it only once stone recipes matter.

**11. Paper-boat race.** An asynchronous 30 s time trial around the fountain, with a daily top-10. The server rejects times under 8 s. No realtime cost.

---

## 4. Progression & retention

- **Inventory:** stacks defined in `shared/items.js` (id, name, emoji icon to start with, giftable flag), shown as a bottom-sheet grid.
- **Coins ("acorns"):**
  - *Earned* from quests, gifting bonuses and a plaza stall with fixed prices, capped at 200 a day.
  - *Spent* on cosmetics (hats, wall and roof paint, house styles) and recipe unlocks.
  - There is **no player-to-player trading**, which removes the motive to cheat.
- **Skills:** Woodcutting, Foraging, Fishing and Crafting, levels 1-20, with XP of `50·L^1.5` per level.
  - Levels unlock better tools, recipes and paints.
  - The total level shows on the house card.
- **Reasons to come back:**
  - **Your porchlight** shines tonight only if you visited today. Neighbours see who is active: on theme and nearly free.
  - **7-day streak** with rising rewards and a hat on day 7. One missed day per week is forgiven.
  - Regrowth timers, seasonal forage, and gifts waiting.
- **Invites (which grow the Instagram account):**
  - "Share my house" produces `/?h=1234`, plus a canvas screenshot card showing your house and @handle.
  - Invited friends DM the account for a key. Both players get a welcome gift, tracked by a `ref` on the new resident.
  - A weekly "New on the street" Instagram post tags newcomers.

---

## 5. Recommended first milestone (in priority order)

**Step 0: network fix (about 30 minutes, mandatory).**
- Broadcast on start and stop, on a heading change over 15°, or every 1 s while moving. Send a 6 s heartbeat when idle.
- Include `vx, vz` in the payload and dead-reckon on receipt.
- Render at most 20 peers.
- Expect roughly 4-6× fewer messages.

**Graphics**
1. Tone mapping, retuned lights, the follow-the-player shadow, and vertex AO.
2. Sky-dome shader and day/night keyframes: horizon fog, glowing windows, porch glow.
3. `CharacterCrowd` with articulated bodies: walk, run, idle, blink, blob shadows, peer speed from velocity.
4. Damped, lower camera.
5. Houses in 3 styles (cottage, townhouse, bungalow) with gable or hip roofs, porches and trims. Door paths, mailboxes, fences, flower beds, and 2 tree variants in back gardens.
6. Particle pool, ZzFX sounds, item-pop UI.

*Deferred:* clouds, smoke, A-frame houses, desktop bloom.

**Activities:** (1) woodcutting, (2) foraging, (3) crafting with yard decorating (fence, planter, bench and lantern; 12 slots), (4) daily quests. Gifting opens milestone 2.

**Data model** (RLS on, no policies, service role only):

```sql
create table progress (
  resident_id   bigint primary key references residents(id) on delete cascade,
  coins         int not null default 0 check (coins >= 0),
  xp            jsonb not null default '{}'::jsonb,   -- {"wood":120,"forage":40}
  streak        smallint not null default 0,
  last_day      date,                                 -- drives porchlight + streak
  quest_day     date,
  quest_done    smallint not null default 0,          -- bitmask
  day_counts    jsonb not null default '{}'::jsonb,   -- daily caps, reset on new counts_day
  counts_day    date,
  last_flush_at timestamptz not null default now()
);
create table inventory (
  resident_id bigint references residents(id) on delete cascade,
  item text not null, qty int not null check (qty >= 0),
  primary key (resident_id, item)
);
create table harvests (                               -- per-player node cooldowns
  resident_id bigint references residents(id) on delete cascade,
  node text not null,                                 -- "t:1234:1" = tree 1 of house 1234
  at timestamptz not null default now(),
  primary key (resident_id, node)
);
create index harvests_at_idx on harvests(at);         -- cleanup_expired(): delete at < now()-1h
create table yard_items (
  resident_id bigint references residents(id) on delete cascade,
  slot smallint check (slot between 0 and 11),
  item text not null, rot smallint not null default 0,
  primary key (resident_id, slot)
);
-- Milestone 2: gifts(id, from_id, to_id, item, created_at, opened_at), index on (to_id) where opened_at is null.
```

**API changes**

| Endpoint | Change |
|---|---|
| `POST /api/actions` | Accepts a batch of `{a:'harvest'|'craft'|'quest', node?, item?, t}` and calls a `security definer` `apply_actions()` in one transaction. Returns `{inventory, progress, rejected}`. |
| `GET /api/me` | Adds progress and inventory. |
| `PUT /api/yard` | Edits decor slots. |
| `/api/block` | Adds `d` (decor) and `lit` (`last_day = today`) per house, via a join on the same range scan. |

**Storage at 100k residents:** about 1M inventory rows (about 60 MB) and at most 1.2M yard rows. Hourly pruning keeps `harvests` small. Total stays well under 500 MB.

**Done when:**
- A phone holds 60 fps at dusk in a busy 5×5-block area.
- Chopping a tree feels good with the sound off.
- A signed-in player's logs survive a reload.
