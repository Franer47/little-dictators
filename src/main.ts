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
  const camera = new Camera(map.width, map.height);
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
    const [mx, my] = camera.screenToMap(sx, sy);
    const x = Math.floor(mx);
    const y = Math.floor(my);
    return map.inBounds(x, y) ? [x, y] : null;
  };

  const describe = (x: number, y: number): string => {
    const terrain = TERRAINS[map.terrainAt(x, y)];
    const [lon, lat] = pixelToLonLat(map.meta, x + 0.5, y + 0.5);
    const ns = lat >= 0 ? "N" : "S";
    const ew = lon >= 0 ? "E" : "W";
    return `${terrain.name} · (${x}, ${y}) · ${Math.abs(lat).toFixed(1)}°${ns} ${Math.abs(lon).toFixed(1)}°${ew}`;
  };

  new CameraControls(canvas, camera, {
    onChange: requestRender,
    onHover: (sx, sy) => {
      renderer.hovered = pixelUnder(sx, sy);
      tileInfo.textContent = renderer.hovered ? describe(...renderer.hovered) : "Hover the map";
      requestRender();
    },
    onClick: (sx, sy) => {
      const p = pixelUnder(sx, sy);
      if (p) console.log("Clicked", describe(...p));
    },
    onFit: () => {
      camera.fitToMap();
      requestRender();
    },
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
