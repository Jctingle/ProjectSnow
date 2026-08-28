import init, { ApcInterior, Sim } from 'wasm-sim';
import {
  APC_CELLS_DEFAULT_X,
  APC_CELLS_DEFAULT_Y,
  APC_CELLS_DEFAULT_Z,
  APC_ENVELOPE_X,
  APC_ENVELOPE_Y,
  APC_ENVELOPE_Z,
  APC_SPEED_DEFAULT,
  APC_TRANSFER_INTERVAL_TICKS,
  CRAG_FREQ,
  CRAG_STRENGTH,
  HEIGHT_MULT,
  GROUND_SIZE,
  NOISE_SEED,
  SCALE,
  SEED_X,
  SEED_Y,
  UNIT_WANDER_RADIUS,
  SWEEP_AMP,
  SWEEP_SCALE,
  TIER_HEIGHT_SCALE,
} from './sim/config';

export const MAX_UNITS = 5000;

// Fields the sim doesn't touch stay as plain JS TypedArrays.
export const hp = new Uint16Array(MAX_UNITS);
export const programId = new Uint16Array(MAX_UNITS);

export const SEEK_APC = 0;
export const SEEK_RANDOM = 1;

let sim: Sim | null = null;
let apcInterior: ApcInterior | null = null;
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
    UNIT_WANDER_RADIUS,
    GROUND_SIZE / 2,
    CRAG_STRENGTH,
    CRAG_FREQ,
    SWEEP_SCALE,
    SWEEP_AMP,
    TIER_HEIGHT_SCALE,
    APC_SPEED_DEFAULT,
    (Math.random() * 0xffffffff) >>> 0 // rng seed
  );
  apcInterior = new ApcInterior(
    APC_ENVELOPE_X,
    APC_ENVELOPE_Y,
    APC_ENVELOPE_Z,
    APC_CELLS_DEFAULT_X,
    APC_CELLS_DEFAULT_Y,
    APC_CELLS_DEFAULT_Z,
    APC_TRANSFER_INTERVAL_TICKS
  );
}

export function getSim(): Sim {
  if (!sim) throw new Error('initStore() has not resolved yet');
  return sim;
}

