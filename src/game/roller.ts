// The rules for spinning a whole nation, one spin at a time. The wheel screen asks the
// roller which wheel to show, spins it, and tells the roller where it landed; the instant
// roll (?wheel=skip, "Spin the rest", the dev checks) uses the same roller, so a seed always
// gives the same nation either way.
//
// One base wheel (Government, Land size…) can take several spins:
//   gate   a yes/no spin first (the golden chance); "no" ends the wheel
//   main   the wheel itself
//   rare   after landing on a rare slice: its own wheel of rare results
//   exact  number wheels: the exact number in the range that landed
//   pick   multi-pick wheels: the next pick, without the earlier ones

import { chartPosition, chartWeighted, gateChance, type ChartPoint } from "./chart.ts";
import { chainBase, createNation, makeEstimate, makeOutcome, type Nation, type WheelOutcome } from "./nation.ts";
import type { Rng } from "./random.ts";
import { formatText } from "./text.ts";
import { chanceOf, exactWheel, spinWheel, withoutPicked, type Slice, type Wheel, type WheelData } from "./wheels.ts";

export type SpinKind = "gate" | "main" | "rare" | "exact" | "pick";

/** The spin to do now. */
export interface Step {
  /** Which base wheel (index into data.wheels). */
  index: number;
  base: Wheel;
  /** The wheel to show and spin. */
  wheel: Wheel;
  kind: SpinKind;
  /** For "pick": which pick this is (1, 2, 3…). */
  pick: number;
}

/** What a spin led to. */
export interface Landing {
  step: Step;
  slice: Slice;
  /** Set when the base wheel is finished: its result. */
  outcome?: WheelOutcome;
  /** Other results a bonus effect changed (wheel ids), to show again. */
  changed: string[];
  /** Landed on a rare slice: its rare wheel is next. */
  doom: boolean;
  /** The gate said yes: the golden wheel is next. */
  golden: boolean;
}

export class NationRoller {
  readonly outcomes: WheelOutcome[] = [];
  readonly results: Record<string, WheelOutcome> = {};
  /** The chance the nation had of a golden spin (set when the golden gate is shown). */
  goldenChance: number | undefined;
  current: Step | null = null;

  private index = 0;
  // The state of the base wheel being spun.
  private prepared: Wheel | null = null;
  private gate: { wheel: Wheel; chance: number; passed: boolean } | null = null;
  private rare: { slice: Slice; chance: number } | null = null;
  private range: Slice | null = null;
  private exact: Wheel | null = null;
  private picks: { wheel: Wheel; slice: Slice }[] = [];

  constructor(
    private readonly data: WheelData,
    private readonly rng: Rng,
  ) {
    this.current = this.makeStep();
  }

  get done(): boolean {
    return this.current === null;
  }

  chart(): ChartPoint {
    return chartPosition(this.data, this.results);
  }

  /** Records where the current spin landed and moves on to the next spin. */
  land(slice: Slice): Landing {
    const step = this.current!;
    const landing: Landing = { step, slice, changed: [], doom: false, golden: false };
    const base = step.base;
    switch (step.kind) {
      case "gate":
        if (slice.id === "yes") {
          this.gate!.passed = true;
          landing.golden = true;
        } else this.finish(landing, this.noLuck(base));
        break;
      case "rare":
        this.finish(landing, this.rareOutcome(base, step.wheel, slice));
        break;
      case "exact":
        this.finish(landing, makeOutcome(this.prepared!, this.range!, this.data, { wheel: step.wheel, slice }, this.results));
        break;
      case "pick":
      case "main":
        if (slice.then && step.kind === "main") {
          this.rare = { slice, chance: chanceOf(step.wheel, slice) };
          landing.doom = true;
        } else if (base.number) {
          this.range = slice;
        } else if ((base.picks ?? 1) > 1) {
          this.picks.push({ wheel: step.wheel, slice });
          if (this.picks.length >= base.picks!) this.finish(landing, this.picksOutcome(base));
        } else {
          const outcome = makeOutcome(step.wheel, slice, this.data);
          if (this.gate) outcome.chance *= this.gate.chance;
          this.finish(landing, outcome, slice);
        }
        break;
    }
    this.current = this.makeStep();
    return landing;
  }

  /** Spins everything that's left with no animation. Returns the indexes of the results it added. */
  rollRest(): number[] {
    const from = this.outcomes.length;
    while (this.current) this.land(spinWheel(this.current.wheel, this.rng).slice);
    return this.outcomes.map((_, i) => i).slice(from);
  }

  /** The finished nation (call when done). */
  nation(map: string): Nation {
    return createNation(this.data, this.outcomes, map, this.rng, this.goldenChance);
  }

  // ---------------------------------------------------------------- inside

