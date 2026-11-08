# House rework review

Reviewed `src/houses.js`, `src/world.js`, `shared/game.js`, `src/main.js`, `src/store.js`, `lib/progress.js` and `api/block.js`. I also checked the demo in the browser at `?time=0.42` and `?time=0.9`, using house #7 at tiers 1 to 4 through `setOverride`. The character measures 3.3 units tall (bounding box y 0.07 to 3.35).

## 1. Verdict

- **They read as houses now.** This is a big step up. Foundations, corner boards, framed windows with sills, steps and stepping-stone paths all come through from the default camera. The manor reads well, and the cottage and two-storey are good. The family home is the weak one (see V1).
- **Paint works, but only partly.** The tint reaches walls, gables, dormers, roofs and the porch roof. Three things still undercut it:
  - Unpainted houses take a random colour from the same `WALL_PAINTS`/`ROOF_PAINTS` palette, so a purchase can look like no change. No swatch is marked as current until you have bought one.
  - Fronts facing −z sit in shade all morning. Paint 8 (`#9fb7d9`, light periwinkle) renders as dark navy, so the swatch doesn't match the house.
  - The shutters (`#4a5a6b`) vanish against blue and grey walls.
- **The upgrade path is clear** (cost shown as have/need, one button) **but too short**, and it reduces variety: every tier-2 house is the same family home. In the demo, all 1,536 loaded houses are tier 1, so a player never sees what they are working towards.

## 2. Visual problems (ranked)

**V1. Family home porch roof hides the house.** The flat slab sits at y 3.55–3.85 and runs from z 3.05 to 5.55. From the default camera it covers the door, both front windows and most of the painted wall. It also cuts through the tops of the window frames (frame tops are at 3.71). Fix in `porchRoof`:
- Raise the slab to `y: 3.9` and narrow it to `d: 1.6`.
- Slope it: build the slab at the origin, then `.rotateX(-0.22)` before translating to `(x, y + 0.3, z + d/2)`.
- Make the front windows `h: 1.3` at `y: 2.6`.
- Delete the no-op `.rotateX(0)` and the dead `step`/`void step`.

**V2. Porch lights clip things or float.**
- Cottage `[1.35, 3.35, 3.4]` sits on the right window's left shutter, which spans x 1.005–1.455 and y 1.85–3.55. This is visible in the screenshot.
- Family home `[1.2, 3.2, 5.0]` is inside the column at (1.35, 5.1).
- Two-storey `[1.4, 3.35, 3.6]` sits on a shutter.
- Every light floats 0.08–0.18 off its wall with no bracket.

Use these values instead:
- Cottage `[0, 3.6, 3.32]` (over the door)
- Cabin `[0, 3.0, 4.5]` (hangs from the porch ceiling)
- Bungalow `[-1.2, 3.1, 3.42]`
- Family home `[0, 3.25, 4.4]`
- Two-storey `[1.3, 2.9, 3.52]`, with the ground-floor windows set to `shutters:false` (V4)
- Manor `[0.45, 3.0, 3.72]`

Add a bracket for each wall light: `box(0.12, 0.12, 0.3, x, y, wallZ + 0.15)` in `details`.

**V3. Doors are too short for the character.** The door box starts at y 0, but the foundation covers it up to 0.5, so the visible door is 2.5 tall against a 3.3-unit character. Fix:
- In `door()`, start at the foundation: frame at `y: 0.5 + h/2`, door `h: 3.4`.
- Scale the character to `0.72` (about 2.9 tall).
- On the cottage, raise the front windows to `y: 3.0` so their tops line up with the door.

**V4. Shutters clip corner boards, overhang walls and overlap each other.**
- Cottage: the outer shutters (x to 3.595) cut into the corner boards (3.46–3.74).
- Two-storey: the lower outer shutters reach x 3.895, past the 3.8 wall edge. The middle upper window's shutters (0.695–1.145) overlap the neighbouring shutters (1.005–1.455) on the same plane, which causes z-fighting.
- Manor: shutters at x −3.6 reach −4.895, past the −4.7 wall. The x 1.6 window's shutter cuts into the corner board where the wing joins.

