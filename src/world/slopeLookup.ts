import {
  GROUND_SIZE,
  HEIGHTMAP_GRID_SIZE,
} from '../sim/config';

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
