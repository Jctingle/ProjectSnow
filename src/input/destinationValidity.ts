import {
  GROUND_SIZE,
  HEIGHTMAP_GRID_SIZE,
} from '../sim/config';
import { classifySlopeTier, nearestSlopeAt } from '../world/slopeLookup';

export type SegmentValidity = { valid: boolean; reason?: 'cliff' };

const DDA_EPSILON = 1e-6;

function clampGridCoordinate(value: number): number {
  return Math.min(Math.max(value, 0), HEIGHTMAP_GRID_SIZE - 1);
}

function gridCoordinate(world: number): number {
  return (world / GROUND_SIZE + 0.5) * (HEIGHTMAP_GRID_SIZE - 1);
}

function cellIndex(gridValue: number): number {
  return Math.min(
    Math.max(Math.floor(gridValue + 0.5), 0),
    HEIGHTMAP_GRID_SIZE - 1,
  );
}

function isCliffCell(slopemap: Float32Array, col: number, row: number): boolean {
  return classifySlopeTier(slopemap[row * HEIGHTMAP_GRID_SIZE + col]) === 'cliff';
}

// Traverses every nearest-cell region crossed by the segment. The half-cell
// boundaries match nearestSlopeAt()'s round-based world-to-grid conversion.
export function validateSegment(
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  slopemap: Float32Array,
): SegmentValidity {
  if (
    Math.abs(toX - fromX) < DDA_EPSILON &&
    Math.abs(toZ - fromZ) < DDA_EPSILON
  ) {
    return classifySlopeTier(nearestSlopeAt(slopemap, toX, toZ)) === 'cliff'
      ? { valid: false, reason: 'cliff' }
      : { valid: true };
  }

  // Outside-window points are clamped in the same way as nearestSlopeAt().
  // This preserves the existing diagnostic-only outside-window behavior.
  // The validator intentionally inherits the slopemap's existing central-
  // difference accuracy; that separate grid.rs issue is out of scope here.
  const startX = clampGridCoordinate(gridCoordinate(fromX));
  const startZ = clampGridCoordinate(gridCoordinate(fromZ));
  const endX = clampGridCoordinate(gridCoordinate(toX));
  const endZ = clampGridCoordinate(gridCoordinate(toZ));

  let col = cellIndex(startX);
  let row = cellIndex(startZ);
  const endCol = cellIndex(endX);
  const endRow = cellIndex(endZ);

  if (isCliffCell(slopemap, col, row)) {
    return { valid: false, reason: 'cliff' };
  }

  const deltaX = endX - startX;
  const deltaZ = endZ - startZ;
  const stepCol = Math.sign(deltaX);
  const stepRow = Math.sign(deltaZ);
  const deltaBoundaryCol = stepCol === 0 ? Infinity : 1 / Math.abs(deltaX);
  const deltaBoundaryRow = stepRow === 0 ? Infinity : 1 / Math.abs(deltaZ);
  let nextBoundaryCol = stepCol > 0 ? col + 0.5 : col - 0.5;
  let nextBoundaryRow = stepRow > 0 ? row + 0.5 : row - 0.5;
  let maxCol = stepCol === 0 ? Infinity : (nextBoundaryCol - startX) / deltaX;
  let maxRow = stepRow === 0 ? Infinity : (nextBoundaryRow - startZ) / deltaZ;

  while (col !== endCol || row !== endRow) {
    if (maxCol < maxRow) {
      col += stepCol;
      maxCol += deltaBoundaryCol;
    } else if (maxRow < maxCol) {
      row += stepRow;
      maxRow += deltaBoundaryRow;
    } else {
      // A corner crossing enters both neighboring cells.
      col += stepCol;
      row += stepRow;
      maxCol += deltaBoundaryCol;
      maxRow += deltaBoundaryRow;
    }

    if (isCliffCell(slopemap, col, row)) {
      return { valid: false, reason: 'cliff' };
    }
  }

  return { valid: true };
}
