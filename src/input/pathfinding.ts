import type { Sim } from 'wasm-sim';

export type Tile = {
  x: number;
  z: number;
};

// Pathfinding currently uses one world unit per integer tile coordinate.
export function worldPointToTile(x: number, z: number): Tile {
  return { x: Math.round(x), z: Math.round(z) };
}

export function findPathTiles(
  sim: Sim,
  start: Tile,
  goal: Tile,
  maxSlopeDeg: number,
): Tile[] {
  const flatTiles = sim.find_path_wasm(
    start.x,
    start.z,
    goal.x,
    goal.z,
    maxSlopeDeg,
  );

  if (flatTiles.length % 2 !== 0) {
    throw new Error('WASM path tile array must contain x/z pairs');
  }

  const tiles: Tile[] = [];
  for (let index = 0; index < flatTiles.length; index += 2) {
    tiles.push({ x: flatTiles[index], z: flatTiles[index + 1] });
  }
  return tiles;
}