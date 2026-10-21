# Changelog

Every change that goes to GitHub gets a short entry here, newest first, in plain
English. Add your entry under **Unreleased** in the same pull request as the change.

## Unreleased

### Changed
- **The land wheel follows the map.** The more of Europe is taken, the rarer the big land
  sizes, and sizes bigger than the biggest free patch of land shrink or disappear, so a
  late nation no longer rolls "Vast" and then gets scraps. The land wheel shows how much
  is left: "Europe: 4.03M km² of land left · 48% already taken". In Fill Europe, nations
  getting less than half their roll went from about 25 per fill to 1–7.
- **No more dot-sized nations stuck inside big ones.** "Surprise me" and Fill Europe no
  longer start a nation in a gap smaller than 20,000 km², or in a pocket surrounded by
  just one nation; those bits go to the nations around them at the end of the fill.
  Fill now makes about 60–95 nations, with far fewer tiny ones.
- **Fewer snake-shaped nations.** "Surprise me" and Fill Europe now start nations on a
  coast or riverbank, so the water closes off one side and the land grows into a fuller
  shape instead of snaking out in every direction. The inland gaps left between them are
  filled by later nations. After growing, 1-pixel strings are trimmed and tiny holes
  inside a nation are filled. (Clicking by hand can still start a nation anywhere.)
- **Fill Europe now fills all of Europe** (65–100 nations) instead of stopping at 90%: it
  keeps going until no gap is left with room for another nation, then the leftover bits
  (small islands, slivers between borders) go to the nearest nations, which spread up to
  10 pixels at a time into them. Every piece of land in Europe is owned when it's done.
- **The nation list is short by default**: the top 3 nations by land plus yours (marked
  "You"), under "89 nations · 100% of Europe". The arrow opens the full list (biggest
  first) and closes it again; it remembers which you chose.

### Fixed
- **Buttons that are switched on (the chosen style, Skip animation) are easy to read again.**
  Their text was light on the yellow; it's now dark with a thin light outline, in both styles.
- **"Reveal nation" froze the game in the Retro style.** When the wheel hid behind the
  finished nation card its size became zero, and the retro label sizing then looped
  forever. A hidden wheel now keeps its size, and the label sizing always stops.

### Added
- **Placing nations on the map (Europe test).** After the wheel, click a spot in Europe
  (or press **Surprise me**) and the nation's land grows from there in a short
  animation: quickly over plains, slowly into mountains, stopping at the sea and at other
  nations, and often along rivers. Each pixel counts with its real area, so the land
  matches the rolled size; if a nation is boxed in, it stays smaller and shows both
  ("101,254 km² (rolled 240,000)"). **Next nation** makes another one.
- **Each nation has its own colour**, used as its flag for now (on the card and the
  corner panel) and drawn over its land with a darker border line.
- **A list of nations** in the top-right corner, with how much of Europe is owned. Click
  a row or a nation on the map to see it in the corner panel; hovering the map shows who
  owns the land.
- **Fill Europe** (testing shortcut) rolls and places nations at random until Europe is
  full, with colours chosen so touching nations never match; **Clear** starts over. The region, growth costs and colours are in
  `public/data/placement.json`.
- **The wheels are now set in 1500.** 11 spins: Government, Land size, Population
  density, Wealth, Bonus resources, Ideology, History, Stability, Popularity, a Bonus
  spin and a Golden spin, each
  with many more options than the beta, all fitting the time (kingdoms, sultanates,
  khanates, merchant republics… no juntas or communists).
