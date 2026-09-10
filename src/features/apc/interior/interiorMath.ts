import * as THREE from 'three';
import { getApcInterior } from '../../../entityStore';
import { APC_GRID_CELL_SIZE } from '../../../sim/config';

export type InteriorHull = { w: number; h: number; d: number };

export function readInteriorHull(): InteriorHull {
  const interior = getApcInterior();
  return { w: interior.hull_w(), h: interior.hull_h(), d: interior.hull_d() };
}

export function displayInteriorLevel(cellY: number): number {
  return cellY;
}

export function cellCentre(
  x: number,
  y: number,
  z: number,
  hull: InteriorHull,
  out: THREE.Vector3,
): THREE.Vector3 {
  const size = APC_GRID_CELL_SIZE;
  return out.set(
    -hull.w * size * 0.5 + (x + 0.5) * size,
    -hull.h * size * 0.5 + (y + 0.5) * size,
    -hull.d * size * 0.5 + (z + 0.5) * size,
  );
}

export function subcellOffset(local: number, size: number, out: THREE.Vector3): THREE.Vector3 {
  const x = local & 1;
  const z = (local >> 1) & 1;
  const y = (local >> 2) & 1;
  const half = size * 0.25;
  return out.set(
    x === 0 ? -half : half,
    y === 0 ? -half : half,
    z === 0 ? -half : half,
  );
}

export const SUBCELLS_PER_CELL = 8;

/// Mirrors `Subgrid::local_index`: x is bit 0, z is bit 1, y is bit 2.
export function subcellLocalIndex(x: number, y: number, z: number): number {
  return x + 2 * (z + 2 * y);
}

/// Resolves a cube-local footprint bitmask into the offset from the cell centre
/// and the span, in subcells, of the box it fills. Machines occupy 1, 2, 4, or
/// 8 subcells, so one instanced subcell box scaled by the span covers them all.
export function footprintTransform(
  footprint: number,
  size: number,
  outOffset: THREE.Vector3,
  outSpan: THREE.Vector3,
): boolean {
  const min = [2, 2, 2];
  const max = [-1, -1, -1];
  let occupied = false;

  for (let local = 0; local < SUBCELLS_PER_CELL; local += 1) {
    if ((footprint & (1 << local)) === 0) continue;
    occupied = true;
    const coords = [local & 1, (local >> 2) & 1, (local >> 1) & 1];
    for (let axis = 0; axis < 3; axis += 1) {
      if (coords[axis] < min[axis]) min[axis] = coords[axis];
      if (coords[axis] > max[axis]) max[axis] = coords[axis];
    }
  }
  if (!occupied) return false;

  const quarter = size * 0.25;
  outOffset.set(
    (min[0] + max[0] - 1) * quarter,
    (min[1] + max[1] - 1) * quarter,
    (min[2] + max[2] - 1) * quarter,
  );
  outSpan.set(max[0] - min[0] + 1, max[1] - min[1] + 1, max[2] - min[2] + 1);
  return true;
}

export function cellToCoords(cell: number): { x: number; y: number; z: number } | null {
  if (cell < 0) return null;
  const interior = getApcInterior();
  const stride = interior.envelope_w() * interior.envelope_d();
  const y = Math.floor(cell / stride);
  const remainder = cell % stride;
  return {
    x: remainder % interior.envelope_w(),
    y,
    z: Math.floor(remainder / interior.envelope_w()),
  };
}
