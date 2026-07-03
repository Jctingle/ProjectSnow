import { initStore, getSim } from '../entityStore';
import { GROUND_SIZE } from './config';

let ready = false;

export async function initSim(): Promise<void> {
  await initStore();
  // Cache the heightmap once using a dense grid over the same world span.
  // This keeps unit ground-following close to the exact simplex terrain.
  getSim().generate_heightmap(256, 256, GROUND_SIZE, GROUND_SIZE);
  ready = true;
}

export function tick(delta: number): void {
  if (!ready) return;
  getSim().tick(delta);
}