# Little Dictators — Design Doc

*Living document. Last updated 2026-10-18.*

## Pitch

Spin wheels to create nations on a pixel map, then watch (and nudge) a lightweight
Victoria-style simulation as they grow, ally and fight over pixels like OpenFront.io.

- **Platform:** browser first, Steam later. Desktop (mouse + keyboard) first, mobile later.
- **Players:** single-player first; multiplayer is a possible add-on at the very end.
- **Player role:** observer + influencer. There is **no full-control "ruler" mode** —
  the player never directly runs a nation, only nudges the world.
- **Release:** free in the browser, paid on Steam (with extras such as bigger maps,
  mod support, achievements).
- **Language:** English, with all game text kept in one place so translations can be
  added later.
- **Modding:** wheels, governments, techs, events etc. live in simple editable data files.

## A game in three phases

### 1. World setup
- **Map:** real Earth first, **including Antarctica** (like OpenFront). Generated / other
  maps come later.
- **Size & projection:** 1500 × 833 px, 84°N to the South Pole, Patterson projection
  (looks like Miller in the middle, squeezes the poles so Antarctica isn't huge).
  Even larger maps and other modes later.
- **Art style:** OpenFront-style. Each terrain type has its own base colour, and it gets
  lighter with height, so the relief is visible (plains green → highlands tan →
  mountains white). Nations will be coloured overlays on top.
- **Terrain** comes from real data: elevation from NOAA ETOPO1, coastlines from
  Natural Earth, forests from satellite land-cover data. **Keep the list short** — only
  add a terrain type when it looks clearly different *and* plays differently.

  | Terrain | What it is | Later gameplay idea |
  |---|---|---|
  | Ocean / shallow water | Deep sea and coastal water | Naval movement, needs tech |
  | Plains | Land below 700 m | Fast expansion, high population |
  | Highlands | 700–2000 m | Slower expansion, some defence bonus |
  | Mountains | 2000 m and up | Very slow to conquer, strong defence |
  | Rainforest | Tropical rainforest (Amazon, Congo, SE Asia) | Very slow to conquer & supply, low population, rich resources |
  | Forest | Any other dense forest (taiga, temperate woods) | Slow expansion, defence bonus, timber |
  | Snow | Cold far north beyond the tree line | Slow, low population |
  | Ice | Greenland, Antarctica | Barely habitable |

  **Priority** when several apply: Ice > Mountains > Snow > Rainforest / Forest >
  Highlands / Plains. A forest on high ground is still shaded by its height.
- **Map data vs. looks:** the map's *data* (one exact colour per terrain type, so it can
  be edited like a modding file) is kept separate from the *heightmap* used for
  shading. Game logic only reads the terrain data.
- Each pixel has terrain, later also a resource and an owner.
- The map is split into named regions/continents so the wheel can target them.
- **Map edges:** each map says whether it wraps east–west (`wrapX`).
  - **Earth wraps east–west**, like HOI4: scrolling past the Pacific loops back around.
    The map never wraps north–south; the camera can't zoom out or move far enough
    to see past the top or bottom edge.
  - Maps that don't wrap (some made-up maps) keep the camera inside the map on all
    sides.
  - The simulation must treat a wrapping map's left and right edges as neighbours
    (e.g. Alaska ↔ Chukotka), for borders, expansion and war.
- **Start year:** the player picks it (e.g. 1800, 1900, 2000). The year sets the starting
  technology level and how much of the world is already claimed.
- **Empty land:** the player can choose how full the map is, but the default depends on
  the start year (earlier = more unclaimed land to expand into).

### 2. Nation creation — the wheel
For each nation, the player goes through a set of wheels, e.g.:

| Wheel | Example results |
|---|---|
| Continent / region | Europe, Africa, "Northern Isles"… |
| Government | Monarchy, Democracy, Junta, Theocracy, Communist state… |
| Land size | Tiny, Small, Medium, Large, Huge |
| Population | tier → estimated number |
| GDP | tier → estimated number |
| Culture / ideology | … |
| Resource focus | Grain, Iron, Oil, Gold… |
| History cards (1–2) | "Former empire", "Colonial empire", "Recent civil war"… |

**Stat display:** word stats (government, ideology, culture…) stay words. Number stats
are shown as **estimates** (e.g. "~42M people", "~$340B GDP").

**Names:** generated from the nation's stats (e.g. "Holy Kingdom of Varnia"); the player
can rename.

**Territory shape:**
- A nation starts mostly as one connected area around its starting pixel, growing to
  its rolled land size.
- It can also start with some extra land if there's an island nearby, or if it is very
  powerful or a colonial empire (history card).
