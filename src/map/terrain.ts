// Terrain types. The map PNG stores each pixel as one of these colours,
// so this table is the single source of truth for both the map builder and the game.
// These are *data* colours (flat, one per type, easy to edit in a paint program). The
// shaded colours you see in the game are worked out by the renderer from the terrain
// plus the heightmap.

export enum Terrain {
  /** Deep water: the open sea and the middle of big lakes. */
  Ocean = 0,
  /** Water near a coast, both at sea and on big lakes (lakes use the same types as the sea). */
  ShallowWater = 1,
  Plains = 2,
  Highlands = 3,
  Mountains = 4,
  Ice = 5,
  /** Cold, snowy land in the far north (the tundra beyond the tree line). */
  Snow = 6,
  /**
   * A major river: an unbroken line 1 pixel wide with no diagonal gaps, so it cleanly splits
   * the land on its two banks. It is water, but NOT a barrier like the sea: armies will be
   * able to cross it (see `crossableByArmies`). A river between two nations will be a
   * border that belongs to neither.
   */
  River = 7,
}

export interface TerrainInfo {
  id: Terrain;
  name: string;
  color: [number, number, number];
  /** Drawn as water and described as water on hover (sea, lakes and rivers). */
  isWater: boolean;
  /**
   * True if land armies can walk onto / across it. All land and rivers: yes (crossing a
   * defended river will just be hard). The sea and lakes: no, they need ships.
   * Simulation code should use this, not `isWater`, to decide where armies can go.
   */
  crossableByArmies: boolean;
}

export const TERRAINS: TerrainInfo[] = [
  { id: Terrain.Ocean, name: "Ocean", color: [38, 70, 112], isWater: true, crossableByArmies: false },
  { id: Terrain.ShallowWater, name: "Shallow water", color: [58, 104, 150], isWater: true, crossableByArmies: false },
  { id: Terrain.Plains, name: "Plains", color: [134, 168, 98], isWater: false, crossableByArmies: true },
  { id: Terrain.Highlands, name: "Highlands", color: [190, 166, 116], isWater: false, crossableByArmies: true },
  { id: Terrain.Mountains, name: "Mountains", color: [150, 146, 140], isWater: false, crossableByArmies: true },
  { id: Terrain.Ice, name: "Ice", color: [228, 236, 240], isWater: false, crossableByArmies: true },
  { id: Terrain.Snow, name: "Snow", color: [196, 206, 212], isWater: false, crossableByArmies: true },
  { id: Terrain.River, name: "River", color: [70, 140, 220], isWater: true, crossableByArmies: true },
];

export function colorKey(r: number, g: number, b: number): number {
  return (r << 16) | (g << 8) | b;
}

/** Maps a packed RGB colour back to its terrain id. */
export const TERRAIN_BY_COLOR = new Map<number, Terrain>(
  TERRAINS.map((t) => [colorKey(...t.color), t.id]),
);
