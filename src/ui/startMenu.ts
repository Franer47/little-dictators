// The start screen (alpha): pick a map, press Start.

export interface MapChoice {
  /** Map name in public/maps/ (<name>.json). */
  name: string;
  label: string;
  note: string;
}

/** The maps you can pick, first = selected by default. */
export const MAP_CHOICES: MapChoice[] = [
  { name: "earth", label: "Earth", note: "The main map" },
  { name: "earth-1500", label: "Earth (small)", note: "Smaller and faster" },
];

/**
 * Shows the start screen and waits until a map is picked (or Continue, when there's a saved
 * game). Returns the map's name, whether to continue the save, and a function to call once
 * that map is ready, which hides the screen.
 */
export function chooseMap(saved?: { map: string; label: string }): Promise<{ name: string; continue: boolean; done: () => void }> {
  const menu = document.querySelector<HTMLDivElement>("#start-menu")!;
  const list = menu.querySelector<HTMLDivElement>(".map-list")!;
  const start = menu.querySelector<HTMLButtonElement>(".start")!;
  let resume: HTMLButtonElement | null = null;
  if (saved) {
    resume = document.createElement("button");
    resume.className = "start continue";
    resume.innerHTML = `Continue<small></small>`;
    resume.querySelector("small")!.textContent = saved.label;
    start.before(resume);
    start.textContent = "New game";
  }

  list.replaceChildren(
    ...MAP_CHOICES.map((choice, k) => {
      const option = document.createElement("label");
      option.className = "map-option";
      option.innerHTML = `
        <input type="radio" name="map" value="${choice.name}" ${k === 0 ? "checked" : ""} />
        <span class="name">${choice.label}</span>
        <span class="size"></span>
        <span class="note">${choice.note}</span>`;
      // The size comes from the map's own file, so it's always right.
      fetch(`${import.meta.env.BASE_URL}maps/${choice.name}.json`)
        .then((res) => res.json())
        .then((meta: { width: number; height: number }) => {
          option.querySelector(".size")!.textContent = `${meta.width} × ${meta.height}`;
        })
        .catch(() => {});
      // Double-click a map to start right away.
      option.addEventListener("dblclick", () => start.click());
      return option;
    }),
  );
  menu.hidden = false;
  (resume ?? start).focus();

  return new Promise((resolve) => {
    const go = (name: string, cont: boolean): void => {
      start.disabled = true;
      if (resume) resume.disabled = true;
      // The panel fades away; if the map takes a while, a quiet "Loading map…" shows.
      menu.classList.add("leaving");
      const done = (): void => {
        menu.classList.add("gone");
        window.setTimeout(() => (menu.hidden = true), 700);
      };
      resolve({ name, continue: cont, done });
    };
    start.addEventListener("click", () => go(list.querySelector<HTMLInputElement>("input:checked")!.value, false), { once: true });
    resume?.addEventListener("click", () => go(saved!.map, true), { once: true });
  });
}
