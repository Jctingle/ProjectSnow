import init, { tick_units } from 'wasm-sim';
import {
  positions, states, targetX, targetZ,
  activeCount, apc
} from '../entityStore';

let wasmReady = false;

const SHARD_SIZE = 8;
const SCALE      = 0.15;  // terrain scale
const HEIGHT_MULT = 2.0;  // terrain height multiplier
const SEED_X     = 0;
const SEED_Y     = 0;

export async function initSim() {
  await init();
  wasmReady = true;
}

export function tick(delta: number) {
  if (!wasmReady) return;

  // one batched WASM call for all units
  const [nextApcX, nextApcZ, nextApcY] = tick_units(
    positions,
    states,
    targetX,
    targetZ,
    activeCount,
    apc.x,
    apc.z,
    apc.targetX,
    apc.targetZ,
    (Math.random() * 2 - 1) * SHARD_SIZE,
    (Math.random() * 2 - 1) * SHARD_SIZE,
    delta,
    SEED_X,
    SEED_Y,
    SCALE,
    HEIGHT_MULT
  );

  apc.x = nextApcX;
  apc.z = nextApcZ;
  apc.y = nextApcY;
}