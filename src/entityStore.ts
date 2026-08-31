import init, {
  ApcInterior,
  InteriorMoveAction,
  InteriorMoveResult,
  InteriorUnitMode,
  Sim,
  UnitSpecialization,
} from 'wasm-sim';
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

export { UnitSpecialization };
export { InteriorMoveAction, InteriorMoveResult };
export { InteriorUnitMode };

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
type U16Cache = { view: Uint16Array; ptr: number; length: number } | null;

const EMPTY_U8 = new Uint8Array(0);
const EMPTY_U32 = new Uint32Array(0);
const EMPTY_U16 = new Uint16Array(0);

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

function cacheU16(cache: U16Cache, ptr: number, length: number): U16Cache {
  if (
    cache &&
    cache.ptr === ptr &&
    cache.length === length &&
    cache.view.buffer === memory.buffer
  ) {
    return cache;
  }
  return { view: new Uint16Array(memory.buffer, ptr, length), ptr, length };
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
let interiorUnitSchemaVersionsCache: U16Cache = null;
let interiorUnitIdsCache: U32Cache = null;
let interiorUnitCellsCache: U32Cache = null;
let interiorUnitSubcellsCache: U8Cache = null;
let interiorUnitModesCache: U8Cache = null;
let interiorUnitSpecializationsCache: U8Cache = null;
let interiorUnitHealthCurrentCache: U16Cache = null;
let interiorUnitHealthMaxCache: U16Cache = null;
let interiorUnitCombatSkillCache: U16Cache = null;
let interiorUnitMachineOperationSkillCache: U16Cache = null;
let interiorUnitVehicleOperationSkillCache: U16Cache = null;
let interiorUnitHeatCapacityCache: U16Cache = null;
let interiorUnitHeatRegenCache: U16Cache = null;
let interiorUnitUpgradePointsCache: U16Cache = null;
let interiorUnitAssignedMachineIdsCache: U32Cache = null;
let interiorUnitEquipmentSlotsCache: U32Cache = null;
let interiorUnitInventoryCapacityCache: U16Cache = null;
let interiorUnitInventoryLoadCache: U16Cache = null;

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

export function interiorUnitCount(): number {
  return getApcInterior().interior_unit_count();
}

export function interiorUnitCapacity(): number {
  return getApcInterior().interior_unit_capacity();
}

export function registerInteriorUnitProfile(
  specialization: UnitSpecialization = UnitSpecialization.Generalist,
): number {
  return getApcInterior().register_interior_unit_profile(specialization);
}

export function clearInteriorUnitProfiles(): void {
  getApcInterior().clear_interior_unit_profiles();
}

export function placeInteriorUnit(unitId: number, cell: number, local: number): boolean {
  return getApcInterior().place_interior_unit(unitId, cell, local);
}

export function clearInteriorUnitPlacement(unitId: number): boolean {
  return getApcInterior().clear_interior_unit_placement(unitId);
}

export function setInteriorUnitMode(unitId: number, mode: InteriorUnitMode): boolean {
  return getApcInterior().set_interior_unit_mode(unitId, mode);
}

export function tryMoveInteriorUnit(
  unitId: number,
  action: InteriorMoveAction,
): InteriorMoveResult {
  return getApcInterior().try_move_interior_unit(unitId, action);
}

export function tryMoveInteriorUnitFrom(
  unitId: number,
  sourceCell: number,
  sourceLocal: number,
  action: InteriorMoveAction,
): InteriorMoveResult {
  return getApcInterior().try_move_interior_unit_from(
    unitId,
    sourceCell,
    sourceLocal,
    action,
  );
}

export function getInteriorUnitSchemaVersions(): Uint16Array {
  const interior = getApcInterior();
  const length = interior.interior_unit_schema_versions_len();
  if (length === 0) return EMPTY_U16;
  interiorUnitSchemaVersionsCache = cacheU16(
    interiorUnitSchemaVersionsCache,
    interior.interior_unit_schema_versions_ptr(),
    length,
  );
  return interiorUnitSchemaVersionsCache!.view;
}

export function getInteriorUnitIds(): Uint32Array {
  const interior = getApcInterior();
  const length = interior.interior_unit_ids_len();
  if (length === 0) return EMPTY_U32;
  interiorUnitIdsCache = cacheU32(
    interiorUnitIdsCache,
    interior.interior_unit_ids_ptr(),
    length,
  );
  return interiorUnitIdsCache!.view;
}

export function getInteriorUnitCells(): Uint32Array {
  const interior = getApcInterior();
  const length = interior.interior_unit_cells_len();
  if (length === 0) return EMPTY_U32;
  interiorUnitCellsCache = cacheU32(
    interiorUnitCellsCache,
    interior.interior_unit_cells_ptr(),
    length,
  );
  return interiorUnitCellsCache!.view;
}

export function getInteriorUnitSubcells(): Uint8Array {
  const interior = getApcInterior();
  const length = interior.interior_unit_subcells_len();
  if (length === 0) return EMPTY_U8;
  interiorUnitSubcellsCache = cacheU8(
    interiorUnitSubcellsCache,
    interior.interior_unit_subcells_ptr(),
    length,
  );
  return interiorUnitSubcellsCache!.view;
}

export function getInteriorUnitModes(): Uint8Array {
  const interior = getApcInterior();
  const length = interior.interior_unit_modes_len();
  if (length === 0) return EMPTY_U8;
  interiorUnitModesCache = cacheU8(
    interiorUnitModesCache,
    interior.interior_unit_modes_ptr(),
    length,
  );
  return interiorUnitModesCache!.view;
}

export function getInteriorUnitSpecializations(): Uint8Array {
  const interior = getApcInterior();
  const length = interior.interior_unit_specializations_len();
  if (length === 0) return EMPTY_U8;
  interiorUnitSpecializationsCache = cacheU8(
    interiorUnitSpecializationsCache,
    interior.interior_unit_specializations_ptr(),
    length,
  );
  return interiorUnitSpecializationsCache!.view;
}

export function getInteriorUnitHealthCurrent(): Uint16Array {
  const interior = getApcInterior();
  const length = interior.interior_unit_health_current_len();
  if (length === 0) return EMPTY_U16;
  interiorUnitHealthCurrentCache = cacheU16(
    interiorUnitHealthCurrentCache,
    interior.interior_unit_health_current_ptr(),
    length,
  );
  return interiorUnitHealthCurrentCache!.view;
}

export function getInteriorUnitHealthMax(): Uint16Array {
  const interior = getApcInterior();
  const length = interior.interior_unit_health_max_len();
  if (length === 0) return EMPTY_U16;
  interiorUnitHealthMaxCache = cacheU16(
    interiorUnitHealthMaxCache,
    interior.interior_unit_health_max_ptr(),
    length,
  );
  return interiorUnitHealthMaxCache!.view;
}

export function getInteriorUnitCombatSkill(): Uint16Array {
  const interior = getApcInterior();
  const length = interior.interior_unit_combat_skill_len();
  if (length === 0) return EMPTY_U16;
  interiorUnitCombatSkillCache = cacheU16(
    interiorUnitCombatSkillCache,
    interior.interior_unit_combat_skill_ptr(),
    length,
  );
  return interiorUnitCombatSkillCache!.view;
}

export function getInteriorUnitMachineOperationSkill(): Uint16Array {
  const interior = getApcInterior();
  const length = interior.interior_unit_machine_operation_skill_len();
  if (length === 0) return EMPTY_U16;
  interiorUnitMachineOperationSkillCache = cacheU16(
    interiorUnitMachineOperationSkillCache,
    interior.interior_unit_machine_operation_skill_ptr(),
    length,
  );
  return interiorUnitMachineOperationSkillCache!.view;
}

export function getInteriorUnitVehicleOperationSkill(): Uint16Array {
  const interior = getApcInterior();
  const length = interior.interior_unit_vehicle_operation_skill_len();
  if (length === 0) return EMPTY_U16;
  interiorUnitVehicleOperationSkillCache = cacheU16(
    interiorUnitVehicleOperationSkillCache,
    interior.interior_unit_vehicle_operation_skill_ptr(),
    length,
  );
  return interiorUnitVehicleOperationSkillCache!.view;
}

export function getInteriorUnitHeatCapacity(): Uint16Array {
  const interior = getApcInterior();
  const length = interior.interior_unit_heat_capacity_len();
  if (length === 0) return EMPTY_U16;
  interiorUnitHeatCapacityCache = cacheU16(
    interiorUnitHeatCapacityCache,
    interior.interior_unit_heat_capacity_ptr(),
    length,
  );
  return interiorUnitHeatCapacityCache!.view;
}

export function getInteriorUnitHeatRegenPerTick(): Uint16Array {
  const interior = getApcInterior();
  const length = interior.interior_unit_heat_regen_per_tick_len();
  if (length === 0) return EMPTY_U16;
  interiorUnitHeatRegenCache = cacheU16(
    interiorUnitHeatRegenCache,
    interior.interior_unit_heat_regen_per_tick_ptr(),
    length,
  );
  return interiorUnitHeatRegenCache!.view;
}

export function getInteriorUnitUpgradePoints(): Uint16Array {
  const interior = getApcInterior();
  const length = interior.interior_unit_upgrade_points_len();
  if (length === 0) return EMPTY_U16;
  interiorUnitUpgradePointsCache = cacheU16(
    interiorUnitUpgradePointsCache,
    interior.interior_unit_upgrade_points_ptr(),
    length,
  );
  return interiorUnitUpgradePointsCache!.view;
}

export function getInteriorUnitAssignedMachineIds(): Uint32Array {
  const interior = getApcInterior();
  const length = interior.interior_unit_assigned_machine_ids_len();
  if (length === 0) return EMPTY_U32;
  interiorUnitAssignedMachineIdsCache = cacheU32(
    interiorUnitAssignedMachineIdsCache,
    interior.interior_unit_assigned_machine_ids_ptr(),
    length,
  );
  return interiorUnitAssignedMachineIdsCache!.view;
}

export function getInteriorUnitEquipmentSlots(): Uint32Array {
  const interior = getApcInterior();
  const length = interior.interior_unit_equipment_slots_len();
  if (length === 0) return EMPTY_U32;
  interiorUnitEquipmentSlotsCache = cacheU32(
    interiorUnitEquipmentSlotsCache,
    interior.interior_unit_equipment_slots_ptr(),
    length,
  );
  return interiorUnitEquipmentSlotsCache!.view;
}

export function getInteriorUnitInventoryCapacity(): Uint16Array {
  const interior = getApcInterior();
  const length = interior.interior_unit_inventory_capacity_len();
  if (length === 0) return EMPTY_U16;
  interiorUnitInventoryCapacityCache = cacheU16(
    interiorUnitInventoryCapacityCache,
    interior.interior_unit_inventory_capacity_ptr(),
    length,
  );
  return interiorUnitInventoryCapacityCache!.view;
}

export function getInteriorUnitInventoryLoad(): Uint16Array {
  const interior = getApcInterior();
  const length = interior.interior_unit_inventory_load_len();
  if (length === 0) return EMPTY_U16;
  interiorUnitInventoryLoadCache = cacheU16(
    interiorUnitInventoryLoadCache,
    interior.interior_unit_inventory_load_ptr(),
    length,
  );
  return interiorUnitInventoryLoadCache!.view;
}

export function spawnUnit(x: number, z: number): number {
  const id = getSim().spawn_unit(x, z);
  if (id >= 0) {
    hp[id] = 100;
  }
  return id;
}