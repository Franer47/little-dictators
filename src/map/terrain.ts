// Terrain types. The map PNG stores each pixel as one of these colours,
// so this table is the single source of truth for both the map builder and the game.

export enum Terrain {
  Ocean = 0,
  ShallowWater = 1,
  Plains = 2,
  Tundra = 3,
  Ice = 4,
}

export interface TerrainInfo {
  id: Terrain;
  name: string;
  color: [number, number, number];
  isWater: boolean;
}

export const TERRAINS: TerrainInfo[] = [
  { id: Terrain.Ocean, name: "Ocean", color: [38, 70, 112], isWater: true },
  { id: Terrain.ShallowWater, name: "Shallow water", color: [58, 104, 150], isWater: true },
  { id: Terrain.Plains, name: "Plains", color: [134, 168, 98], isWater: false },
  { id: Terrain.Tundra, name: "Tundra", color: [152, 160, 132], isWater: false },
  { id: Terrain.Ice, name: "Ice", color: [228, 236, 240], isWater: false },
];

export function colorKey(r: number, g: number, b: number): number {
  return (r << 16) | (g << 8) | b;
}

/** Maps a packed RGB colour back to its terrain id. */
export const TERRAIN_BY_COLOR = new Map<number, Terrain>(
  TERRAINS.map((t) => [colorKey(...t.color), t.id]),
);