  private makeStep(): Step | null {
    const wheels = this.data.wheels;
    if (this.index >= wheels.length) return null;
    const base = wheels[this.index];
    const make = (wheel: Wheel, kind: SpinKind): Step => ({ index: this.index, base, wheel, kind, pick: this.picks.length + 1 });
    if (base.gate && !this.gate) {
      const chance = gateChance(base.gate, this.chart());
      this.goldenChance = chance;
      this.gate = { wheel: gateWheel(base, chance), chance, passed: false };
    }
    if (this.gate && !this.gate.passed) return make(this.gate.wheel, "gate");
    this.prepared ??= this.prepare(base);
    if (this.rare) return make(this.rare.slice.then!, "rare");
    if (this.range) return make((this.exact ??= exactWheel(this.prepared, this.range, this.data, chainBase(base, this.results))), "exact");
    if (this.picks.length) return make(withoutPicked(this.prepared, this.picks.map((p) => p.slice)), "pick");
    return make(this.prepared, "main");
  }

  /** The wheel as this nation sees it: rare slices gone once it has had its rare pull, sized by the chart. */
  private prepare(base: Wheel): Wheel {
    let wheel = base;
    const rares = this.outcomes.filter((o) => o.rare).length;
    if (rares >= (this.data.rareLimit ?? 1) && wheel.slices.some((s) => s.rare)) wheel = { ...wheel, slices: wheel.slices.filter((s) => !s.rare) };
    return chartWeighted(wheel, this.chart());
  }

  private finish(landing: Landing, outcome: WheelOutcome, slice?: Slice): void {
    if (slice?.effect) landing.changed = this.applyEffect(outcome, slice);
    this.outcomes.push(outcome);
    this.results[outcome.wheelId] = outcome;
    landing.outcome = outcome;
    this.index++;
    this.prepared = this.gate = this.rare = this.range = this.exact = null;
    this.picks = [];
  }

  private rareOutcome(base: Wheel, rareWheel: Wheel, slice: Slice): WheelOutcome {
    const outcome = makeOutcome(rareWheel, slice, this.data);
    outcome.wheelId = base.id;
    outcome.wheelName = base.name;
    outcome.resultName = base.resultName ?? base.name;
    outcome.chance *= this.rare!.chance;
    outcome.rare = true;
    return outcome;
  }

  private picksOutcome(base: Wheel): WheelOutcome {
    const list = this.picks.map(({ wheel, slice }) => ({ sliceId: slice.id, label: slice.label, chance: chanceOf(wheel, slice) }));
    const label = list.map((p) => p.label).join(", ");
    return {
      wheelId: base.id,
      wheelName: base.name,
      resultName: base.resultName ?? base.name,
      sliceId: list.map((p) => p.sliceId).join("+"),
      label,
      shown: label,
      chance: list.reduce((c, p) => c * p.chance, 1),
      picks: list,
    };
  }

  private noLuck(base: Wheel): WheelOutcome {
    const gate = base.gate!;
    return {
      wheelId: base.id,
      wheelName: base.name,
      resultName: base.resultName ?? base.name,
      sliceId: "none",
      label: gate.noResult,
      shown: gate.noResult,
      chance: 1 - this.gate!.chance,
      none: true,
    };
  }

  /**
   * A bonus effect, e.g. { multiply: { land: 2 } }: multiplies that number result, then
   * works out again everything chained to it (more land → more people → a bigger GDP).
   * Returns the ids of the results that changed.
   */
  private applyEffect(outcome: WheelOutcome, slice: Slice): string[] {
    const changed: string[] = [];
    const parts: string[] = [];
    for (const [id, factor] of Object.entries(slice.effect?.multiply ?? {})) {
      const e = this.results[id]?.estimate;
      if (!e) continue;
      e.boost = (e.boost ?? 1) * factor;
      const wheel = this.data.wheels.find((w) => w.id === id)!;
      parts.push(formatText(this.data.text.effectMultiply ?? "{what} ×{factor}", { what: wheel.resultName ?? wheel.name, factor }));
    }
    if (!parts.length) return changed;
    outcome.effectText = parts.join(", ");
    // Work the numbers out again in spin order, so chained ones follow.
    for (const wheel of this.data.wheels) {
      const r = this.results[wheel.id];
      if (!wheel.number || !r?.estimate) continue;
      const range = wheel.slices.find((s) => s.id === r.sliceId);
      if (!range) continue;
      const before = r.estimate.value;
      r.estimate = makeEstimate(this.data, wheel, range, r.estimate.rate, chainBase(wheel, this.results), r.estimate.boost ?? 1);
      if (r.estimate.value !== before) changed.push(wheel.id);
    }
    return changed;
  }
}

/** The yes/no wheel before a gated wheel, with "yes" as big as its chance. */
function gateWheel(base: Wheel, chance: number): Wheel {
  const gate = base.gate!;
  const pct = `${(chance * 100).toFixed(chance < 0.1 ? 1 : 0)}%`;
  return {
    id: `${base.id}:gate`,
    name: gate.name,
    question: formatText(gate.question, { chance: pct }),
    slices: [
      { id: "yes", label: gate.yes, shown: gate.yes, weight: chance, golden: true },
      { id: "no", label: gate.no, shown: gate.no, weight: 1 - chance },
    ],
  };
}

/** Rolls a whole nation at once, with no animation (?wheel=skip, the dev checks). */
export function rollNation(data: WheelData, map: string, rng: Rng): Nation {
  const roller = new NationRoller(data, rng);
  roller.rollRest();
  return roller.nation(map);
}

