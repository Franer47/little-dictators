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
 * Shows the start screen and waits until a map is picked. Returns the map's name and a
 * function to call once that map is ready, which hides the screen.
 */
export function chooseMap(): Promise<{ name: string; done: () => void }> {
  const menu = document.querySelector<HTMLDivElement>("#start-menu")!;
  const list = menu.querySelector<HTMLDivElement>(".map-list")!;
  const start = menu.querySelector<HTMLButtonElement>(".start")!;

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
      fetch(`/maps/${choice.name}.json`)
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
  start.focus();

  return new Promise((resolve) => {
    start.addEventListener(
      "click",
      () => {
        const name = list.querySelector<HTMLInputElement>("input:checked")!.value;
        start.disabled = true;
        start.textContent = "Loading map…";
        resolve({ name, done: () => (menu.hidden = true) });
      },
      { once: true },
    );
  });
}
