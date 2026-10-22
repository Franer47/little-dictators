# Little Dictators — Design Doc

*Living document. Last updated 2026-10-19.*

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
- **Size & projection:** 84°N to the South Pole, Patterson projection (looks like Miller
  in the middle, squeezes the poles so Antarctica isn't huge).
  - **Main map: ~2000 px wide** (~2000 × 1110), roughly OpenFront's scale, so tiny
    nations and islands get enough pixels.
  - The map builder can make any size from the same data. The **1500 × 833 version is
    kept** as a second map, so the game can later offer a map-size choice (e.g. a
    smaller/faster world, or larger ones as a Steam extra).
  - Bigger maps cost simulation speed (work grows with the number of pixels), so
    don't go far beyond ~2.5M pixels without testing performance.
- **Art style:** OpenFront-style. Each terrain type has its own base colour, and it gets
  lighter with height, so the relief is visible (plains green → highlands tan →
  mountains white). Nations will be coloured overlays on top.
- **Terrain** comes from real data: elevation from NOAA ETOPO1 and coastlines from
  Natural Earth. **Keep the list short** — only add a terrain type when it looks clearly
  different *and* plays differently. **No forest/biome types** (decided 2026-10-19).

  | Terrain | What it is | Later gameplay idea |
  |---|---|---|
  | Ocean / shallow water | Deep sea, coastal water, and big lakes | Naval movement, needs tech |
  | River | Major rivers, a thin 1-pixel blue line | Armies can cross, but attacking across a defended river is hard |
  | Plains | Land below 700 m | Fast expansion, high population |
  | Highlands | 700–2000 m | Slower expansion, some defence bonus |
  | Mountains | 2000 m and up | Very slow to conquer, strong defence |
  | Snow | Cold far north beyond the tree line | Slow, low population |
  | Ice | Greenland, Antarctica | Barely habitable |

  **Priority** when several apply: Ice > Mountains > Snow > Highlands / Plains.
- **Lakes** are ordinary water (same types as the sea), not a separate type. Only big
  lakes are on the map (Caspian, Great Lakes, Victoria, Baikal, Ladoga, Titicaca…).
- **Rivers:** only the major ones (~30–40: Nile, Amazon, Mississippi, Volga, Danube,
  Yangtze…). They are drawn as an unbroken line with no diagonal gaps, so a river
  cleanly separates its two banks.
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
- **Start year:** the player picks it. **1500 is the first era built**; 1800, 1900 and
  2000 later. The year sets the starting
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
  - **River crossings:** armies can cross rivers, but breaking through is hard when the
    enemy defends the other bank.
- **Water ownership & national waters:**
  - A river that runs *between* two nations is a border and belongs to neither. A
    river (or lake) fully inside one nation belongs to it.
  - Nations have **national waters**: the sea, lake and river pixels next to their
    coast. Foreign military may not enter them unless the two are at war, allied, or
    have some kind of access agreement.
- **Canals:** a nation can dig a canal, turning land pixels into water to join two
  water bodies (think Suez or Panama). It gives up that land and costs a lot of time
  and resources, but can be worth it for trade and navies.
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
   - **1d. Lakes & rivers:** big lakes as water, major rivers as a River terrain line.
     Map only; ownership, national waters, crossings and canals come with milestones
     4–6. ✅ Done (PR #4).
   - **1e. Bigger map:** main Earth map 2000 × 1111 (Natural Earth 1:10m coasts); the
     1500 × 833 map is kept as "Earth (small)". ✅ Done (PR #5).
   - **Start screen (alpha):** pick a map, then Start. It will grow into the game
     setup screen (start year, how full the map is, wheel settings…) in milestone 2.
2. **Wheel (cosmetic)** — wheel UI with words/numbers only; results are stored and shown
   on the nation but have **no effect** yet. Includes the customizable wheel setup
   (modes, options, bonus Continent wheel), random editable names, start year choice.
   Place nations and grow territory. Save/load.
   - **2a. Wheel beta:** after picking a map → one big wheel, **5 spins**: Government,
     Land size, Population, GDP, Ideology. All slices equally likely for now (odds come
     later). Then a **nation card** with a random (editable) name and the 5 results,
     then the map. In the game, a **nation panel in the bottom-right corner** (flag
     placeholder + name + key results); clicking it opens the **creation record**:
     everything rolled when the nation was made. Two wheel **styles** to compare,
     switchable before spinning: **Retro pixel** (chunky, 8-bit sounds) and **Bold game
     show** (bright slices, ticking pointer, pop on the result), with a mute button.
     Wheel contents live in an editable data file. Purely cosmetic.
     After picking the map, a short **zoom-into-the-map transition** leads into the wheel. ✅ Done (PR #6).
   - **2b. Wheel content & realistic numbers (1500 start):** ✅ Done (PRs #7–#10).
     - **Era-based wheels:** `public/data/eras/1500.json`; one file per era. Spin rules
       live in `src/game/roller.ts`, shared by the wheel screen and instant rolls (same
       seed → same nation).
     - **11 spins:** Government → Land size → Population density → Wealth → Bonus
       resources (×3, no repeats) → Ideology → History → Stability → Popularity → Bonus
       spin → Golden spin. **Culture and Religion are switched off** for now (lists kept
       in the data file with `"off": true`).
     - **Chained numbers:** land 2,000–800,000 km² (max ≈2.25× Germany; 3 slices above
       the old 535,000 cap: Immense/Colossal/Titanic; odds see 2e) with a size
       comparison; density 0.5–60/km²; output $900–3,100 per person (Maddison 1500, in
       today's dollars). Population = land × density, GDP = population × output.
     - **Rare pulls:** a thin black slice (1.5%) on Government and Ideology opens a dark
       wheel of 7 rare results (Eternal Republic, Necrocracy… / Eternalism, Apocalypticism…).
       At most one per nation (~3% of nations).
     - **Nation chart:** every result moves the nation's dot left/right (liberal & peaceful
       ↔ nationalist & tyrannical) and up/down (good life ↔ miserable).
     - **Bonus spin:** ~20 traits ("Seeks revenge", "Open borders"…); slices are bigger
       the nearer they sit to the nation's dot on the chart.
     - **Golden spin:** a chance wheel (higher toward the chart's corners, up to 60%;
       ~1 nation in 14 wins), then a gold wheel: double land / people / wealth, or a
       special trait.
     - **Names** come from government + ideology (titles and 24 syllable sets).
     - **Still to discuss:** final odds/percentages, the government and ideology lists,
       whether Culture/Religion come back, and more rare results.
   - **2c. Later polish:** flags and really advanced generation scripts (names, flags,
     history) come with the polishing phase.
   - **2d. Placing nations:** click a start spot or "Surprise me"; land grows by cheapest
     path (plains 1, highlands 3.5, snow 4, mountains 15, rivers 40), stops at the sea and
     other nations, real km² per pixel. Each nation has its own **colour** (its flag for
     now; touching nations never share one). Only land size matters; no stats yet.
     ✅ Done (PR #11).
   - **2e. Better placement & filling the world:** ✅ Done (PRs #13, #14).
     - **No snakes:** fixed by *where* nations start, not shape rules (those made
       octagons and were dropped). Random starts go on **coasts and riverbanks**, in free
       pockets ≥ 60,000 km²; the inland gaps fill with later nations. Tidy-up trims
       1-px strings and fills small holes.
     - **The whole world** is the default region (Europe stays as an option). **Fill the
       world** makes ~900 nations in ~3 s, stops new nations at 95% and lets neighbours
       absorb the rest, so **all land is owned**.
     - **The land wheel follows the map:** big slices get rarer as the world fills, and
       sizes that don't fit are left off. Fill never rolls City-state/Tiny (the player can).
     - **Land odds** (rebalanced): city-state 4, tiny 6, small 14, modest 23, medium 25,
       large 16, vast 7, immense 2.5, colossal 1.5, titanic 1 (%).
     - **North–south fairness ("halfway"):** the flat map stretches land away from the
       equator, so growth aims for rolled × (pixel area / equator pixel area)^0.5. The
       panel still shows the real km².
     - **Islands grow overseas:** land can cross up to 8 sea pixels (dear: 25× plains);
       the sea itself is never owned.
     - **Nation list:** top 3 by land + your nation; an arrow opens the full list.
   - **Online:** the repo is **public** for now and the game is published on every push
     to main at **https://franer47.github.io/little-dictators/** (GitHub Pages; free only
     while the repo is public). ✅ PR #15.
   - **Open for later:** deserts as terrain, whether border rivers belong to neither
     nation, real flags (2c), save/load, the game setup screen (start year, wheel modes).
3. **Stats matter** — wheel results turn into real numbers: derived values such as army
   strength, growth rate, stability, economy.
   - **3a. Stat sheet (next):** every nation (yours and all AI nations) gets a stat sheet,
     computed from its wheel results **and the land it actually got**:
     - **Army & manpower** (recruits from population × recruit rate; army quality),
     - **Economy & treasury** (yearly income from GDP and taxes; starting treasury),
     - **Growth & food** (growth rate; how many people the land can feed),
     - **Stability, popularity & aggression** (aggression from the chart and traits),
     - plus a few more the build session proposes (e.g. defence, trade, naval reach).
     - **Terrain & access count:** share of plains/highlands/mountains/snow, coastline and
       rivers change food, defence and trade.
     - Shown as **real numbers with a "why" breakdown** on hover (e.g. "Militarist +30%,
       Mountains +10%, Unstable −15%"). **Everyone's stats are visible** (you're an
       observer). All modifiers live in data files, so they're easy to tune.
     - Stats don't change over time yet; that's milestone 4.
   - **Stability is earned (decided 2026-10-21):** the wheel's stability is only a head
     start. Each month stability moves toward a target the nation earns: **up** with a
     growing economy, growing and well-fed population, buildings and development, won wars,
     gained land and long peace; **down** with the opposite (shrinking economy, debt,
     famine, lost land and wars). After ~10–20 years the starting roll barely matters, and
     early on stability's effects are mild.
4. **Ticks + basic simulation** — the clock runs; growth and peaceful expansion into empty
   land. Kept simple, upgraded later.
5. **Conquest** — wars and pixel-by-pixel front lines. Two modes: push on all borders, or
   influence a single army to follow a specific path/pattern. Overseas invasions,
   river crossings, national waters.
6. **Depth** — events, resources, history effects, revolutions, technology (research,
   spread, tech alliances), canals, and **procedurally generated flags** based on the nation's
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
