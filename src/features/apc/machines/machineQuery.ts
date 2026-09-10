import {
  getApcMachineFootprints,
  getApcMachineIds,
  getApcMachineKinds,
  getApcSubgridOccupantIds,
  getApcSubgridOccupantKinds,
} from '../../../entityStore';
import { SUBCELLS_PER_CELL } from '../interior/interiorMath';

// Mirrors subgrid.rs; only the machine case is meaningful to the picker.
const OCCUPANT_MACHINE = 1;

export type SubcellMachine = {
  id: number;
  slot: number;
  /// Cube-local bitmask covering every subcell the machine occupies.
  footprint: number;
  kind: number;
};

/// Resolves whichever machine owns a subcell, including the merged machine that
/// grew over it. Returns null for empty subcells and for unit occupancy.
export function machineAtSubcell(cell: number, local: number): SubcellMachine | null {
  if (cell < 0 || local < 0 || local >= SUBCELLS_PER_CELL) return null;

  const occupantKinds = getApcSubgridOccupantKinds();
  const index = cell * SUBCELLS_PER_CELL + local;
  if (index >= occupantKinds.length || occupantKinds[index] !== OCCUPANT_MACHINE) return null;

  const id = getApcSubgridOccupantIds()[index];
  const ids = getApcMachineIds();
  for (let slot = 0; slot < ids.length; slot += 1) {
    if (ids[slot] !== id) continue;
    return {
      id,
      slot,
      footprint: getApcMachineFootprints()[slot],
      kind: getApcMachineKinds()[slot],
    };
  }
  return null;
}
