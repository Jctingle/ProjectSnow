import {
  APC_GRID_CELL_SIZE,
  GROUND_SIZE,
  HEIGHTMAP_GRID_SIZE,
  SLOPE_CLIFF_THRESHOLD_DEG,
} from '../sim/config';
import {
  getHeightmap,
  getNeighborHeightmap,
  getNeighborSlopemap,
  getSlopemap,
} from '../entityStore';
import { classifySlopeTier, nearestSlopeAt } from '../world/slopeLookup';

export type SegmentValidity = { valid: boolean; reason?: 'cliff' | 'unavailable' };

type WorldPoint = { x: number; z: number };
type RelativeShardOffset = { dr: number; dc: number };
type TerrainSlice = {
  from: WorldPoint;
  to: WorldPoint;
  shard: RelativeShardOffset;
};
type TerrainViews = {
  slopemap: Float32Array;
  heightmap: Float32Array;
};

const DDA_EPSILON = 1e-6;
const SEGMENT_SAMPLE_SUBDIVISIONS = 2;
const HALF_GROUND = GROUND_SIZE * 0.5;

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

function shardOffsetForWorldPoint(x: number, z: number): RelativeShardOffset {
  return {
    dc: Math.floor((x + HALF_GROUND) / GROUND_SIZE),
    dr: Math.floor((z + HALF_GROUND) / GROUND_SIZE),
  };
}

function localizePointToShard(
  point: WorldPoint,
  shard: RelativeShardOffset,
): WorldPoint {
  return {
    x: point.x - shard.dc * GROUND_SIZE,
    z: point.z - shard.dr * GROUND_SIZE,
  };
}

function getTerrainViews(shard: RelativeShardOffset): TerrainViews | null {
  const width = HEIGHTMAP_GRID_SIZE;
  const height = HEIGHTMAP_GRID_SIZE;
  if (shard.dr === 0 && shard.dc === 0) {
    return {
      slopemap: getSlopemap(width, height),
      heightmap: getHeightmap(width, height),
    };
  }

  const slopemap = getNeighborSlopemap(shard.dr, shard.dc, width, height);
  const heightmap = getNeighborHeightmap(shard.dr, shard.dc, width, height);
  if (!slopemap || !heightmap) return null;
  return { slopemap, heightmap };
}

function isCliffCell(slopemap: Float32Array, col: number, row: number): boolean {
  return classifySlopeTier(slopemap[row * HEIGHTMAP_GRID_SIZE + col]) === 'cliff';
}

function interpolatedSlopeAtGrid(
  slopemap: Float32Array,
  gridX: number,
  gridZ: number,
): number {
  const minIndex = 0;
  const maxIndex = HEIGHTMAP_GRID_SIZE - 1;
  const x0 = Math.min(Math.max(Math.floor(gridX), minIndex), maxIndex);
  const z0 = Math.min(Math.max(Math.floor(gridZ), minIndex), maxIndex);
  const x1 = Math.min(x0 + 1, maxIndex);
  const z1 = Math.min(z0 + 1, maxIndex);
  const tx = Math.min(Math.max(gridX - x0, 0), 1);
  const tz = Math.min(Math.max(gridZ - z0, 0), 1);
  const i00 = z0 * HEIGHTMAP_GRID_SIZE + x0;
  const i10 = z0 * HEIGHTMAP_GRID_SIZE + x1;
  const i01 = z1 * HEIGHTMAP_GRID_SIZE + x0;
  const i11 = z1 * HEIGHTMAP_GRID_SIZE + x1;
  const top = slopemap[i00] * (1 - tx) + slopemap[i10] * tx;
  const bottom = slopemap[i01] * (1 - tx) + slopemap[i11] * tx;
  return top * (1 - tz) + bottom * tz;
}

