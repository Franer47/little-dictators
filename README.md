# Little Dictators

A browser game where you spin wheels to create nations on a pixel map of the world,
then watch (and nudge) them grow, ally and fight. See [DESIGN.md](DESIGN.md) for the plan.

## Running it

You need [Node.js](https://nodejs.org) (LTS).

```bash
npm install      # once, downloads the tools
npm run dev      # starts the game at http://localhost:5173
```

The game opens on a start screen (alpha): pick a map and press **Start** (or Enter, or
double-click a map). To pick another map, reload the page. Then you create your nation on
the wheel (below) while the map loads in the background.

## Creating a nation: the wheel (beta)

![The game show wheel](docs/wheel-gameshow.jpg)

The game starts in **1500**, and every wheel fits that time: kingdoms, sultanates,
khanates and merchant republics, no juntas or GDP talk. One big wheel is spun once per
question, **9 spins** in this order:

1. **Government**: Feudal Monarchy, Absolute Monarchy, Elected Monarchy, Sultanate,
   Khanate, Imperial Bureaucracy, Merchant Republic, Noble Republic, City-State,
   Theocracy, Knightly Order, Tribal Confederation, Chiefdom, Despot Rule, Warlord Rule,
   Regency, and a **rare** Eternal Republic.
2. **Land size**: a range, then the exact area in km² (never more than 535,000 km², which is
   1.5× Germany), with a comparison such as "≈ the size of Portugal".
3. **Population density**: Empty … Crowded, then the exact people per km². **Population =
   land × density**, so a tiny land can never hold millions of people.
4. **Wealth**: Very poor … Very rich, then the exact output per person.
   **GDP = population × output per person**, in today's dollars.
5. **Bonus resources**: spun **3 times**, never the same one twice (grain, iron, silk,
   spices, furs…). Other resources will come from the land itself later.
6. **Ideology**: Traditionalist, Expansionist, Trade-minded, Fanatical, Humanist,
   Isolationist, Militarist, Reformist, Honour-bound, Tolerant, Seafaring, Scholarly,
   Pragmatic, and a **rare** Satanist.
7. **History**: one story card, e.g. "Recent civil war", "Former empire", "Golden age".
8. **Stability**: Collapsing … Rock solid.
9. **Popularity**: Hated … Revered.

On the number wheels (land, density, wealth) the second spin's slices show what you'd get
(e.g. "1.4M" people or "$4.2B"), so you can see the numbers add up. **Rare slices** are
thin gold slivers; landing on one gets a "Rare!" badge and extra confetti.

The results collect on the nation card in groups (Power, Land & wealth, Story). After the
last spin the nation gets a name made from its government and ideology, e.g. "Sultanate of
Al-Basra", "Iron Khanate of Kharkhorum" or "Holy Prince-Bishopric of Witenberg" (click it
to rename, or press the dice for a new one), and **Continue to map** takes you to the map.
The nation panel in the bottom-right corner shows the name and key results; click it for
the **creation record** (every roll, its odds, the date and the random seed). Esc closes it.

![The finished nation card](docs/nation-card-1500.jpg)

For now this is cosmetic: the results are stored and shown but don't change the game yet,
and nothing is saved when you reload.

| Action | Input |
|---|---|
| Spin / next wheel | **Spin** button, Space, Enter, or click the wheel |
| Switch look | **Retro pixel** or **Game show** (top right; remembered) |
| Sound on/off | Speaker button (remembered). Sound starts after your first click or key press. |
| Quick spins for testing | **Skip animation** |
| Roll every wheel that's left at once | **Spin the rest** |

![The retro pixel wheel](docs/wheel-retro-1500.jpg)

### Tuning the wheels

Everything on the wheels is in data files, so you can change it without touching code
(reload the page after saving):

- **`public/data/wheels.json`** says which era the game uses (`"era": "1500"`), where each
  era's file is (`eras`), and has every word shown on the wheel screen, card and panel
  (`text`).
- **`public/data/eras/1500.json`** has the 1500 wheels, in spin order, plus the name parts.
  Later eras get their own file next to it.

In an era file:

- **Slices**: each has a `label`, a `blurb` (the flavour line) and a `weight`, and
  optionally a `short` label for the wheel itself (the full label shows big when it
  lands). Weights are relative odds: all 1 means equal chances, 2 is twice as likely as 1,
  0 never comes up. Slices take up room on the wheel in proportion to their weight, so what
  you see is the real odds. `"rare": true` draws a slice in gold and celebrates it.
- **Wheels**: `"off": true` keeps a wheel in the file without spinning it (Culture and
  Religion are kept like this for later); `"picks": 3` spins a wheel 3 times with no
  repeats; `resultName` is what the card calls the result ("Population" for the density
  wheel).
