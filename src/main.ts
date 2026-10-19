import { loadMap } from "./map/gameMap.ts";
import { TERRAINS } from "./map/terrain.ts";
import { pixelToLonLat } from "./map/projection.ts";
import { Camera } from "./render/camera.ts";
import { MapRenderer } from "./render/mapRenderer.ts";
import { CameraControls } from "./input/cameraControls.ts";

async function main(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>("#map")!;
  const tileInfo = document.querySelector<HTMLDivElement>("#tile-info")!;

  const map = await loadMap("earth");
  const camera = new Camera(map.width, map.height, map.wraps);
  const renderer = new MapRenderer(canvas, map, camera);

  // Handy for poking at the game from the browser console while developing.
  if (import.meta.env.DEV) Object.assign(window, { game: { map, camera, renderer } });

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
    const height = terrain.isWater ? `${(-metres).toLocaleString("en-US")} m deep` : `${metres.toLocaleString("en-US")} m`;
    return `${terrain.name} · ${height} · (${x}, ${y}) · ${Math.abs(lat).toFixed(1)}°${ns} ${Math.abs(lon).toFixed(1)}°${ew}`;
  };

  // Last mouse position, so the hover info stays right when the map moves under a still mouse (e.g. holding D).
  let pointer: [number, number] | null = null;
  const updateHover = (): void => {
    renderer.hovered = pointer ? pixelUnder(...pointer) : null;
    tileInfo.textContent = renderer.hovered ? describe(...renderer.hovered) : "Hover the map";
    requestRender();
  };

  new CameraControls(canvas, camera, {
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
  requestAnimationFrame(frame);
}

main();
