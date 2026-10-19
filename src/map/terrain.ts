// Terrain types. The map PNG stores each pixel as one of these colours,
// so this table is the single source of truth for both the map builder and the game.
// These are *data* colours (flat, one per type, easy to edit in a paint program). The
// shaded colours you see in the game are worked out by the renderer from the terrain
// plus the heightmap.

export enum Terrain {
  Ocean = 0,
  ShallowWater = 1,
  Plains = 2,
  Highlands = 3,
  Mountains = 4,
  Ice = 5,
  /** Cold, snowy land in the far north (the tundra beyond the tree line). */
  Snow = 6,
  /** Tropical rainforest (Amazon, Congo, Southeast Asia, New Guinea...). */
  Rainforest = 7,
  /** Any other dense forest: boreal taiga and temperate forest. */
  Forest = 8,
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
  { id: Terrain.Highlands, name: "Highlands", color: [190, 166, 116], isWater: false },
  { id: Terrain.Mountains, name: "Mountains", color: [150, 146, 140], isWater: false },
  { id: Terrain.Ice, name: "Ice", color: [228, 236, 240], isWater: false },
  { id: Terrain.Snow, name: "Snow", color: [196, 206, 212], isWater: false },
  { id: Terrain.Rainforest, name: "Rainforest", color: [40, 120, 50], isWater: false },
  { id: Terrain.Forest, name: "Forest", color: [50, 92, 76], isWater: false },
];

export function colorKey(r: number, g: number, b: number): number {
  return (r << 16) | (g << 8) | b;
}

/** Maps a packed RGB colour back to its terrain id. */
export const TERRAIN_BY_COLOR = new Map<number, Terrain>(
  TERRAINS.map((t) => [colorKey(...t.color), t.id]),
);