- Nations without overseas land at the start can get it later by invading, choosing
  where to expand.

Repeat until the map is as full as wanted, or auto-fill the rest.

#### Customizable wheel
The wheel setup is fully configurable, per wheel:

- **Mode** — *Spin* (animated wheel), *Choose* (player picks the value), *Random*
  (rolled instantly, no animation), or *Off* (wheel not used).
- **Options & weights** — add/remove/rename slices and change how likely each is.
- **Bonus wheels** — optional extra wheels such as *Continent*: if the player doesn't
  want to pick where a nation spawns, the wheel decides. Leaving more wheels on
  *Random* means more of the world is left to chance.
- **Presets** — save/load wheel configurations ("Realistic", "Chaos", "All random"…).

### 3. Simulation
- Time moves in ticks (e.g. 1 tick = 1 month) with pause / speed controls.
- **Economy:** population & GDP grow based on government, land, resources, stability.
- **Diplomacy:** opinions between nations (borders, ideology, history) → alliances,
  rivalries, wars, and **technology alliances**.
- **War:** front lines move pixel by pixel. Reach depends on technology (railways,
  naval supply, air supply…).
- **Events** change stats (revolutions, collapses, splits…).
- **Game end:** endless sandbox by default, with optional goals (end year, one nation
  controlling X% of the map, etc.).

#### Technology
- A simple list of techs (railways, naval supply, air supply…) that add stats or
  abilities.
- **You can't get ahead of your time** — techs are capped by the current year/era.
- Each nation researches on its own; richer nations research faster.
- **Tech spreads:** when one nation gets a tech, nearby nations get it faster — more so
  if the inventor is open (e.g. a democracy).
- Nations can form tech alliances to share research.

### Player influence
- Spend influence on nudges: fund rebels, push an alliance, trigger a crisis.
- Military nudges: tell a nation to push on all fronts, or direct a single army along a
  path you draw.
- **Limits are a setting:** influence points that refill over time by default, with a
  sandbox toggle for unlimited influence.

## Milestones

1. **Map** — load and render the real-Earth pixel map (~1000×500, flat colours),
   pan/zoom, click a pixel to inspect it. ✅ Done (first version).
   - **1b. Map polish:** east–west wrapping, no visible void past the edges. ✅ Done (PR #1).
   - **1c. Terrain:** OpenFront-style terrain from real elevation (plains, highlands,
     mountains, ice, snow), shaded relief, Antarctica, map 1500 px wide. ✅ Done (PR #2).
   - **1d. Forests:** Rainforest and Forest from satellite land-cover data.
2. **Wheel (cosmetic)** — wheel UI with words/numbers only; results are stored and shown
   on the nation but have **no effect** yet. Includes the customizable wheel setup
   (modes, options, bonus Continent wheel), random editable names, start year choice.
   Place nations and grow territory. Save/load.
3. **Stats matter** — wheel results turn into real numbers: derived values such as army
   strength, growth rate, stability, economy.
4. **Ticks + basic simulation** — the clock runs; growth and peaceful expansion into empty
   land. Kept simple, upgraded later.
5. **Conquest** — wars and pixel-by-pixel front lines. Two modes: push on all borders, or
   influence a single army to follow a specific path/pattern. Overseas invasions.
6. **Depth** — events, resources, history effects, revolutions, technology (research,
   spread, tech alliances), and **procedurally generated flags** based on the nation's
   stats (government → layout/symbol, ideology → colours, etc.).
7. **Influence + polish** — influence system (limited + sandbox), UI/UX polish,
   balancing, Steam build, large map, mobile support. Multiplayer as a possible final
   step.

## Tech direction (proposed)

- **TypeScript + Vite**, running in the browser.
- **Rendering:** HTML canvas (raw `ImageData` or PixiJS). ~1000×500 is ~500k pixels,
  which is fine.
- **Simulation separate from rendering** — plain deterministic game logic (later in a
  Web Worker). Makes saving trivial (save = state) and keeps multiplayer possible.
- **Game data in data files** (JSON) — wheels, governments, techs, events, text strings.
  This gives modding and translation support almost for free.
- **Saves:** IndexedDB in the browser + export/import as a file.
- **Real-world map:** a PNG where each colour means a terrain type, plus a region mask.
- **Generated maps (later):** noise-based terrain generation.
- **Steam:** wrap the same build with Electron or Tauri later.

## Open questions

- Exact list of wheels and their slices for milestone 2.
- Which start years / eras to offer, and roughly what the world looks like in each.
- Tick length and game speed options.
- First list of technologies.
