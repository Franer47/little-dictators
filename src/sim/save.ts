// Saving the game in the browser (IndexedDB): the land (who owns each pixel), every nation as
// it was rolled, and the running world. One save slot, written every year and when the page
// is closed; the start screen offers Continue when there is one. Storage can be missing or
// blocked (private windows), so every call is allowed to fail quietly.

import type { Nation } from "../game/nation.ts";
import type { WorldSave } from "./world.ts";

export interface SavedNation {
  nation: Nation;
  color: string;
  mine?: boolean;
  start: [number, number];
  rolledArea: number;
  targetArea: number;
}

export interface GameSave {
  version: 1;
  savedAt: string;
  map: string;
  seed: number;
  /** How many nations have been made (for the next one's seed). */
  made: number;
  nations: SavedNation[];
  owner: Uint16Array;
  world: WorldSave;
  /** Shown on the Continue button, e.g. "Kingdom of Wittenstein, March 1534". */
  label: string;
}

const DB = "littleDictators";
const STORE = "saves";
const SLOT = "autosave";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveGame(save: GameSave): Promise<boolean> {
  try {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(save, SLOT);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return true;
  } catch {
    return false;
  }
}

export async function loadGame(): Promise<GameSave | null> {
  try {
    const db = await open();
    const save = await new Promise<GameSave | null>((resolve, reject) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(SLOT);
      req.onsuccess = () => resolve((req.result as GameSave | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return save && save.version === 1 ? save : null;
  } catch {
    return null;
  }
}

export async function deleteSave(): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(SLOT);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    db.close();
  } catch {
    // nothing saved, nothing to delete
  }
}
