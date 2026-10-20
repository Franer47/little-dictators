// The nation panel in the bottom-right corner of the map: flag placeholder, name and a few
// key results. Click it to open the creation record (everything rolled for the nation).

import "./nationPanel.css";
import { describeOutcome, type Nation } from "../game/nation.ts";
import { resultGroups, type WheelData } from "../game/wheels.ts";
import { escapeHtml, flagPlaceholder, formatText } from "./uiBits.ts";

export function showNationPanel(nation: Nation, data: WheelData): void {
  const text = (key: string, vars?: Record<string, string | number>): string => escapeHtml(formatText(data.text[key] ?? key, vars));
  const panel = document.createElement("div");
  panel.id = "nation-panel";

  const facts = data.panel.show
    .map((id) => nation.results[id])
    .filter(Boolean)
    .map((r) => `<li><span class="np-fact-name">${escapeHtml(r.resultName)}</span> ${escapeHtml(describeOutcome(r).main)}</li>`)
    .join("");

  const created = new Date(nation.record.createdAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
  // The record lists every result in the card's groups, with its odds.
  const groups = resultGroups(data)
    .map((group) => {
      const rows = group.wheels
        .map((id) => nation.results[id])
        .filter(Boolean)
        .map((r) => {
          const { main, sub } = describeOutcome(r);
          return `<tr${r.rare ? ' class="np-rare"' : ""}>
            <th scope="row">${escapeHtml(r.resultName)}</th>
            <td><div class="np-result">${escapeHtml(main)}</div>${sub ? `<div class="np-est">${escapeHtml(sub)}</div>` : ""}</td>
            <td class="np-odds">${text("recordOdds", { chance: odds(r.chance * (r.exactChance ?? 1)) })}</td>
          </tr>`;
        })
        .join("");
      return rows ? `<tbody><tr class="np-group"><th colspan="3" scope="rowgroup">${escapeHtml(group.name)}</th></tr>${rows}</tbody>` : "";
    })
    .join("");

  panel.innerHTML = `
    <section class="np-record" hidden role="dialog" aria-labelledby="np-record-title">
      <header>
        <h2 id="np-record-title">${text("recordTitle")}</h2>
        <button type="button" class="np-close" aria-label="${text("close")}" title="${text("close")} (Esc)">×</button>
      </header>
      <div class="np-record-body">
        <div class="np-record-name"></div>
        <table>${groups}</table>
        <dl>
          <dt>${text("recordFirstName")}</dt><dd>${escapeHtml(nation.record.firstName)}</dd>
          <dt>${text("recordEra")}</dt><dd>${escapeHtml(data.eraName)}</dd>
          <dt>${text("recordCreated")}</dt><dd>${escapeHtml(created)}</dd>
          <dt>${text("recordMap")}</dt><dd>${escapeHtml(nation.record.map)}</dd>
          <dt>${text("recordSeed")}</dt><dd>${nation.record.seed}</dd>
        </dl>
      </div>
    </section>
    <button type="button" class="np-summary" title="${text("panelHint")}" aria-expanded="false">
      ${flagPlaceholder(data.text.flagSoon ?? "")}
      <span class="np-text">
        <span class="np-name"></span>
        <ul class="np-facts">${facts}</ul>
      </span>
    </button>`;
  panel.querySelector(".np-name")!.textContent = nation.name;
  panel.querySelector(".np-record-name")!.textContent = nation.name;
  document.body.append(panel);

  const record = panel.querySelector<HTMLElement>(".np-record")!;
  const summary = panel.querySelector<HTMLButtonElement>(".np-summary")!;
  const setOpen = (open: boolean): void => {
    record.hidden = !open;
    summary.setAttribute("aria-expanded", String(open));
    panel.classList.toggle("open", open);
  };
  summary.addEventListener("click", () => setOpen(!panel.classList.contains("open")));
  panel.querySelector(".np-close")!.addEventListener("click", () => setOpen(false));
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !record.hidden) setOpen(false);
  });
  // Keep presses on the panel from reaching the map behind it.
  panel.addEventListener("pointerdown", (e) => e.stopPropagation());
  panel.addEventListener("wheel", (e) => e.stopPropagation());
}

/** 0.125 → "12.5% (1 in 8)". */
function odds(chance: number): string {
  const pct = chance * 100;
  const shown = pct >= 10 ? pct.toFixed(1).replace(/\.0$/, "") : pct.toPrecision(2);
  return chance > 0 ? `${shown}% (1 in ${Math.round(1 / chance).toLocaleString("en-US")})` : "0%";
}