- **Number wheels** (with a `number` block): each slice has a `range` of `[low, high]`.
  `times` chains the wheel to an earlier one (density `times` land = population), `max`
  caps the result, `exactSlices` sets how many numbers the second wheel has, and `range`,
  `value`, `total`, `detail` say how things are written. The `notes` at the top of the
  file say where the ranges come from.
- **Groups**: `groups` sorts the results into sections on the card and in the record;
  `panel.show` picks which results the corner panel shows.
- **Names**: `names.titles` has title patterns per government ("Sultanate of {place}"),
  each government's name `styles` (the syllable sets in `names.places`, e.g. Khanate uses
  turkic and mongol), and `names.modifiers` adds a word from the ideology ("Great {name}",
  "Kingdom of Greater {place}").

If the files have a mistake (e.g. a negative weight, or a range above the land `max`), the
game shows an error saying which file and where.

Testing shortcuts: `?wheel=skip` rolls the whole nation instantly, `?seed=123` makes the
rolls repeatable (the same seed gives the same nation whether you spin or skip), e.g.
<http://localhost:5173/?map=earth-1500&wheel=skip&seed=123>. In the browser console (dev
server only):

- `game.checkWeights()` spins every wheel 100,000 times and prints how often each slice
  won next to its expected odds.
- `game.checkNumbers()` rolls 10,000 nations and prints the smallest, typical and biggest
  land, population and GDP, plus the smallest and biggest economy rolled.
- `game.sampleNations(5)` prints a few whole rolled nations.

## Controls

| Action | Input |
|---|---|
| Move camera | Drag with the mouse, or WASD / arrow keys (hold Shift for faster) |
| Zoom | Mouse wheel, or Q / E |
| Zoom all the way out | F |

## Map edges

The Earth wraps east–west: keep panning right and you come back around from the left,
like in Hearts of Iron. It doesn't wrap north–south: at the furthest zoom the map's
height exactly fills the screen, and you can't pan past the top or bottom edge.
Each map says whether it wraps with `"wrapX"` in its `public/maps/<name>.json`;
`GameMap.wrapX()` / `normalize()` find the real pixel for any x, e.g. a neighbour across the seam.

## Project layout

```
src/
  main.ts                 starts the game
  ui/startMenu.ts         the start screen: pick a map
  ui/wheel/               the wheel screen: flow, the two wheel looks, sounds, confetti
  ui/nationPanel.ts       the nation panel in the corner and its creation record
  game/wheels.ts          loads the wheel data, spins (weighted random picks)
  game/nation.ts          a nation and its creation record; chained numbers; name generator
  game/devChecks.ts       console checks: game.checkWeights(), checkNumbers(), sampleNations()
  game/random.ts          seeded random numbers for game logic
  map/terrain.ts          terrain types and their (data) colours
  map/projection.ts       turns longitude/latitude into map pixels
  map/gameMap.ts          loads a map into a grid of terrain values + elevation
  render/camera.ts        where the camera looks and how far it's zoomed
  render/mapRenderer.ts   draws the map on screen
  render/terrainColors.ts the shaded look: colour ramps, hillshade, coasts, sea depth
  input/cameraControls.ts mouse + keyboard camera controls
scripts/
  build-earth-map.ts      generates the Earth map from real-world data
  earth-water.json        which lakes and rivers go on the Earth map (editable)
public/maps/              map files (see below)
public/data/wheels.json   which era is used, and the screen text (editable)
public/data/eras/1500.json the 1500 wheels, number ranges and name parts (editable)
data/raw/                 downloaded source data for the map builder (not committed)
```

## The Earth map

![The Earth map](docs/earth-map.jpg)

The map runs from 84°N to the South Pole, in the
[Patterson projection](https://en.wikipedia.org/wiki/Patterson_projection) (it keeps
Europe and North America looking like the familiar Miller world map, but squeezes the
poles so Antarctica fits without a huge stretched strip).

### Map sizes

The builder makes the same map in more than one size, from the same data and rules:

| Map | Size | Coastlines | Used for |
|---|---|---|---|
| `earth` | 2000 × 1111 | Natural Earth 1:10m | The main map: the game loads this one. |
| `earth-1500` | 1500 × 833 | Natural Earth 1:50m | The earlier, smaller map, kept for a future map-size option. |

Pick either one on the start screen. The list is `MAP_CHOICES` in `src/ui/startMenu.ts`.
For quick testing you can also skip the start screen by naming a map in the address, e.g.
<http://localhost:5173/?map=earth-1500> (any map in `public/maps/` works this way).

