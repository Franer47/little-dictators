import { loadMap } from "./map/gameMap.ts";
import { TERRAINS } from "./map/terrain.ts";
import { pixelToLonLat } from "./map/projection.ts";
import { Camera } from "./render/camera.ts";
import { MapRenderer } from "./render/mapRenderer.ts";
import { CameraControls } from "./input/cameraControls.ts";
import { chooseMap } from "./ui/startMenu.ts";
import { exactWheel, loadWheelData, simulateSpins, type WheelData } from "./game/wheels.ts";
import { rollNation } from "./game/nation.ts";
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
  choice.done();
  const nationReady =
    params.get("wheel") === "skip"
      ? Promise.resolve(rollNation(wheels, mapName, createRng(seed)))
      : runWheelScreen({ data: wheels, mapName, mapReady: mapLoading, seed });

  // Handy for poking at the game from the browser console while developing.
  // game.checkWeights() spins every wheel 100,000 times and compares the wins with the weights.
  const debug: Record<string, unknown> = { wheels, checkWeights: () => checkWeights(wheels) };
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
  const nation = await nationReady;
  controls.enabled = true;
  document.querySelector<HTMLDivElement>("#hud")!.hidden = false;
  showNationPanel(nation, wheels);
  debug.nation = nation;
}

/** Dev check that spins land as often as their weights say (see game.checkWeights above). */
function checkWeights(data: WheelData): Record<string, ReturnType<typeof simulateSpins>> {
  const rng = createRng();
  const results: Record<string, ReturnType<typeof simulateSpins>> = {};
  for (const wheel of data.wheels) {
    console.log(`${wheel.name} (100,000 spins):`);
    results[wheel.id] = simulateSpins(wheel, rng);
    console.table(results[wheel.id]);
    if (wheel.estimate) {
      // Also the exact-number wheel that follows its first slice.
      const exact = exactWheel(wheel, wheel.slices[0], data);
      console.log(`${wheel.name}, exact numbers for ${wheel.slices[0].shown}:`);
      results[exact.id] = simulateSpins(exact, rng);
      console.table(results[exact.id]);
    }
  }
  return results;
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