export function getApcInterior(): ApcInterior {
  if (!apcInterior) throw new Error('initStore() has not resolved yet');
  return apcInterior;
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
 * sim.generate_heightmap(gridW, gridH, worldW, worldH). Build the terrain
 * mesh from this so the
 * ground and unit height-following are guaranteed to agree.
 */
export function getHeightmap(width: number, height: number): Float32Array {
  return new Float32Array(memory.buffer, getSim().heightmap_ptr(), width * height);
}

/**
 * Zero-copy view over the cached slopemap (degrees). Call AFTER
 * sim.generate_slopemap(), which itself must run after generate_heightmap().
 * Used by slope debug overlay and destination validity checks that must
 * exactly match overlay coloration.
 */
export function getSlopemap(width: number, height: number): Float32Array {
  return new Float32Array(memory.buffer, getSim().slopemap_ptr(), width * height);
}

export function getNeighborHeightmap(
  dr: number,
  dc: number,
  width: number,
  height: number
): Float32Array | null {
  const ptr = getSim().neighbor_heightmap_ptr(dr, dc);
  if (ptr === 0) return null;
  return new Float32Array(memory.buffer, ptr, width * height);
}

export function getNeighborSlopemap(
  dr: number,
  dc: number,
  width: number,
  height: number
): Float32Array | null {
  const ptr = getSim().neighbor_slopemap_ptr(dr, dc);
  if (ptr === 0) return null;
  return new Float32Array(memory.buffer, ptr, width * height);
}

export function activeCount(): number {
  return sim ? sim.count() : 0;
}

type U8Cache = { view: Uint8Array; ptr: number; length: number } | null;
type U32Cache = { view: Uint32Array; ptr: number; length: number } | null;

const EMPTY_U8 = new Uint8Array(0);
const EMPTY_U32 = new Uint32Array(0);

// Machine arrays are reallocated when a machine is added, so the pointer is
// compared as well as the buffer identity.
function cacheU8(cache: U8Cache, ptr: number, length: number): U8Cache {
  if (
    cache &&
    cache.ptr === ptr &&
    cache.length === length &&
    cache.view.buffer === memory.buffer
  ) {
    return cache;
  }
  return { view: new Uint8Array(memory.buffer, ptr, length), ptr, length };
}

function cacheU32(cache: U32Cache, ptr: number, length: number): U32Cache {
  if (
    cache &&
    cache.ptr === ptr &&
    cache.length === length &&
    cache.view.buffer === memory.buffer
  ) {
    return cache;
  }
  return { view: new Uint32Array(memory.buffer, ptr, length), ptr, length };
}

let cellKindCache: U8Cache = null;
let faceXCache: U8Cache = null;
let faceYCache: U8Cache = null;
let faceZCache: U8Cache = null;
let machineCellsCache: U32Cache = null;
let machineHoldingCache: U8Cache = null;
let machineIdsCache: U32Cache = null;
let machineParentCellsCache: U32Cache = null;
let machineFootprintsCache: U8Cache = null;
let subgridOccupantKindsCache: U8Cache = null;
let subgridOccupantIdsCache: U32Cache = null;

/** Cell kinds across the whole envelope. Changes only on hull expansion. */
export function getApcCellKinds(): Uint8Array {
  const interior = getApcInterior();
  cellKindCache = cacheU8(cellKindCache, interior.cell_kind_ptr(), interior.cell_count());
  return cellKindCache!.view;
}

export function getApcFaceX(): Uint8Array {
  const interior = getApcInterior();
  faceXCache = cacheU8(faceXCache, interior.face_x_ptr(), interior.face_x_len());
  return faceXCache!.view;
}

export function getApcFaceY(): Uint8Array {
  const interior = getApcInterior();
  faceYCache = cacheU8(faceYCache, interior.face_y_ptr(), interior.face_y_len());
  return faceYCache!.view;
}

export function getApcFaceZ(): Uint8Array {
  const interior = getApcInterior();
  faceZCache = cacheU8(faceZCache, interior.face_z_ptr(), interior.face_z_len());
  return faceZCache!.view;
}

export function getApcMachineCells(): Uint32Array {
  const interior = getApcInterior();
  const count = interior.machine_count();
  if (count === 0) return EMPTY_U32;
  machineCellsCache = cacheU32(machineCellsCache, interior.machine_cells_ptr(), count);
  return machineCellsCache!.view;
}

export function getApcMachineIds(): Uint32Array {
  const interior = getApcInterior();
  const count = interior.machine_count();
  if (count === 0) return EMPTY_U32;
  machineIdsCache = cacheU32(machineIdsCache, interior.machine_ids_ptr(), count);
  return machineIdsCache!.view;
}

export function getApcMachineParentCells(): Uint32Array {
  const interior = getApcInterior();
  const count = interior.machine_count();
  if (count === 0) return EMPTY_U32;
  machineParentCellsCache = cacheU32(
    machineParentCellsCache,
    interior.machine_parent_cells_ptr(),
    count,
  );
  return machineParentCellsCache!.view;
}

export function getApcMachineFootprints(): Uint8Array {
  const interior = getApcInterior();
  const count = interior.machine_count();
  if (count === 0) return EMPTY_U8;
  machineFootprintsCache = cacheU8(machineFootprintsCache, interior.machine_footprints_ptr(), count);
  return machineFootprintsCache!.view;
}


/** The only interior array that changes on a normal frame. */
export function getApcMachineHolding(): Uint8Array {
  const interior = getApcInterior();
  const count = interior.machine_count();
  if (count === 0) return EMPTY_U8;
  machineHoldingCache = cacheU8(machineHoldingCache, interior.machine_holding_ptr(), count);
  return machineHoldingCache!.view;
}

export function getApcSubgridOccupantKinds(): Uint8Array {
  const interior = getApcInterior();
  const length = interior.subgrid_occupant_kinds_len();
  if (length === 0) return EMPTY_U8;
  subgridOccupantKindsCache = cacheU8(
    subgridOccupantKindsCache,
    interior.subgrid_occupant_kinds_ptr(),
    length,
  );
  return subgridOccupantKindsCache!.view;
}

export function getApcSubgridOccupantIds(): Uint32Array {
  const interior = getApcInterior();
  const length = interior.subgrid_occupant_ids_len();
  if (length === 0) return EMPTY_U32;
  subgridOccupantIdsCache = cacheU32(
    subgridOccupantIdsCache,
    interior.subgrid_occupant_ids_ptr(),
    length,
  );
  return subgridOccupantIdsCache!.view;
}

export function spawnUnit(x: number, z: number): number {
  const id = getSim().spawn_unit(x, z);
  if (id >= 0) {
    hp[id] = 100;
  }
  return id;
}