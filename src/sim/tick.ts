import { initStore, getApcInterior, getSim } from '../entityStore';
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
  getSim().generate_slopemap();
  ready = true;
}

export function tick(delta: number): void {
  if (!ready) return;
  getSim().tick(delta);
  // Interior units move on floor subcells in deterministic 5-action wander.
  getApcInterior().step_interior_unit_wander();
  // Interior transfer is gated by its own whole-tick counter, not by delta.
  getApcInterior().tick();
}

export function refreshHeightmap(): void {
  getSim().generate_heightmap(
    HEIGHTMAP_GRID_SIZE,
    HEIGHTMAP_GRID_SIZE,
    GROUND_SIZE,
    GROUND_SIZE
  );
  getSim().generate_slopemap();
}

export function regenerateTerrain(seed?: number): number {
  const finalSeed = seed ?? Math.floor(100_000_000 + Math.random() * 900_000_000);
  getSim().regenerate_terrain(finalSeed);
  refreshHeightmap();
  return finalSeed;
}