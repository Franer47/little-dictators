import { loadMap } from "./map/gameMap.ts";
import { TERRAINS } from "./map/terrain.ts";
import { pixelToLonLat } from "./map/projection.ts";
import { Camera } from "./render/camera.ts";
import { tweenCamera } from "./render/cameraTween.ts";
import { MapRenderer } from "./render/mapRenderer.ts";
import { CameraControls } from "./input/cameraControls.ts";
import { chooseMap } from "./ui/startMenu.ts";
import { loadWheelData, type WheelData } from "./game/wheels.ts";
import { checkNumbers, checkWeights, sampleNations } from "./game/devChecks.ts";
import { rollNation } from "./game/roller.ts";
import { createRng } from "./game/random.ts";
import { runWheelScreen } from "./ui/wheel/wheelScreen.ts";
import { showNationPanel } from "./ui/nationPanel.ts";

async function main(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>("#map")!;
  const tileInfo = document.querySelector<HTMLDivElement>("#tile-info")!;

  // Testing shortcuts in the address: ?map=earth-1500 skips the start screen (any name in
  // public/maps/ works), ?wheel=skip rolls the nation instantly, ?seed=123 fixes the rolls.
  const params = new URLSearchParams(location.search);
  const requested = params.get("map");
  const seedParam = params.get("seed");
  const seed = seedParam && /^\d+$/.test(seedParam) ? Number(seedParam) : undefined;

  // Which map to load: picked on the start screen, unless the address names one.
  const choice = requested && /^[\w-]+$/.test(requested) ? { name: requested, done: () => {} } : await chooseMap();
  const mapName = choice.name;
  const wheelsLoading = loadWheelData();
  // The map loads in the background while the player spins the wheels.
  const startTime = performance.now();
  const mapLoading = loadMap(mapName);
  let wheels: WheelData;
  try {
    wheels = await wheelsLoading;
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
  const nationReady = skipWheel
    ? Promise.resolve(rollNation(wheels, mapName, createRng(seed)))
    : runWheelScreen({ data: wheels, mapName, mapReady: mapLoading, seed, showWhen: wheelCue });

  // Handy for poking at the game from the browser console while developing.
  // game.checkWeights() spins every wheel 100,000 times and compares the wins with the weights;
  // game.checkNumbers() rolls 10,000 nations and prints the spread of land, population and GDP;
  // game.sampleNations() prints a few whole rolled nations (see src/game/devChecks.ts).
  const debug: Record<string, unknown> = {
    wheels,
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
    return `${terrain.name} · ${height} · (${x}, ${y}) · ${Math.abs(lat).toFixed(1)}°${ns} ${Math.abs(lon).toFixed(1)}°${ew}`;
  };

  // Last mouse position, so the hover info stays right when the map moves under a still mouse (e.g. holding D).
  let pointer: [number, number] | null = null;
  const updateHover = (): void => {
    renderer.hovered = pointer ? pixelUnder(...pointer) : null;
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
      if (p) console.log("Clicked", describe(...p));
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
  // Back out to the whole map.
  const home = (): void => {
    camera.fitToMap();
    requestRender();
  };
  if (reducedMotion) home();
  else await tweenCamera(camera, { x: camera.x, y: camera.y, zoom: camera.minZoom }, 1100, requestRender).done.then(home);
  controls.enabled = true;
  document.querySelector<HTMLDivElement>("#hud")!.hidden = false;
  showNationPanel(nation, wheels);
  debug.nation = nation;
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
