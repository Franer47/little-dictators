# Changelog

Every change that goes to GitHub gets a short entry here, newest first, in plain
English. Add your entry under **Unreleased** in the same pull request as the change.

## Unreleased

### Added
- **Start screen** (alpha): pick which map to play on, Earth (2000 × 1111, the
  default) or Earth (small) (1500 × 833), then press Start.
- **Lakes and rivers** on the Earth map. Big lakes (the Great Lakes, Victoria,
  Baikal, Ladoga, Titicaca… 28 in all) are now water instead of land. 36 major
  rivers (Amazon, Nile, Mississippi, Volga, Danube, Yangtze…) are drawn as a new
  River terrain: a bright blue line 1 pixel wide with no diagonal gaps, running all
  the way to the sea. Hover shows "River". The list is in `scripts/earth-water.json`.
- Rivers always meet each other and the sea edge to edge, never only at a corner;
  `npm run build:map` now stops with an error if a corner-only link ever appears.
- Hovering a lake or river shows its height above sea level instead of a depth.
- This changelog.

### Changed
- **The Earth map is bigger: 2000 × 1111 pixels** (was 1500 × 833), with more
  detailed coastlines (Natural Earth 1:10m), so fjords, island chains and small
  islands come out sharper. It looks the same otherwise: same terrain, lakes,
  rivers (still 1 pixel wide), snow and Antarctica.
- The 1500 × 833 map is kept as a second map, `earth-1500`, which you can pick
  on the start screen. `npm run build:map` builds both.

### Design
- Wheel beta planned: 5 spins (Government, Land size, Population, GDP, Ideology),
  a nation card, a nation panel in the corner with the creation record, and two
  wheel styles (retro pixel, bold game show) to compare.
- Main map will grow to ~2000 px wide; the 1500 px map is kept as a second size
  for a future map-size option.
- Lakes and rivers planned: big lakes are ordinary water, major rivers are a thin
  River line. Later: rivers between nations belong to nobody, national waters
  that foreign armies can't enter without war/alliance/access, and digging canals.
- Forest biomes tried (PR #3) and dropped. The terrain list stays short.

## 2026-10-19

### Added
- **Real terrain** (PR #2): plains, highlands and mountains from NOAA ETOPO1
  elevation data, with OpenFront-style shading (green lowlands, tan highlands, white
  peaks, darker deep sea).
- **Antarctica** and **Greenland ice**. The map now runs from 84°N to the South Pole
  (Patterson projection).
- **Snow** terrain in the cold far north, following a hand-drawn tree line.
- Hover info shows height in metres, or depth over water.
- **East–west wrapping** (PR #1): keep scrolling and you come back around the
  world, like HOI4. You can't see past the top or bottom of the map.

### Changed
- Map is 1.5× bigger: 1500 × 833 pixels (was 1000 × 502).
- The F key zooms all the way out instead of "fit map".

### Removed
- The flat brown tundra band and the straight-line ice edge from the first map.

## 2026-10-18

### Added
- First playable version: a pixel map of the Earth built from Natural Earth
  coastlines.
- Camera: drag or WASD/arrow keys to move, mouse wheel or Q/E to zoom, F to see
  the whole map.
- Hover a pixel to see its terrain and its real latitude/longitude.
- DESIGN.md with the game plan.