Fix:
- Change the shutter offset from `w/2 + 0.42` to `w/2 + 0.39`.
- Cottage windows `x: ±2.2, w: 1.1`.
- Two-storey lower windows `x: ±2.4, w: 1.2`, and the middle upper window `shutters:false`.
- Manor `x: -3.3, w: 1.1` (both floors), and the x 1.6 windows `shutters:false`.

**V5. Glass sits in front of its frame.** Frame z ±0.08, glass z+0.04 ±0.08. The glass ends 0.04 proud of the frame, so it reads as a sticker. Change glass to `box(w, h, 0.06, x, y, z + 0.02)` and the side-face equivalent.

**V6. The family-home dormer window is half buried.** The frame bottom (5.24) is below the roof surface at z 3.0 (about 5.64). Fix:
- Dormer body `box(1.8, 1.9, 1.6, 0, top + 1.15, 2.2)`
- Dormer roof `y: top + 2.2`
- Window `y: top + 1.35, h: 0.8`

**V7. Floating brackets on the two-storey canopy.** The posts at z 4.45, y 2.95–3.75 hang in mid-air. Move them to the wall at `z: 3.45` and make them 0.6 tall. Otherwise turn them into full columns from y 0 to 3.65 at z 4.2.

**V8. Collision boxes don't match the models.**
- Cabin and family-home porch columns (z 5.1) and manor columns (z 5.0) are outside `hz` (4.2/3.6/3.8), so players walk through them.
- The manor wing foundation reaches x 6.65, but the collision box stops at 6.4.

Add `cz` to `blocked()` in the same way as `cx`: `Math.abs(uz - (meta.cz || 0)) < meta.hz`. Then set:
- Cabin `cz: 0.7, hz: 4.7`
- Family home `cz: 0.9, hz: 4.5`
- Manor `cz: 0.8, hz: 4.5, cx: 0.75, hx: 5.95`

**V9. Decor slots collide.**
- On the family home, slot 0 (−4.6, 5.4) puts a 2.9-wide fence on the deck corner (deck x ±4.3, to z 5.4). This is visible in the screenshot. Give the family home its own `meta.slots`, with slot 0 at `[-5.6, 6.4]`.
- On the manor, slots 3 and 5 (x 7.2/7.3) plus the fence half-width of 1.55 reach x 8.85. Plots are 16 apart, so these spill into the neighbour's plot. Clamp `|x| + 1.6 ≤ 8`, using `[6.3, 6.0]` and `[6.9, -4.6]`.

**V10. Smaller issues.**
- The manor has two chimneys, but smoke reads only `meta.chimney`, which is the last one. Store `meta.chimneys[]` and emit smoke from both.
- The tall tiers hide the player when they walk behind or beside them (seen at the manor door). Fade the roof material, or cap the camera pitch, when the player is within `hx + 2`.

## 3. Upgrade design

Daily coin income tops out around 425: the sell cap is 300, quests give about 60 plus a 30 bonus, and the streak gift adds up to 35. Fishing alone reaches the 300 cap in about 45 casts (about 7 coins per cast), roughly 5 minutes. Logs (cap 150) and stone (cap 120) are not the limit; tree and rock cooldowns are, and the plaza alone covers them.

| Tier | Cost | Dedicated player | Casual (~15 min, ~180 coins/day) |
|---|---|---|---|
| 2 | 20 log, 10 stone, 100c | first session | day 1 |
| 3 | +40 log, 25 stone, 250c | day 1–2 | day 2–3 |
| 4 | +80 log, 50 stone, 600c | day 3 | day 6–7 |