function interpolatedHeightAtGrid(
  heightmap: Float32Array,
  gridX: number,
  gridZ: number,
): number {
  const minIndex = 0;
  const maxIndex = HEIGHTMAP_GRID_SIZE - 1;
  const x0 = Math.min(Math.max(Math.floor(gridX), minIndex), maxIndex);
  const z0 = Math.min(Math.max(Math.floor(gridZ), minIndex), maxIndex);
  const x1 = Math.min(x0 + 1, maxIndex);
  const z1 = Math.min(z0 + 1, maxIndex);
  const tx = Math.min(Math.max(gridX - x0, 0), 1);
  const tz = Math.min(Math.max(gridZ - z0, 0), 1);
  const i00 = z0 * HEIGHTMAP_GRID_SIZE + x0;
  const i10 = z0 * HEIGHTMAP_GRID_SIZE + x1;
  const i01 = z1 * HEIGHTMAP_GRID_SIZE + x0;
  const i11 = z1 * HEIGHTMAP_GRID_SIZE + x1;
  const top = heightmap[i00] * (1 - tx) + heightmap[i10] * tx;
  const bottom = heightmap[i01] * (1 - tx) + heightmap[i11] * tx;
  return top * (1 - tz) + bottom * tz;
}

function hasCliffAlongContinuousSegment(
  slopemap: Float32Array,
  startX: number,
  startZ: number,
  endX: number,
  endZ: number,
): boolean {
  const deltaX = endX - startX;
  const deltaZ = endZ - startZ;
  const sampleCount = Math.max(
    1,
    Math.ceil(
      Math.max(Math.abs(deltaX), Math.abs(deltaZ)) * SEGMENT_SAMPLE_SUBDIVISIONS,
    ),
  );

  for (let index = 0; index <= sampleCount; index += 1) {
    const t = index / sampleCount;
    const sampleX = startX + deltaX * t;
    const sampleZ = startZ + deltaZ * t;
    if (
      classifySlopeTier(
        interpolatedSlopeAtGrid(slopemap, sampleX, sampleZ),
      ) === 'cliff'
    ) {
      return true;
    }
  }

  return false;
}

function hasCliffGradeAlongSegment(
  heightmap: Float32Array,
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
): boolean {
  const distance = Math.hypot(toX - fromX, toZ - fromZ);
  const sampleCount = Math.max(1, Math.ceil(distance / APC_GRID_CELL_SIZE));
  let previousX = fromX;
  let previousZ = fromZ;
  let previousHeight = interpolatedHeightAtGrid(
    heightmap,
    gridCoordinate(fromX),
    gridCoordinate(fromZ),
  );

  for (let index = 1; index <= sampleCount; index += 1) {
    const t = index / sampleCount;
    const sampleX = fromX + (toX - fromX) * t;
    const sampleZ = fromZ + (toZ - fromZ) * t;
    const sampleHeight = interpolatedHeightAtGrid(
      heightmap,
      gridCoordinate(sampleX),
      gridCoordinate(sampleZ),
    );
    const horizontal = Math.hypot(sampleX - previousX, sampleZ - previousZ);
    const verticalDrop = previousHeight - sampleHeight;
    if (
      horizontal > DDA_EPSILON &&
      verticalDrop > 0 &&
      Math.atan(verticalDrop / horizontal) * (180 / Math.PI) >= SLOPE_CLIFF_THRESHOLD_DEG
    ) {
      return true;
    }

    previousX = sampleX;
    previousZ = sampleZ;
    previousHeight = sampleHeight;
  }

  return false;
}