The sizes are listed in `MAPS` at the top of `scripts/build-earth-map.ts`; adding a size
is one line. Settings measured in pixels (how far the shallow water reaches, the size of
the snow edge's wiggles, how far a river mouth may be joined to the sea…) were tuned on
the 1500 map and are scaled to each size so they cover the same distance on the ground,
and the shading is scaled the same way, so every size looks alike. Rivers stay exactly
1 pixel wide at every size.

Each map is three files in `public/maps/` (here for `earth`; `earth-1500` has the same three):

| File | What it is |
|---|---|
| `earth.png` | The terrain **data**: one exact flat colour per terrain type (see `src/map/terrain.ts`). This is what the game logic reads, and what you'd edit to change the map. |
| `earth-height.png` | The **heightmap**, only used for the shaded look and the hover info. Each pixel's height is `red × 256 + green − 32768` metres (negative = below sea level). It's stored this way because browsers only read 8 bits per colour channel. |
| `earth.json` | Size, projection, latitude range, `wrapX`, and where the heightmap is. |

Terrain comes from real elevation, averaged over each pixel:

| Terrain | Rule |
|---|---|
| Ocean / Shallow water | Water (the sea and big lakes); shallow if within about 50 km of land (2 pixels on the 1500 map, 3 on the 2000 map) |
| River | Major rivers: a line exactly 1 pixel wide (see below). Beats every land type except Ice. |
| Plains | Land below 700 m |
| Highlands | Land from 700 m to 2000 m |
| Mountains | Land 2000 m and higher |
| Ice | Greenland, and all land south of 60°S (Antarctica) |
| Snow | The cold far north: plains and highlands beyond the Arctic tree line (tundra), e.g. northern Canada, Alaska, the Russian Arctic, Chukotka. Higher ground turns snowy further south. |

The thresholds are constants at the top of `scripts/build-earth-map.ts`. The Snow edge
follows a table of the real tree line's latitude around the globe (`TREE_LINE`): it's
far north in Norway (~70°N, warmed by the Gulf Stream) and far south around Hudson Bay
(~57°N). Every 140 m of height counts as one degree further north, and a little noise
keeps the edge from looking like a drawn line.

### Lakes and rivers

Big lakes are ordinary water, the same Ocean / Shallow water as the sea: every natural
lake of at least 5,000 km² (the Great Lakes, Victoria, Tanganyika, Baikal, Ladoga,
Titicaca, Great Bear / Great Slave, Winnipeg, Balkhash…) plus the Aral Sea. Dry salt
pans (Lake Eyre, Lake Torrens) and reservoirs are left out.

Rivers are the River terrain: about 35 major rivers, each an unbroken line exactly 1 pixel
wide that steps only sideways or up/down, never diagonally. So a river cleanly splits the
land on its two banks (nothing can slip through a diagonal gap), and every river runs on
to the sea, lake or river it flows into. River counts as water for drawing and hover, but
unlike the sea, armies will be able to cross it (`crossableByArmies` in
`src/map/terrain.ts`).

Which lakes and rivers are used is set in `scripts/earth-water.json`: the lake size
cutoff, and for each river the Natural Earth names of its pieces (the Yangtze is
"Yangtze", "Chang Jiang", "Jinsha"…), plus a few hand fixes: `dropLines` to leave out side
branches of a delta, `extraLines` to draw stretches the data is missing. Edit it and run
`npm run build:map` again.

### Regenerating it

```bash
npm run build:map
```

This builds every size (`earth` and `earth-1500`) in a few seconds. It stops with an
error if any river ends up touching another river or the sea only at a corner.

The first run downloads the elevation data (about 50 MB) into `data/raw/etopo1-5min.asc`,
and the Natural Earth lakes and rivers (under 1 MB each) into `data/raw/ne_50m_*.geojson`.
If the download fails, get it by hand from
[this NOAA ERDDAP link](https://coastwatch.pfeg.noaa.gov/erddap/griddap/etopo180.esriAscii?altitude%5B(-90):5:(90)%5D%5B(-180):5:(180)%5D)
(ETOPO1 Ice Surface, every 5th arc-minute, "ESRI ASCII" format) and save it under that name.

### Data sources

- Coastlines and Greenland: [Natural Earth](https://www.naturalearthdata.com/) 1:10m
  (the 2000 map) and 1:50m (the 1500 map), public domain, via the `world-atlas` package.
- Lakes and rivers: [Natural Earth](https://www.naturalearthdata.com/) 1:50m "Lakes" and
  "Rivers + lake centerlines" (public domain), version 5.1.2, downloaded from the
  [natural-earth-vector](https://github.com/nvkelso/natural-earth-vector) repository.
- Elevation and sea depth: NOAA **ETOPO1** 1 Arc-Minute Global Relief Model, Ice Surface
  version (U.S. Government work, free to use and redistribute), served by NOAA's
  [ERDDAP](https://coastwatch.pfeg.noaa.gov/erddap/griddap/etopo180.html). Amante, C. and
  B. W. Eakins, *ETOPO1 1 Arc-Minute Global Relief Model: Procedures, Data Sources and
  Analysis*, NOAA Technical Memorandum NESDIS NGDC-24, 2009.