That is too fast for the game's only long-term goal. Logs and stone also sell for 2 coins each, so spending them on an upgrade costs the player nothing. Proposed costs:
- Tier 2: `{ log: 30, stone: 15, coins: 150 }` (day 1)
- Tier 3: `{ log: 90, stone: 60, coins: 600, lantern: 2 }` (about day 4)
- Tier 4: `{ log: 200, stone: 150, coins: 1500, bench: 1 }` (about 2–3 weeks casual)

Adding crafted items to the cost ties upgrades into the workbench. The client already handles any item key.

Two structural fixes:
- **Keep identity.** Let tier 1 choose cottage, cabin or bungalow, stored as `state.style` in `publicLook`, with the first change free. Also give tier 2 two variants keyed on the same hash, so upgrades don't make the street uniform.
- **Seed the demo with upgraded houses.** Use something like `t: id % 11 === 0 ? 4 : id % 5 === 0 ? 3 : id % 3 === 0 ? 2 : undefined` in `demoBlock`, so players can see what they are working towards.

Three cheap customisation ideas that fit `residents.look` and `progress.state`:
1. **Door and shutter colour.** Add `paint.door` (8 swatches, 20c). Move the door slab and shutters out of `details` into a fifth instanced `accent` mesh tinted per instance, just like the walls. This also fixes the invisible-shutter problem.
2. **Front fence and garden.** A `look.yard` bitmask, built at the workbench, adds a perimeter picket fence (`[-7.5..7.5]` at z 7.3, with a gap at the path), flower beds along the foundation, or a lit path. These are one instanced mesh each, drawn in `#rebuildHouses`.
3. **House number sign and mailbox style.** `look.mail` (0–3) picks among four mailbox geometries already in the yard mesh; the number comes from `h.id`. Cheap, personal and visible from the street.

## 4. Bugs

1. **`'upgrade'` is missing from `URGENT`** in `src/store.js`. The upgrade sits in the queue for up to 20 s, and other players' CDN copy lags further. If the server rejects it (for example because harvest timing differs and the server has fewer logs), the house silently downgrades after the celebration. Add it to `URGENT`, and when a later server state has a lower `tier`, show a toast.
2. **Default paint is ambiguous.** Unpainted houses use `WALL_PAINTS[(seed>>>4)%8]`, so buying that colour charges 40 coins for no change, and the sheet never shows a current swatch. Give unpainted houses a separate neutral set (for example `0xeee6d8, 0xe6dccb, 0xdfe3e6`), or mark the default swatch as `on` and make it free.
3. **Shaded fronts darken paint.** Raise the `HemisphereLight` ground colour, or set the AO floor in `paint()` to `0.82 + 0.18*…`, so swatches stay recognisable.
4. **Old saves are safe.** `s.tier || 1`, `publicLook`'s `tier || 1` and `h.t || 1` all handle a missing tier. `lib/progress.js` only writes `look` when the look changes, so old rows gain `tier` on their next decor change. That's fine.
5. **`modelFor` uses strict `===`.** A string tier from a hand-edited jsonb row falls back to a starter model. Use `Number(tier) | 0` in `modelFor` and in `block.js` (`h.t = Number(r.look.tier)`).
6. **`blocked()` skips house collision until the block loads,** even for your own overridden house after a teleport. This is minor. Fall back to `this.overrides` when `this.houses` is missing the id.
7. **Guests:** the My house sheet is unreachable without `me`, which is correct. A guest can still call `upgrade` from the console, but it is harmless.

## 5. Top 5 fixes to do now

1. **Make paint unmistakable.** Use a separate neutral palette for unpainted houses, mark the current swatch, and lift the shaded-face lighting (bug 2 and bug 3).
2. **Fix the family home.** Raise, slope and shrink the porch roof, and fix the dormer and fence slot (V1, V6, V9).
3. **Move porch lights to clear wall positions with brackets,** and fix shutter overlaps and z-fighting (V2, V4).
4. **Fix door and character scale.** Start doors on the foundation at 3.4 tall and scale the character to 0.72 (V3).
5. **Add `'upgrade'` to `URGENT`, raise the tier costs to the proposed table, and seed demo houses with tiers** (bug 1, section 3).
