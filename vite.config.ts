import { defineConfig } from "vite";

// The game is served from "/" by the dev server, and from a sub-folder on GitHub Pages
// (https://<user>.github.io/little-dictators/). The publish job sets BASE_PATH for that;
// game code puts import.meta.env.BASE_URL in front of every file it loads.
export default defineConfig({
  base: process.env.BASE_PATH || "/",
});
