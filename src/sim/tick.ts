import { initStore, getSim } from '../entityStore';
import { GROUND_SIZE, HEIGHTMAP_GRID_SIZE } from './config';

let ready = false;

export async function initSim(): Promise<void> {
  await initStore();
  // Cache the heightmap once using a dense grid over the same world span.
  // This keeps unit ground-following close to the exact simplex terrain.
  getSim().generate_heightmap(
    HEIGHTMAP_GRID_SIZE,
    HEIGHTMAP_GRID_SIZE,
    GROUND_SIZE,
    GROUND_SIZE
  );
  ready = true;
}

export function tick(delta: number): void {
  if (!ready) return;
  getSim().tick(delta);
}

export function refreshHeightmap(): void {
  getSim().generate_heightmap(
    HEIGHTMAP_GRID_SIZE,
    HEIGHTMAP_GRID_SIZE,
    GROUND_SIZE,
    GROUND_SIZE
  );
}

export function regenerateTerrain(seed?: number): number {
  const finalSeed = seed ?? Math.floor(100_000_000 + Math.random() * 900_000_000);
  getSim().regenerate_terrain(finalSeed);
  refreshHeightmap();
  return finalSeed;
}