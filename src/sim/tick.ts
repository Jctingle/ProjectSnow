import { initStore, getSim } from '../entityStore';

let ready = false;

export async function initSim(): Promise<void> {
  await initStore();
  // Cache the heightmap once. Size it to cover the full play area —
  // units outside it get edge-clamped heights, so make it generous.
  // (Match whatever dimensions your terrain mesh already uses.)
  getSim().generate_heightmap(64, 64);
  ready = true;
}

export function tick(delta: number): void {
  if (!ready) return;
  getSim().tick(delta);
}