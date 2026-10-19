# Little Dictators

A browser game where you spin wheels to create nations on a pixel map of the world,
then watch (and nudge) them grow, ally and fight. See [DESIGN.md](DESIGN.md) for the plan.

## Running it

You need [Node.js](https://nodejs.org) (LTS).

```bash
npm install      # once, downloads the tools
npm run dev      # starts the game at http://localhost:5173
```

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

To look at the smaller one, add `?map=earth-1500` to the address, e.g.
<http://localhost:5173/?map=earth-1500>. (Any map in `public/maps/` works this way.)

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
