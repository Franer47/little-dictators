# Changelog

Every change that goes to GitHub gets a short entry here, newest first, in plain
English. Add your entry under **Unreleased** in the same pull request as the change.

## Unreleased

### Added
- **The other nations come alive.** They plan wars where you can see them (troops massing on
  the border, a ring on the map, a letter if it's you, a countdown under Threats in the Wars
  panel), raise bigger armies when at war, planning one or threatened, and band together in
  **coalitions** against nations with too much **infamy** (from wars and conquest) or far
  stronger than their neighbours. Unstable nations can suffer **revolts**: a region breaks
  away as a new, freshly rolled nation and fights a War of Independence.
- **The map comes alive between months.** Conquered land creeps in through the whole month
  and glows in its new owner's colour; battles flash with sparks and smoke, with a bar for
  who's winning and the losses floating up; armies lunge at each other; ripples mark wars
  declared, peace signed, nations fallen and your buildings finished. The top strip's numbers
  count to their new values, and a thin bar under the date shows how far through the month
  it is.
- **Armies and fronts, like Victoria 3.** Divisions are grouped into a few armies, each one
  token on the map (flag, divisions, a strength bar, its stance) instead of hundreds of little
  flags. Armies go to a front (the border with one enemy) or stay home, and Attack, Hold or
  Defend. Your nation commands them itself; give an army an order to command it yourself, and
  Give back to hand it back. New divisions wait in a Reserve at the capital while they train.
  Only your armies and your enemies' show on the map (tick "Show every nation's armies" for
  all), and armies march to where they're sent.
- **Queues:** order 1, 5, 25 or 100 divisions at once from the Army section. They wait in a
  queue and your nation raises up to 4 a month whenever it has the men, the money and the
  calm. Buildings you can't start yet (short of money, or two already being built) go into a
  queue too and start by themselves later. Both queues can be cleared for your influence back.
- **Conquered land keeps what's on it:** its people (the same share as of the land) and the
  buildings standing there move to the winner; taking a whole nation also takes its treasury.
- **The game runs!** Press ▶ (or Space) and time goes by, month by month, at three speeds
  (about six hours from 1500 to 2000). Nations grow, earn and spend money, build, raise
  armies, like and dislike their neighbours, make alliances, go to war and sign peace:
  winners take border land or tribute, and nations can fall. A news feed tells you what's
  happening.
- **Guide your nation with influence.** You earn influence every month and spend it to push
  your nation: build one of eight buildings (Farm, Market, Workshop, Fort, Barracks, Port,
  School, Temple, five levels each), raise divisions, improve or worsen relations, ally,
  declare war or offer peace (right-click any nation). Your nation can say no, and says why.
- **Brushes:** paint the land you want (War goal), the land to guard (Defend) and the land to
  grow (Develop) right on the map.
- **Development** now rises slowly over time, faster with schools.
- **Saving:** the game saves itself every year; the start screen offers Continue.
- If your nation falls, keep watching or pick another nation to guide.
- **Wars on the map:** crossed swords mark every war front, and armies at war stand on the
  border with their enemy. Buildings appear on the map where they were built.
- **Letters:** a war declared on you or a peace you sign pops up and pauses the game.
- **Conquest pixel by pixel:** in a war the stronger side pushes the border into the
  enemy's land every month, and you can watch it creep. Mountains, highlands, rivers and
  crossing the sea slow it down, Defend paint makes land harder to take, and War goal paint is
  taken first. Conquered land is yours at once; peace adds tribute (or a whole small nation).
  Your armies keep conquering until you make peace. News says who a fallen nation fell to.
- **Winning pays:** when you're winning a war you decide when it ends, and the bigger the win
  the more land you take (up to 60%, or a whole small nation). The Wars panel shows what
  peace now would give, your recent treaties, and the Wars button counts your wars. Fixed:
  beating a nation spread over islands only took the bit touching you; allies of the winner
  now get tribute too.
- **How to play:** a short guide the first time you play (and from the How to button).

### Changed
- Wars are now fought by the armies on each front: a side pushes in only where its attacking
  armies beat the other's defence; a front with no army is held by militia. Worn-down
  divisions merge back into full ones.
- The "Bigger division" button is gone (divisions now merge by themselves).
- A division now costs ✦1 influence instead of ✦4.
- **The map info is folded away.** What's under the mouse (terrain, height, position) and
  the controls now hide behind the ⓘ button in the bottom-left corner; click it to show them.
- **First round of stat tuning:** every government, ideology, history, trait, wealth level,
  resource, land type and the stability/popularity effects got at least one change, from the
  owner's notes (e.g. Elected Monarchy +10 stability and popularity, Feudal Monarchy +20%
  recruits, Monastic State +25 stability, Peace-loving +25 defence, Satanism much better at war)
  plus small additions in the same spirit. Nothing was taken away. Nations are a bit more
  stable and developed on average.
- **A spreadsheet of what everything gives:** every government, ideology, history, trait,
  wealth level and resource, and what it does to each number, in one Excel workbook you
  can edit; a script puts your changes back into the game.