- **Realistic, chained numbers**: land up to 535,000 km² (1.5× Germany), shown with a
  comparison ("≈ the size of Portugal"); population = land × density (0.5–60 people per
  km²); GDP = population × output per person ($900–3,100 a year, from Angus Maddison's
  estimates for 1500, in today's dollars). A big, dense, well-off nation comes out near
  France in 1500 (~15M people, ~$26B); a tiny empty one has a few thousand people.
- **3 bonus resources** per nation: the resource wheel is spun three times, with no
  repeats.
- **Rare pulls**: Government and Ideology each have a thin black slice with red edges
  (1.5%). Landing on it darkens the screen, turns the wheel's centre into a skull, plays
  a low rumble, and spins a dark wheel of 7 rare governments (Eternal Republic, Absolute
  Monarchy, Stratocracy, Necrocracy, Syndicalist Federation, Oligarchic Republic, Monastic
  State) or ideologies (Eternalism, Ultranationalism, Satanism, Syndicalism, Sacred
  Nation, Divine Imperialism, Apocalypticism). At most one per nation, so about 3% of
  nations get one.
- **The nation chart**: every result moves the nation's dot left (liberal, peaceful) or
  right (nationalist, tyrannical), and down (miserable) or up (a good life). Shown on the
  finished card and in the creation record.
- **Bonus spin** at the end: slices like "Seeks revenge", "Mandatory enlistment", "Open
  borders" or "Patron of the arts", bigger the nearer they are to the nation's dot.
- **Golden spin**: a golden chance wheel (bigger the closer the dot is to a corner, up to
  60%; about 1 nation in 14 wins), then a gold wheel. Half of it doubles land, people or
  wealth (and everything that follows from it, past any limit); half is 4 traits for the
  nation's corner ("A world police officer", "Ruthless to others"…).
- **Better names**, made from the government and ideology: each government has its own
  titles (Khanate of…, Most Serene Republic of…, Prince-Bishopric of…) and name styles
  (24 sets of syllables, from Latin and Norse to Arabic, Han and Andean), and the ideology
  sometimes adds a word ("Great…", "Holy…", "Iron…", "Kingdom of New…").
- **Spin the rest** button next to Skip animation: rolls every wheel that's left at once.
- **Hover a result** on the nation card or in the creation record to see its description
  and its odds (for the 3 bonus resources, each one's description). Works with the
  keyboard too (Tab).
- The nation card, corner panel and creation record show the results in groups
  (Power, Land & wealth, Story & bonuses); the finished card uses two columns.
- Dev checks in the browser console: `game.checkNumbers()` (spread of land, population,
  GDP, chart dots and golden chances over 10,000 rolled nations, and how often rare pulls
  and golden spins happen) and `game.sampleNations()`.

- **Wheel beta: create your nation.** After picking a map, spin one big wheel for
  Government, Land size, Population, GDP and Ideology. Land, population and GDP are spun
  twice: first a range (e.g. 70M–200M people), then a wheel of 10 numbers in that range
  for the exact number. Results fill a nation card; at the end the nation gets a random
  name (rename it or roll a new one), then you continue to the map, which loads in the
  background meanwhile. Cosmetic for now: the results don't affect the game yet.
- Two wheel looks to compare, switchable on the wheel screen and remembered:
  **Retro pixel** (chunky pixel wheel, pixel font, 8-bit blips) and **Game show**
  (bright slices, chasing lights, a flapper that ticks over pegs, confetti). Sound
  effects are made in the browser; a mute button and a "Skip animation" option.
- **Nation panel** in the bottom-right corner of the map: flag placeholder, name and key
  results. Click it for the **creation record**: every roll with its odds, the date, the
  map and the random seed.
- **Zoom into the map**: after Start, the start screen fades, the world fades in and
  slowly zooms toward the centre, and the wheel screen swoops in on top (the map stays
  faintly visible behind it). If the map is slow to load, the wheel comes in anyway.
  "Continue to map" eases the camera back out to the whole world. With reduced motion
  turned on in your system, it's a quick fade instead.
- **Easier-to-read retro style**: the clear Pixelify Sans pixel font at bigger sizes,
  calmer and darker slice colours with outlined white letters, short slice names on the
  wheel (the full name shows big when it lands), and the wheel comes to rest near the
  middle of the winning slice so its label sits level.
- Retro wheel labels are drawn as big as each slice allows (up to double size),
  run from near the centre out toward the rim, and have wider gaps between letters
  so they don't run together.
- All wheel slices, odds (weights), ranges, name parts and screen text live in
  `public/data/wheels.json`. Testing shortcuts `?wheel=skip` and `?seed=123`.
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
- **Bigger nations are possible.** Land size now goes up to 800,000 km² (about 2.25×
  Germany), with 3 new rare slices: Immense (535,000–620,000 km²), Colossal (–710,000) and
  Titanic (–800,000). Land odds are no longer equal: City-state 8%, Tiny 10%, Small 13%,
  Modest 16%, Medium 18%, Large 15%, Vast 10%, Immense 5%, Colossal 3%, Titanic 2%. The
  size comparison now also knows Ukraine, Myanmar, Texas and Turkey. On the wheel the land
  slices show a shorter label ("710K–800K"), so the thin rare slices stay readable; the full
  range with km² still shows when it lands.
- **Retro wheel slice labels are much easier to read.** They are now drawn sharp at full
  screen resolution in Pixelify Sans Bold (a pixel font made for legibility), white with
  a dark pixel outline, on top of the chunky pixel wheel. All labels on a wheel share one
  size where they can, so the wheel reads evenly. (Tried against VT323 and Silkscreen;
  see docs/retro-label-fonts.jpg.) The hand-made 5×7 pixel font is gone.
- Wheel data is split by era: `public/data/wheels.json` picks the era and holds the
  screen text, and `public/data/eras/1500.json` holds the 1500 wheels, number ranges
  (with notes on where they come from) and name parts. Culture and Religion wheels are
  in the file but switched off for now.
- Plain words on the wheels, so they're easy to understand ("Ideology", "Popularity",
  "Fanatical", "Very rich" instead of "Outlook", "Acceptance", "Zealous", "Opulent").
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