function buildShardSlices(
  from: WorldPoint,
  to: WorldPoint,
): TerrainSlice[] {
  const startShard = shardOffsetForWorldPoint(from.x, from.z);
  const endShard = shardOffsetForWorldPoint(to.x, to.z);
  const deltaX = to.x - from.x;
  const deltaZ = to.z - from.z;
  let currentDc = startShard.dc;
  let currentDr = startShard.dr;
  const endDc = endShard.dc;
  const endDr = endShard.dr;
  const stepDc = Math.sign(deltaX);
  const stepDr = Math.sign(deltaZ);
  const deltaBoundaryDc = stepDc === 0 ? Infinity : GROUND_SIZE / Math.abs(deltaX);
  const deltaBoundaryDr = stepDr === 0 ? Infinity : GROUND_SIZE / Math.abs(deltaZ);
  const firstBoundaryX =
    stepDc > 0
      ? (currentDc + 1) * GROUND_SIZE - HALF_GROUND
      : currentDc * GROUND_SIZE - HALF_GROUND;
  const firstBoundaryZ =
    stepDr > 0
      ? (currentDr + 1) * GROUND_SIZE - HALF_GROUND
      : currentDr * GROUND_SIZE - HALF_GROUND;
  let nextBoundaryDc = stepDc === 0 ? Infinity : (firstBoundaryX - from.x) / deltaX;
  let nextBoundaryDr = stepDr === 0 ? Infinity : (firstBoundaryZ - from.z) / deltaZ;
  let tStart = 0;
  const slices: TerrainSlice[] = [];

  while (true) {
    if (currentDc === endDc && currentDr === endDr) {
      slices.push({
        from: {
          x: from.x + deltaX * tStart,
          z: from.z + deltaZ * tStart,
        },
        to,
        shard: { dr: currentDr, dc: currentDc },
      });
      return slices;
    }

    const tCross = Math.min(nextBoundaryDc, nextBoundaryDr, 1);
    slices.push({
      from: {
        x: from.x + deltaX * tStart,
        z: from.z + deltaZ * tStart,
      },
      to: {
        x: from.x + deltaX * tCross,
        z: from.z + deltaZ * tCross,
      },
      shard: { dr: currentDr, dc: currentDc },
    });

    if (tCross >= 1) {
      return slices;
    }

    if (nextBoundaryDc < nextBoundaryDr) {
      currentDc += stepDc;
      nextBoundaryDc += deltaBoundaryDc;
    } else if (nextBoundaryDr < nextBoundaryDc) {
      currentDr += stepDr;
      nextBoundaryDr += deltaBoundaryDr;
    } else {
      currentDc += stepDc;
      currentDr += stepDr;
      nextBoundaryDc += deltaBoundaryDc;
      nextBoundaryDr += deltaBoundaryDr;
    }

    tStart = tCross;
  }
}

function validateSegmentSlice(
  slice: TerrainSlice,
  terrain: TerrainViews,
): SegmentValidity {
  const localFrom = localizePointToShard(slice.from, slice.shard);
  const localTo = localizePointToShard(slice.to, slice.shard);

  if (
    Math.abs(localTo.x - localFrom.x) < DDA_EPSILON &&
    Math.abs(localTo.z - localFrom.z) < DDA_EPSILON
  ) {
    return classifySlopeTier(nearestSlopeAt(terrain.slopemap, localTo.x, localTo.z)) === 'cliff'
      ? { valid: false, reason: 'cliff' }
      : { valid: true };
  }

  const startX = clampGridCoordinate(gridCoordinate(localFrom.x));
  const startZ = clampGridCoordinate(gridCoordinate(localFrom.z));
  const endX = clampGridCoordinate(gridCoordinate(localTo.x));
  const endZ = clampGridCoordinate(gridCoordinate(localTo.z));

  if (hasCliffGradeAlongSegment(terrain.heightmap, localFrom.x, localFrom.z, localTo.x, localTo.z)) {
    return { valid: false, reason: 'cliff' };
  }

  if (hasCliffAlongContinuousSegment(terrain.slopemap, startX, startZ, endX, endZ)) {
    return { valid: false, reason: 'cliff' };
  }

  let col = cellIndex(startX);
  let row = cellIndex(startZ);
  const endCol = cellIndex(endX);
  const endRow = cellIndex(endZ);

  if (isCliffCell(terrain.slopemap, col, row)) {
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
      col += stepCol;
      row += stepRow;
      maxCol += deltaBoundaryCol;
      maxRow += deltaBoundaryRow;
    }

    if (isCliffCell(terrain.slopemap, col, row)) {
      return { valid: false, reason: 'cliff' };
    }
  }

  return { valid: true };
}

// Traverses every nearest-cell region crossed by the segment. The half-cell
// boundaries match nearestSlopeAt()'s round-based world-to-grid conversion.
export function validateSegment(
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
): SegmentValidity {
  const slices = buildShardSlices({ x: fromX, z: fromZ }, { x: toX, z: toZ });
  for (const slice of slices) {
    const terrain = getTerrainViews(slice.shard);
    if (!terrain) {
      return { valid: false, reason: 'unavailable' };
    }
    const validity = validateSegmentSlice(slice, terrain);
    if (!validity.valid) {
      return validity;
    }
  }

  return { valid: true };
}
