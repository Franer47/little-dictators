// Confetti bursts on a see-through canvas over the whole screen. In pixel mode the bits
// are square, snap to a pixel grid and don't twirl, to match the retro wheel.

interface Bit {
  x: number;
  y: number;
  vx: number;
  vy: number;
  spin: number;
  turn: number;
  size: number;
  color: string;
  life: number;
}

export class Confetti {
  readonly canvas = document.createElement("canvas");
  private ctx: CanvasRenderingContext2D;
  private bits: Bit[] = [];
  private running = false;
  private last = 0;
  private pixel = 1;

  constructor() {
    this.canvas.className = "confetti";
    this.ctx = this.canvas.getContext("2d")!;
  }

  /**
   * Throws a burst from (x, y) in screen pixels. `pixel` > 0 = retro mode with that
   * pixel size. `direction` is the main throw angle in radians (default: up).
   */
  burst(x: number, y: number, colors: string[], opts: { count?: number; pixel?: number; direction?: number; spread?: number; power?: number } = {}): void {
    const { count = 120, pixel = 0, direction = -Math.PI / 2, spread = Math.PI * 0.9, power = 1 } = opts;
    this.pixel = pixel;
    for (let i = 0; i < count; i++) {
      const a = direction + (Math.random() - 0.5) * spread;
      const v = (250 + Math.random() * 650) * power;
      this.bits.push({
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        spin: Math.random() * Math.PI * 2,
        turn: (Math.random() - 0.5) * 16,
        size: pixel ? pixel * (Math.random() < 0.3 ? 2 : 1) : 6 + Math.random() * 7,
        color: colors[Math.floor(Math.random() * colors.length)],
        life: 1.6 + Math.random() * 1.6,
      });
    }
    if (!this.running) {
      this.running = true;
      this.last = performance.now();
      requestAnimationFrame(this.frame);
    }
  }

  clear(): void {
    this.bits = [];
  }

  private frame = (now: number): void => {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    this.bits = this.bits.filter((b) => (b.life -= dt) > 0 && b.y < h + 40);
    for (const b of this.bits) {
      b.vy += 900 * dt;
      b.vx *= Math.exp(-dt * 2.2);
      b.vy *= Math.exp(-dt * 1.2);
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.spin += b.turn * dt;
      ctx.globalAlpha = Math.min(1, b.life * 2);
      ctx.fillStyle = b.color;
      if (this.pixel) {
        const p = this.pixel;
        ctx.fillRect(Math.round(b.x / p) * p, Math.round(b.y / p) * p, b.size, b.size);
      } else {
        // A paper strip seen turning in the air: its width swings with cos(spin).
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.spin * 0.6);
        ctx.fillRect(-b.size / 2, (-b.size / 4) * Math.abs(Math.cos(b.spin)), b.size, (b.size / 2) * Math.abs(Math.cos(b.spin)) + 1);
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
    if (this.bits.length) requestAnimationFrame(this.frame);
    else {
      this.running = false;
      ctx.clearRect(0, 0, w, h);
    }
  };
}