- **Every click does something:** click a stat to keep its breakdown open (with a close
  button); buttons and rows dip and light up while pressed. Stat icons now have colours
  that mean something (money gold, people green, military red, sea blue; stability and the
  like from red to green by how good they are), hop when you point at them, and pulse when
  something's wrong.
- **A look in the spirit of Victoria 3:** dark ink panels with thin gold frames, cream text,
  gold buttons and classical capitals (the Cinzel font) for names and headings, on the map
  too; small icons for every stat, coloured meters for the 0–100 scores, green and red for
  going up and down. The stats and the nation's card in the bottom-right corner are now the
  same width.
- **Fairer nation sizes north and south.** The biggest-looking nations were all in Europe
  and the far north because the flat map stretches land away from the equator (a pixel in
  Europe covers about half the km² of one in Africa). A nation's land is now scaled
  halfway for where it starts, so an equal roll up north looks about 1.1–1.6× as big as one
  near the equator instead of 1.3–2.3×. The panel still shows the real km² it got.
- **Nations go anywhere in the world now, not just Europe.** Place your own nation
  anywhere on Earth (except Antarctica), then keep making nations yourself or press
  **Fill the world**: about 900–1,000 nations in about 3 seconds, and you can watch the
  map fill up. Every piece of land ends up owned. Fill picks each nation's spot first
  and then rolls a land size that fits the free land there, so islands get small nations
  and the middle of a continent, settled late, still gets big ones. New nations stop at
  95% of the land and in gaps under 60,000 km²; the neighbours take the rest, so the
  gaps don't fill up with clusters of tiny nations, and Fill leaves City-state and Tiny
  off its nations' land wheel (yours keeps them): dot-sized nations went from 60–80 per
  world to 4–17. (The Europe test is still in
  `public/data/placement.json`.)
- **Mountains, highlands and rivers are much harder to cross** (mountains 15× plains
  instead of 6×, highlands 3.5×, snow 4×, rivers 40×), so nations settle open land
  first instead of pushing straight through mountain ranges.
- **Land sizes are more balanced.** Big lands are rarer (360,000 km² or more: 20% → 12%
  of rolls; 535,000 or more: 10% → 5%) and so are the tiniest (under 25,000 km²: 18% →
  10%), so most nations are modest to large (60,000–360,000 km²: 49% → 64%).
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
- **Nations next to branching rivers (like the Nile delta) stopped growing far too early**,
  sometimes ending with a few hundred km² of a 160,000 km² roll. The clean-up after growing
  cut 1-pixel "necks" even where the land crossed a river, and threw away everything on the
  other side. Now a neck is only cut when what falls off is small, and land joined at a
  corner still counts as joined. Tested on 300 random spots: no nation loses more than 10%.
- **Buttons that are switched on (the chosen style, Skip animation) are easy to read again.**
  Their text was light on the yellow; it's now dark with a thin light outline, in both styles.
- **"Reveal nation" froze the game in the Retro style.** When the wheel hid behind the
  finished nation card its size became zero, and the retro label sizing then looped
  forever. A hidden wheel now keeps its size, and the label sizing always stops.

### Added
- **A stat sheet for every nation.** Click any nation (yours or one of Fill's) and the
  corner panel shows its numbers: manpower, army, army quality and aggression; GDP,
  income, upkeep, net income and treasury; population, growth, food, stability and
  popularity; land, coast, defence, trade, naval reach and cohesion. They come from the
  wheel results *and* the land it actually got: mountains make it hard to invade but feed
  few people, coasts and rivers help food, trade and ships, islands scattered over the sea
  are hard to hold together. Point at any stat to see where the number comes from. All the
  numbers are in `public/data/eras/1500-stats.json`, so they're easy to tune. They don't
  change over time yet (that comes with the clock).
- **Your nation's numbers in a strip across the top:** treasury and yearly gain or loss,
  population and growth, stability, popularity, army, development and what the people
  believe. Click the name to open your nation.
- **Armies on the map.** Every nation's army is split into divisions of 400 troops, each a
  little flag along its borders. Zoom in close to see them (nearby flags merge into one with
  the total, and dragging the map doesn't change how they're merged). Click a flag or the **Army** button to see a nation's divisions; for your own
  nation you can ask for a new division or a bigger one, and it agrees or refuses (not
  enough money, men or stability) and tells you why.
- **Nation names on the map**, written across each nation's land, tilted along it and sized
  to fit.
- **Ideology mix and development.** The people are now split between several ideologies
  (the rolled one is the biggest, more so in a stable nation), and every nation has a
  development level from 0 to 100.
- **Stability changes almost everything:** taxes, recruits, growth, farming, trade,
  cohesion, development and more go up when a nation is stable and down when it isn't.
- **Play it online.** The game is published to GitHub Pages at
  https://franer47.github.io/little-dictators/ and updates itself whenever something is
  merged into main, so friends can try it without installing anything.
- **Island nations can grow overseas.** A nation that starts on a small island no longer
  stops at its coast: its land can cross short stretches of sea (up to 8 sea pixels, and
  dear, so only when it runs out of room or the strait is short) to the next island or the
  mainland. A 150,000 km² roll on Corsica now takes Corsica, Sardinia and a piece of
  Tuscany instead of stopping at 8,000 km². The sea itself is never owned.
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
