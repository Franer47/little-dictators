import "@fontsource/cinzel/600.css";
import "@fontsource/cinzel/700.css";
import { loadMap } from "./map/gameMap.ts";
import { TERRAINS } from "./map/terrain.ts";
import { pixelToLonLat } from "./map/projection.ts";
import { Camera } from "./render/camera.ts";
import { tweenCamera } from "./render/cameraTween.ts";
import { MapRenderer } from "./render/mapRenderer.ts";
import { CameraControls } from "./input/cameraControls.ts";
import { chooseMap } from "./ui/startMenu.ts";
import { loadWheelData, type WheelData } from "./game/wheels.ts";
import { checkNumbers, checkStats, checkWeights, sampleNations } from "./game/devChecks.ts";
import { loadStatsData, type StatsData } from "./game/stats.ts";
import { rollNation } from "./game/roller.ts";
import { createRng } from "./game/random.ts";
import { runWheelScreen } from "./ui/wheel/wheelScreen.ts";
import { loadPlacementData, type PlacementData } from "./game/territory.ts";
import { Placement } from "./ui/placement.ts";
import { loadPref, savePref } from "./ui/prefs.ts";

async function main(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>("#map")!;
  const tileInfo = document.querySelector<HTMLDivElement>("#tile-info")!;
  // The map info and controls are folded away until the ⓘ button opens them (remembered).
  const hudToggle = document.querySelector<HTMLButtonElement>("#hud .hud-toggle")!;
  const hudMore = document.querySelector<HTMLDivElement>("#hud-more")!;
  let hudOpen = false;
  const setHudOpen = (open: boolean): void => {
    hudOpen = open;
    hudMore.hidden = !open;
    hudToggle.setAttribute("aria-expanded", String(open));
    hudToggle.title = open ? "Hide map info and controls" : "Show map info and controls";
  };
  setHudOpen(loadPref<boolean>("mapInfoOpen", false));
  hudToggle.addEventListener("click", () => {
    setHudOpen(!hudOpen);
    savePref("mapInfoOpen", hudOpen);
  });

  // Testing shortcuts in the address: ?map=earth-1500 skips the start screen (any name in
  // public/maps/ works), ?wheel=skip rolls the nation instantly, ?seed=123 fixes the rolls.
  const params = new URLSearchParams(location.search);
  const requested = params.get("map");
  const seedParam = params.get("seed");
  const seed = seedParam && /^\d+$/.test(seedParam) ? Number(seedParam) : undefined;

  // Which map to load: picked on the start screen, unless the address names one.
  const choice = requested && /^[\w-]+$/.test(requested) ? { name: requested, done: () => {} } : await chooseMap();
  const mapName = choice.name;
  const wheelsLoading = Promise.all([loadWheelData(), loadPlacementData()]);
  // The map loads in the background while the player spins the wheels.
  const startTime = performance.now();
  const mapLoading = loadMap(mapName);
  let wheels: WheelData;
  let placementData: PlacementData;
  let statsData: StatsData;
  try {
    [wheels, placementData] = await wheelsLoading;
    statsData = await loadStatsData(wheels);
  } catch (e) {
    showFatalError((e as Error).message);
    return;
  }
  // The intro: the start screen fades, the map fades in and slowly zooms toward the
  // centre, and the wheel screen swoops in on top. If the map is slow to load, the wheel
  // comes in anyway after a moment (over the start backdrop) so nobody waits on a blank screen.
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let wheelShown = false;
  let showWheel = (): void => {};
  const wheelCue = new Promise<void>((resolve) => (showWheel = resolve));
  const bringInWheel = (): void => {
    wheelShown = true;
    showWheel();
  };
  const slowMapTimer = window.setTimeout(bringInWheel, reducedMotion ? 300 : 1500);
  const skipWheel = params.get("wheel") === "skip";
  // The first nation's colour, shown on its card as its flag.
  const firstColor = Placement.firstColor(placementData);
  const nationReady = skipWheel
    ? Promise.resolve(rollNation(wheels, mapName, createRng(seed)))
    : runWheelScreen({ data: wheels, mapName, mapReady: mapLoading, seed, showWhen: wheelCue, color: firstColor });

  // Handy for poking at the game from the browser console while developing.
  // game.checkWeights() spins every wheel 100,000 times and compares the wins with the weights;
  // game.checkNumbers() rolls 10,000 nations and prints the spread of land, population and GDP;
  // game.sampleNations() prints a few whole rolled nations (see src/game/devChecks.ts);
  // game.checkStats() prints the spread of every stat over the nations on the map (Fill first).
  const debug: Record<string, unknown> = {
    wheels,
    statsData,
    checkWeights: () => checkWeights(wheels),
    checkNumbers: (nations?: number) => checkNumbers(wheels, nations),
    sampleNations: (count?: number) => sampleNations(wheels, count),
  };
  if (import.meta.env.DEV) Object.assign(window, { game: debug });

  const map = await mapLoading;
  const loadedTime = performance.now();
  const camera = new Camera(map.width, map.height, map.wraps);
  const renderer = new MapRenderer(canvas, map, camera);
  Object.assign(debug, { map, camera, renderer });

  // Only redraw when something changed, instead of every frame.
  let needsRender = true;
  const requestRender = (): void => {
    needsRender = true;
  };
  const frame = (): void => {
    if (needsRender) {
      renderer.render();
      needsRender = false;
    }
    requestAnimationFrame(frame);
  };

  const pixelUnder = (sx: number, sy: number): [number, number] | null => {
    // On a wrapping map the point may be on a copy left/right of the real map; normalize finds the real pixel.
    const [mx, my] = camera.screenToMap(sx, sy);
    return map.normalize(Math.floor(mx), Math.floor(my));
  };

  // Placing nations on the map (made once the map is ready, below).
  let placement: Placement | null = null;

  const describe = (x: number, y: number): string => {
    const terrain = TERRAINS[map.terrainAt(x, y)];
    const [lon, lat] = pixelToLonLat(map.meta, x + 0.5, y + 0.5);
    const ns = lat >= 0 ? "N" : "S";
    const ew = lon >= 0 ? "E" : "W";
    const metres = map.elevationAt(x, y);
    // Water below sea level shows its depth; rivers and lakes above sea level show their height.
    const height =
      terrain.isWater && metres < 0
        ? `${(-metres).toLocaleString("en-US")} m deep`
        : `${metres.toLocaleString("en-US")} m${terrain.isWater ? " above sea level" : ""}`;
    const owner = placement?.ownerName(x, y);
    return `${owner ? `${owner} · ` : ""}${terrain.name} · ${height} · (${x}, ${y}) · ${Math.abs(lat).toFixed(1)}°${ns} ${Math.abs(lon).toFixed(1)}°${ew}`;
  };

  // Last mouse position, so the hover info stays right when the map moves under a still mouse (e.g. holding D).
  let pointer: [number, number] | null = null;
  const updateHover = (): void => {
    renderer.hovered = pointer ? pixelUnder(...pointer) : null;
    placement?.hover(renderer.hovered);
    tileInfo.textContent = renderer.hovered ? describe(...renderer.hovered) : "Hover the map";
    requestRender();
  };

  const controls = new CameraControls(canvas, camera, {
    onChange: updateHover,
    onHover: (sx, sy) => {
      pointer = [sx, sy];
      updateHover();
    },
    onClick: (sx, sy) => {
      const p = pixelUnder(sx, sy);
      if (!p) return;
      if (placement) placement.click(...p, sx, sy);
      else console.log("Clicked", describe(...p));
      updateHover();
    },
    onFit: () => {
      camera.fitToMap();
      updateHover();
    },
  });
  canvas.addEventListener("pointerleave", () => {
    pointer = null;
    updateHover();
  });

  window.addEventListener("resize", () => {
    renderer.resize();
    requestRender();
  });

  renderer.resize();
  camera.fitToMap();
  renderer.render();
  needsRender = false;
  if (import.meta.env.DEV) {
    const ms = (t: number): string => `${Math.round(t)} ms`;
    console.log(
      `Map "${mapName}" (${map.width}x${map.height}): loaded in ${ms(loadedTime - startTime)}, ` +
        `painted + first draw in ${ms(performance.now() - loadedTime)}`,
    );
  }
  requestAnimationFrame(frame);
  // Nation names on the map use Cinzel: draw again once the font has loaded.
  void document.fonts.load('700 16px "Cinzel"').then(requestRender);

  // The map waits behind the wheel screen until the nation is made.
  controls.enabled = false;
  window.clearTimeout(slowMapTimer);
  choice.done();
  const fit = { x: camera.x, y: camera.y, zoom: camera.zoom };
  if (skipWheel || reducedMotion) {
    if (!wheelShown) bringInWheel();
  } else {
    // Zoom in toward the centre; the wheel arrives partway through.
    tweenCamera(camera, { x: fit.x, y: fit.y, zoom: fit.zoom * 1.9 }, 2400, requestRender);
    if (!wheelShown) window.setTimeout(bringInWheel, 1000);
  }
  const nation = await nationReady;
  document.querySelector<HTMLDivElement>("#hud")!.hidden = false;
  // Then fly to Europe and place it (src/ui/placement.ts).
  placement = new Placement({
    map,
    mapName,
    camera,
    renderer,
    controls,
    requestRender,
    wheels,
    data: placementData,
    stats: statsData,
    seed,
    skipWheel,
    reducedMotion,
  });
  placement.begin(nation, firstColor);
  Object.assign(debug, {
    nation,
    placement,
    checkStats: () => checkStats(placement!.nations, placement!.sheets, placement!.statsMs),
    /** The stat sheet of nation `id` (1 = the first placed). */
    sheet: (id: number) => placement!.sheets[id - 1],
  });
}

/** Shows an error the player can read, e.g. a mistake in a data file. */
function showFatalError(message: string): void {
  const box = document.createElement("div");
  box.id = "fatal-error";
  box.textContent = message;
  document.body.append(box);
  console.error(message);
}

main();
