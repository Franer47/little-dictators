// Wheel sound effects, made on the fly with the Web Audio API (no sound files).
// Browsers only allow sound after the player clicks or presses a key, so nothing plays
// until unlock() has been called from one of those.

export type SoundStyle = "retro" | "gameshow";

// A pentatonic scale, so the retro wheel's blips make a little tune as it turns.
const RETRO_NOTES = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.51];

export class WheelSounds {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private lastTick = 0;

  constructor(public muted: boolean) {}

  /** Call from a click or key press: starts the audio engine if the browser allows it. */
  unlock(): void {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
      } catch {
        return;
      }
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.55;
      this.master.connect(this.ctx.destination);
      const len = Math.floor(this.ctx.sampleRate * 0.5);
      this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
  }

  private ready(): AudioContext | null {
    return this.muted || !this.ctx || this.ctx.state !== "running" ? null : this.ctx;
  }

  /** A note with a quick attack and a decay. */
  private tone(type: OscillatorType, freq: number, at: number, dur: number, vol: number, slideTo?: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, at + dur);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(vol, at + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(gain).connect(this.master!);
    osc.start(at);
    osc.stop(at + dur + 0.02);
  }

  /** A burst of filtered noise (clicks, whooshes, cymbals). */
  private noise(at: number, dur: number, vol: number, filter: BiquadFilterType, freq: number, q = 1, freqTo?: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.frequency.setValueAtTime(freq, at);
    if (freqTo) f.frequency.exponentialRampToValueAtTime(freqTo, at + dur);
    f.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(f).connect(gain).connect(this.master!);
    src.start(at, Math.random() * 0.3);
    src.stop(at + dur + 0.02);
  }

  /** The pointer passing a slice edge (retro) or a peg (game show). */
  tick(style: SoundStyle, slice: number, speed: number): void {
    const ctx = this.ready();
    if (!ctx) return;
    // Very fast spins would pass several ticks a frame; cap it so it stays a rattle, not a buzz.
    if (ctx.currentTime - this.lastTick < 0.035) return;
    this.lastTick = ctx.currentTime;
    const t = ctx.currentTime;
    const soft = Math.min(1, 0.55 + 4 / Math.max(1, speed));
    if (style === "retro") {
      this.tone("square", RETRO_NOTES[slice % RETRO_NOTES.length], t, 0.05, 0.09 * soft);
    } else {
      this.noise(t, 0.025, 0.55 * soft, "bandpass", 2600 + Math.random() * 600, 1.4);
      this.tone("triangle", 190, t, 0.04, 0.2 * soft, 120);
    }
  }

  spinStart(style: SoundStyle): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    if (style === "retro") {
      this.tone("square", 180, t, 0.18, 0.08, 900);
    } else {
      this.noise(t, 0.45, 0.35, "bandpass", 400, 0.8, 2400);
    }
  }

  /** The result: a jingle (retro) or a bell and a brass stab (game show). */
  win(style: SoundStyle): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    if (style === "retro") {
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone("square", f, t + i * 0.07, 0.09, 0.09));
      this.tone("square", 1046.5, t + 0.28, 0.35, 0.08);
      this.tone("triangle", 523.25, t + 0.28, 0.4, 0.18);
    } else {
      this.pop();
      for (const [ratio, vol] of [[1, 0.22], [2.4, 0.08], [3.9, 0.05]] as const) {
        this.tone("sine", 1318.5 * ratio, t + 0.05, 1.4, vol);
        this.tone("sine", 1318.5 * ratio, t + 0.22, 1.4, vol * 0.8);
      }
      for (const f of [523.25, 659.25, 783.99]) this.tone("sawtooth", f, t + 0.05, 0.5, 0.05);
    }
  }

  pop(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    this.tone("sine", 700, t, 0.1, 0.35, 140);
    this.noise(t, 0.05, 0.3, "highpass", 1500);
  }

  /** A result landing on the nation card. */
  thunk(style: SoundStyle): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    if (style === "retro") {
      this.tone("square", 392, t, 0.05, 0.07);
      this.tone("square", 784, t + 0.05, 0.08, 0.07);
    } else {
      this.tone("triangle", 260, t, 0.12, 0.3, 160);
      this.noise(t, 0.04, 0.2, "lowpass", 900);
    }
  }

  /** A button press. */
  click(style: SoundStyle): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    if (style === "retro") this.tone("square", 1200, t, 0.03, 0.05);
    else this.tone("triangle", 900, t, 0.05, 0.15, 600);
  }

  /** A rare pull: a low, sinking drone and a rumble (retro: a falling 8-bit groan). */
  doom(style: SoundStyle): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    if (style === "retro") {
      [220, 207.65, 196, 155.56].forEach((f, i) => this.tone("square", f, t + i * 0.22, i === 3 ? 0.9 : 0.2, 0.08, i === 3 ? 82.41 : undefined));
      this.tone("triangle", 55, t, 1.6, 0.25);
    } else {
      for (const f of [110, 116.54, 164.81]) this.tone("sawtooth", f, t, 1.8, 0.07, f / 2);
      this.tone("sine", 55, t, 2.2, 0.4, 36.71);
      this.noise(t, 1.6, 0.2, "lowpass", 300, 1, 80);
    }
  }

  /** A golden spin: a sparkling run up and a shimmer. */
  golden(style: SoundStyle): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    const run = [523.25, 659.25, 783.99, 1046.5, 1318.51, 1567.98, 2093];
    run.forEach((f, i) => this.tone(style === "retro" ? "square" : "sine", f, t + i * 0.06, 0.3, style === "retro" ? 0.07 : 0.15));
    if (style !== "retro") this.noise(t + 0.3, 1.2, 0.18, "highpass", 7000);
  }

  /** The finished nation: a fanfare. */
  reveal(style: SoundStyle): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    if (style === "retro") {
      const tune = [392, 523.25, 659.25, 783.99, 659.25, 783.99, 1046.5];
      tune.forEach((f, i) => this.tone("square", f, t + i * 0.09, i === tune.length - 1 ? 0.6 : 0.1, 0.08));
      [130.81, 196, 261.63].forEach((f, i) => this.tone("triangle", f, t + i * 0.2, 0.25, 0.2));
    } else {
      for (const f of [392, 493.88, 587.33]) this.tone("sawtooth", f, t, 0.14, 0.05);
      for (const f of [523.25, 659.25, 783.99, 1046.5]) this.tone("sawtooth", f, t + 0.16, 1.0, 0.05);
      this.tone("triangle", 130.81, t + 0.16, 1.0, 0.3);
      this.noise(t + 0.16, 1.3, 0.25, "highpass", 6000);
    }
  }
}
