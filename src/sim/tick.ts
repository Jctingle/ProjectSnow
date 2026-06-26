import init, { nudge_positions } from 'wasm-sim';
import { positions, activeCount } from '../entityStore';

let wasmReady = false;

export async function initSim() {
  await init(); // loads the .wasm binary
  wasmReady = true;
}

export function tick(delta: number) {
  if (!wasmReady) return;
  nudge_positions(positions, activeCount, delta);
}