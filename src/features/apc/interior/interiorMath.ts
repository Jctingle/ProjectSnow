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
