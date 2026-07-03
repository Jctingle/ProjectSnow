import init, { Sim } from 'wasm-sim';

export const MAX_UNITS = 500;

// Terrain / sim tuning (moved here from tick.ts so Sim construction owns them)
const NOISE_SEED = 42;
const SEED_X = 0;
const SEED_Y = 0;
const SCALE = 0.15;
const HEIGHT_MULT = 2.0;
const SHARD_HALF = 8; // wander targets land in [-8, 8]

// Fields the sim doesn't touch stay as plain JS TypedArrays.
export const hp = new Uint16Array(MAX_UNITS);
export const programId = new Uint16Array(MAX_UNITS);

export const SEEK_APC = 0;
export const SEEK_RANDOM = 1;

let sim: Sim | null = null;
let memory: WebAssembly.Memory;

// Cached zero-copy views over WASM memory.
let positionsView: Float32Array | null = null;
let statesView: Uint8Array | null = null;

export async function initStore(): Promise<void> {
  const wasm = await init();
  memory = wasm.memory;
  sim = new Sim(
    MAX_UNITS,
    NOISE_SEED,
    SEED_X,
    SEED_Y,
    SCALE,
    HEIGHT_MULT,
    SHARD_HALF,
    (Math.random() * 0xffffffff) >>> 0 // rng seed
  );
}

export function getSim(): Sim {
  if (!sim) throw new Error('initStore() has not resolved yet');
  return sim;
}

/**
 * Zero-copy view over unit positions (xyz interleaved).
 * Recreated automatically if WASM memory grew (which detaches old views).
 */
export function getPositions(): Float32Array {
  if (!positionsView || positionsView.buffer !== memory.buffer) {
    positionsView = new Float32Array(
      memory.buffer,
      getSim().positions_ptr(),
      MAX_UNITS * 3
    );
  }
  return positionsView;
}

export function getStates(): Uint8Array {
  if (!statesView || statesView.buffer !== memory.buffer) {
    statesView = new Uint8Array(memory.buffer, getSim().states_ptr(), MAX_UNITS);
  }
  return statesView;
}

/**
 * Zero-copy view over the cached heightmap. Call AFTER
 * sim.generate_heightmap(w, h). Build the terrain mesh from this so the
 * ground and unit height-following are guaranteed to agree.
 */
export function getHeightmap(width: number, height: number): Float32Array {
  return new Float32Array(memory.buffer, getSim().heightmap_ptr(), width * height);
}

export function activeCount(): number {
  return sim ? sim.count() : 0;
}

export function spawnUnit(x: number, z: number): number {
  const id = getSim().spawn_unit(x, z);
  if (id >= 0) {
    hp[id] = 100;
  }
  return id;
}