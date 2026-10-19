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
| Fit whole map | F |

## Project layout

```
src/
  main.ts                 starts the game
  map/terrain.ts          terrain types and their colours
  map/projection.ts       turns longitude/latitude into map pixels
  map/gameMap.ts          loads a map into a grid of terrain values
  render/camera.ts        where the camera looks and how far it's zoomed
  render/mapRenderer.ts   draws the map on screen
  input/cameraControls.ts mouse + keyboard camera controls
scripts/
  build-earth-map.ts      generates public/maps/earth.png from real-world data
public/maps/              map images (one colour per terrain type) + metadata
```

To regenerate the Earth map: `npm run build:map`.

Map data: [Natural Earth](https://www.naturalearthdata.com/) (public domain), via the `world-atlas` package.
