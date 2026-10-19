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
public/maps/              map files (see below)
data/raw/                 downloaded source data for the map builder (not committed)
```

## The Earth map

![The Earth map](docs/earth-map.jpg)

The map is 1500 × 833 pixels, from 84°N to the South Pole, in the
[Patterson projection](https://en.wikipedia.org/wiki/Patterson_projection) (it keeps
Europe and North America looking like the familiar Miller world map, but squeezes the
poles so Antarctica fits without a huge stretched strip). Each map is three files in
`public/maps/`:

| File | What it is |
|---|---|
| `earth.png` | The terrain **data**: one exact flat colour per terrain type (see `src/map/terrain.ts`). This is what the game logic reads, and what you'd edit to change the map. |
| `earth-height.png` | The **heightmap**, only used for the shaded look and the hover info. Each pixel's height is `red × 256 + green − 32768` metres (negative = below sea level). It's stored this way because browsers only read 8 bits per colour channel. |
| `earth.json` | Size, projection, latitude range, `wrapX`, and where the heightmap is. |

Terrain comes from real elevation (averaged over each pixel) and satellite land cover:

| Terrain | Rule |
|---|---|
| Ocean / Shallow water | Water; shallow if within 2 pixels of land |
| Plains | Land below 700 m |
| Highlands | Land from 700 m to 2000 m |
| Mountains | Land 2000 m and higher |
| Ice | Greenland, and all land south of 60°S (Antarctica) |
| Snow | The cold far north: plains and highlands beyond the Arctic tree line (tundra), e.g. northern Canada, Alaska, the Russian Arctic, Chukotka. Higher ground turns snowy further south. |
| Rainforest | Tropical rainforest: mostly evergreen broadleaf forest, within about 25° of the equator (Amazon, Congo, Southeast Asia, New Guinea) |
| Forest | Any other dense forest: the northern taiga (Canada, Scandinavia, Siberia) and dense temperate forest (e.g. the Appalachians, the Carpathians, the Pacific Northwest) |

When several apply, the first one wins: Ice, Mountains, Snow, Rainforest / Forest, then Highlands / Plains.

The thresholds are constants at the top of `scripts/build-earth-map.ts`. The Snow edge
follows a table of the real tree line's latitude around the globe (`TREE_LINE`): it's
far north in Norway (~70°N, warmed by the Gulf Stream) and far south around Hudson Bay
(~57°N). Every 140 m of height counts as one degree further north, and a little noise
keeps the edge from looking like a drawn line.

Forests come from NASA's MODIS land cover map (each map pixel covers about 20 of its
pixels). A pixel is forest if at least half of its land is forest, after averaging with its
neighbours; then patches of forest (or gaps in forest) smaller than 6 pixels are merged
into their surroundings so the map isn't speckled. Which land cover classes count:

| Land cover class | Becomes |
|---|---|
| Evergreen broadleaf forest | Rainforest within ~25° of the equator (the edge wiggles a little), Forest further out (e.g. Chile, Tasmania) |
| Evergreen / deciduous needleleaf, deciduous broadleaf, mixed forest | Forest |
| Woody savanna, north of 50°N | Forest: in the north these are the more open parts of the taiga (much of Finland, Sweden, Canada, Siberia), which the satellite calls savanna because the tree crowns cover less than 60% of the ground |
| Savanna, north of 50°N outside Europe | Forest, for the same reason (e.g. the larch forests of eastern Siberia). In Europe it stays open land: there it's farmland with hedges and scattered trees (most of Britain and Ireland) |
| Everything else (savanna and woody savanna further south, grass, shrubs, crops, wetlands, towns, desert) | Open land (Plains / Highlands by height) |

### Regenerating it

```bash
npm run build:map
```

The first run downloads the elevation data (about 50 MB) into `data/raw/etopo1-5min.asc`
and the land cover (about 2 MB) into `data/raw/modis-igbp-2024-7200x3600.png`.
If the download fails, get it by hand from
[this NOAA ERDDAP link](https://coastwatch.pfeg.noaa.gov/erddap/griddap/etopo180.esriAscii?altitude%5B(-90):5:(90)%5D%5B(-180):5:(180)%5D)
(ETOPO1 Ice Surface, every 5th arc-minute, "ESRI ASCII" format) and save it under that name. The land cover comes from
[this NASA GIBS link](https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=MODIS_Combined_L3_IGBP_Land_Cover_Type_Annual&STYLES=&CRS=EPSG:4326&BBOX=-90,-180,90,180&WIDTH=7200&HEIGHT=3600&FORMAT=image/png&TIME=2024-01-01).

### Data sources

- Coastlines and Greenland: [Natural Earth](https://www.naturalearthdata.com/) 1:50m
  (public domain), via the `world-atlas` package.
- Elevation and sea depth: NOAA **ETOPO1** 1 Arc-Minute Global Relief Model, Ice Surface
  version (U.S. Government work, free to use and redistribute), served by NOAA's
  [ERDDAP](https://coastwatch.pfeg.noaa.gov/erddap/griddap/etopo180.html). Amante, C. and
  B. W. Eakins, *ETOPO1 1 Arc-Minute Global Relief Model: Procedures, Data Sources and
  Analysis*, NOAA Technical Memorandum NESDIS NGDC-24, 2009.
- Forests: NASA **MODIS** Land Cover Type (MCD12Q1, Collection 6.1, IGBP classification),
  year 2024, as served by NASA's [GIBS](https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api)
  map service (layer `MODIS_Combined_L3_IGBP_Land_Cover_Type_Annual`, no login needed). NASA data
  is free to use and redistribute with no restrictions. Friedl, M., Sulla-Menashe, D., *MODIS/Terra+Aqua
  Land Cover Type Yearly L3 Global 500m SIN Grid V061*, NASA EOSDIS Land Processes DAAC, 2022.
