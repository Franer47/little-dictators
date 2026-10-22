// What the running world shows on the map besides land and flags: crossed swords at the middle
// of every war's front (bigger and red when your nation is in it), and buildings where they
// stand (when zoomed in; ones still being built are faded).

import type { MapOverlay, MapView } from "./mapRenderer.ts";
import { icon } from "../ui/icons.ts";

export interface WarMark {
  x: number;
  y: number;
  mine: boolean;
}

/** A war being planned: where the planner masses its troops, in its colour. */
export interface PlanMark {
  x: number;
  y: number;
  color: string;
  /** Aimed at you (or yours): drawn bigger. */
  mine: boolean;
}

export interface BuildingMark {
  x: number;
  y: number;
  /** Icon name (src/ui/icons.ts). */
  icon: string;
  /** Still being built. */
  building: boolean;
  mine: boolean;
}

/** Buildings show from this zoom (CSS pixels per map pixel). */
const BUILDING_ZOOM = 6;

export class WorldLayer implements MapOverlay {
  wars: WarMark[] = [];
  plans: PlanMark[] = [];
  buildings: BuildingMark[] = [];
  visible = true;
  /** Icons drawn once into images, by "name:colour". */
  private images = new Map<string, HTMLImageElement>();

  /** "buildings" draws under the army flags, "wars" (the swords) over them. */
  constructor(
    private requestRender: () => void,
    private what: "buildings" | "wars",
  ) {}

  private image(name: string, color: string): HTMLImageElement | null {
    const key = `${name}:${color}`;
    let img = this.images.get(key);
    if (!img) {
      const svg = icon(name).replace("<svg ", `<svg xmlns="http://www.w3.org/2000/svg" style="color:${color}" `).replace(/currentColor/g, color);
      img = new Image();
      img.onload = this.requestRender;
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
      this.images.set(key, img);
    }
    return img.complete && img.naturalWidth ? img : null;
  }

  draw(ctx: CanvasRenderingContext2D, v: MapView): void {
    if (!this.visible) return;
    const zoom = v.scale / v.dpr;
    const u = v.dpr;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const onScreen = (x: number, y: number, k: number): [number, number] | null => {
      const sx = v.offsetX + (x + 0.5 + k * v.mapWidth) * v.scale;
      const sy = v.offsetY + (y + 0.5) * v.scale;
      return sx < -30 * u || sx > v.screenWidth + 30 * u || sy < -30 * u || sy > v.screenHeight + 30 * u ? null : [sx, sy];
    };
    // Buildings (this layer sits under the army flags).
    if (this.what === "buildings" && zoom >= BUILDING_ZOOM) {
      const size = Math.min(22, 8 + zoom) * u;
      for (const b of this.buildings) {
        const img = this.image(b.icon, b.mine ? "#f0d48a" : "#f1e8d4");
        if (!img) continue;
        for (const k of v.copies) {
          const p = onScreen(b.x, b.y, k);
          if (!p) continue;
          ctx.globalAlpha = b.building ? 0.45 : 0.95;
          ctx.fillStyle = "rgba(20, 17, 13, 0.75)";
          ctx.beginPath();
          ctx.arc(p[0], p[1], size * 0.62, 0, Math.PI * 2);
          ctx.fill();
          ctx.drawImage(img, p[0] - size / 2, p[1] - size / 2, size, size);
        }
      }
      ctx.globalAlpha = 1;
    }
    // Planned wars: a dashed ring that turns slowly, with a flag in the planner's colour.
    if (this.what === "wars") {
      const spin = performance.now() / 900;
      for (const p of this.plans) {
        const img = this.image("flag", "#f1e8d4");
        const r = (p.mine ? 15 : 10) * u;
        for (const k of v.copies) {
          const s = onScreen(p.x, p.y, k);
          if (!s) continue;
          ctx.fillStyle = "rgba(20, 17, 13, 0.7)";
          ctx.beginPath();
          ctx.arc(s[0], s[1], r * 0.8, 0, Math.PI * 2);
          ctx.fill();
          ctx.setLineDash([4 * u, 3 * u]);
          ctx.lineDashOffset = -spin * 10 * u;
          ctx.lineWidth = (p.mine ? 2.4 : 1.6) * u;
          ctx.strokeStyle = p.color;
          ctx.beginPath();
          ctx.arc(s[0], s[1], r, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
          if (img) ctx.drawImage(img, s[0] - r * 0.55, s[1] - r * 0.55, r * 1.1, r * 1.1);
        }
      }
    }
    // Swords on war fronts, at every zoom.
    const pulse = 0.85 + 0.15 * Math.sin(performance.now() / 300);
    for (const w of this.what === "wars" ? this.wars : []) {
      const img = this.image("swords", w.mine ? "#ffd2c6" : "#f1e8d4");
      if (!img) continue;
      const size = (w.mine ? 20 : 13) * u * (w.mine ? pulse : 1);
      for (const k of v.copies) {
        const p = onScreen(w.x, w.y, k);
        if (!p) continue;
        ctx.fillStyle = w.mine ? "rgba(190, 40, 30, 0.9)" : "rgba(120, 30, 24, 0.75)";
        ctx.beginPath();
        ctx.arc(p[0], p[1], size * 0.72, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = 1.2 * u;
        ctx.strokeStyle = w.mine ? "#ffd84a" : "rgba(10, 8, 6, 0.8)";
        ctx.stroke();
        ctx.drawImage(img, p[0] - size / 2, p[1] - size / 2, size, size);
      }
    }
    ctx.restore();
    // Your own wars pulse: keep drawing while there are any.
    if (this.what === "wars" && (this.wars.some((w) => w.mine) || this.plans.length)) requestAnimationFrame(() => this.requestRender());
  }
}
