import init, { nudge_positions, sample_height } from 'wasm-sim';
import { positions, activeCount, apc } from '../entityStore';

let wasmReady = false;

export async function initSim() {
  await init(); // loads the .wasm binary
  wasmReady = true;
}

export function tick(delta: number) {
  if (!wasmReady) return;
  nudge_positions(positions, activeCount, delta);

  apc.y = sample_height(apc.x, apc.z, 0, 0, 0.15) * 0.5;
}