import {
  GROUND_SIZE,
  HEIGHTMAP_GRID_SIZE,
  SLOPE_CLIFF_THRESHOLD_DEG,
  SLOPE_PASSABLE_MAX_DEG,
} from '../sim/config';

export type SlopeTier = 'passable' | 'rolling' | 'cliff';

export function classifySlopeTier(deg: number): SlopeTier {
  if (deg <= SLOPE_PASSABLE_MAX_DEG) return 'passable';
  if (deg < SLOPE_CLIFF_THRESHOLD_DEG) return 'rolling';
  return 'cliff';
}

// Looks up the nearest slopemap grid cell for a given world (x, z), using
// the same normalization generate_heightmap uses on the Rust side (grid_w-1
// divisions over GROUND_SIZE). Deliberately position-based, not raw-index-
// based - see Task 3 note on why index correspondence isn't assumed.
export function nearestSlopeAt(
  slopemap: Float32Array,
  x: number,
  z: number
): number {
  const gridSize = HEIGHTMAP_GRID_SIZE;
  const fx = (x / GROUND_SIZE + 0.5) * (gridSize - 1);
  const fz = (z / GROUND_SIZE + 0.5) * (gridSize - 1);
  const col = Math.min(Math.max(Math.round(fx), 0), gridSize - 1);
  const row = Math.min(Math.max(Math.round(fz), 0), gridSize - 1);
  return slopemap[row * gridSize + col];
}
