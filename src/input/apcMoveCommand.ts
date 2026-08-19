import * as THREE from 'three';
import { getSim, getSlopemap } from '../entityStore';
import {
  DEBUG_INPUT_LOGGING,
  GRADIENT_B_RED_START_DEG,
  GROUND_SIZE,
  HEIGHTMAP_GRID_SIZE,
} from '../sim/config';
import { gameMode } from './gameMode';
import { getGroundClickPoint } from './raycast';
import { isStandable } from './destinationValidity';
import type { DestinationMarkerController } from './destinationMarker';
import { classifySlopeTier, nearestSlopeAt } from '../world/slopeLookup';

type ShardResolution = {
  relativeDr: number;
  relativeDc: number;
  absoluteRow: number;
  absoluteCol: number;
};

function resolveShardForPoint(x: number, z: number): ShardResolution {
  const sim = getSim();
  const halfExtent = GROUND_SIZE * 0.5;
  const relativeDc = Math.floor((x + halfExtent) / GROUND_SIZE);
  const relativeDr = Math.floor((z + halfExtent) / GROUND_SIZE);
  return {
    relativeDr,
    relativeDc,
    absoluteRow: sim.current_shard_row() + relativeDr,
    absoluteCol: sim.current_shard_col() + relativeDc,
  };
}

function logRightClick(stage: string, payloadFactory: () => Record<string, unknown>): void {
  if (!DEBUG_INPUT_LOGGING) return;
  console.debug('[diag:right-click]', stage, payloadFactory());
}

// DIAGNOSTIC - TEMPORARY - remove after slope classification investigation
// Prints raw cached slopemap tiers without involving Three.js rendering.
function dumpTierNeighborhood(
  slopemap: Float32Array,
  centerCol: number,
  centerRow: number,
  radius: number = 4,
): void {
  const gridSize = HEIGHTMAP_GRID_SIZE;
  let output = '';
  for (let row = centerRow - radius; row <= centerRow + radius; row++) {
    let line = '';
    for (let col = centerCol - radius; col <= centerCol + radius; col++) {
      if (row < 0 || row >= gridSize || col < 0 || col >= gridSize) {
        line += ' ? ';
        continue;
      }
      const deg = slopemap[row * gridSize + col];
      const tier = classifySlopeTier(deg);
      line += tier === 'passable' ? ' P ' : tier === 'rolling' ? ' R ' : ' C ';
    }
    output += line + '\n';
  }
  console.log(
    `[TIER GRID] center(${centerCol},${centerRow}) radius=${radius}\n${output}`
  );
}

export function attachApcMoveCommand(
  camera: THREE.Camera,
  renderer: THREE.WebGLRenderer,
  destinationMarker: DestinationMarkerController,
): void {
  const canvas = renderer.domElement;

  canvas.addEventListener('contextmenu', (event: MouseEvent) => {
    event.preventDefault();

    const sim = getSim();
    const apcX = sim.apc_x();
    const apcZ = sim.apc_z();

    if (gameMode.type !== 'freeRoam') {
      logRightClick('reject:game-mode', () => ({
        reason: 'gameMode.type !== freeRoam',
        mode: gameMode.type,
        clickScreen: { x: event.clientX, y: event.clientY },
        worldPoint: null,
        resolvedShard: null,
        distanceFromApc: null,
      }));
      return;
    }

    const worldPoint = getGroundClickPoint(event, camera, renderer);
    if (!worldPoint) {
      logRightClick('reject:raycast-null', () => ({
        reason: 'getGroundClickPoint returned null',
        clickScreen: { x: event.clientX, y: event.clientY },
        worldPoint: null,
        resolvedShard: null,
        distanceFromApc: null,
      }));
      return;
    }

    const shard = resolveShardForPoint(worldPoint.x, worldPoint.z);
    const distanceFromApc = Math.hypot(worldPoint.x - apcX, worldPoint.z - apcZ);

    destinationMarker.showAt(worldPoint);

    const slopemap = getSlopemap(HEIGHTMAP_GRID_SIZE, HEIGHTMAP_GRID_SIZE);
    const sampledSlopeDeg = nearestSlopeAt(slopemap, worldPoint.x, worldPoint.z);

    // Use the same nearest-cell normalization as nearestSlopeAt().
    const gridSize = HEIGHTMAP_GRID_SIZE;
    const col = Math.min(
      Math.max(
        Math.round((worldPoint.x / GROUND_SIZE + 0.5) * (gridSize - 1)),
        0,
      ),
      gridSize - 1,
    );
    const row = Math.min(
      Math.max(
        Math.round((worldPoint.z / GROUND_SIZE + 0.5) * (gridSize - 1)),
        0,
      ),
      gridSize - 1,
    );
    dumpTierNeighborhood(slopemap, col, row);

    // DIAGNOSTIC - TEMPORARY - remove after slope classification investigation
    // Compares cached slopemap values against the authoritative Rust point query
    // and reports whether the click falls outside the current shard's cache.
    {
      const cached = sampledSlopeDeg;
      const live = sim.slope_degrees_at(worldPoint.x, worldPoint.z);
      // The Rust sim rebases the active shard to local origin on crossing;
      // current terrain and its cached maps are always centered at (0, 0).
      const shardOriginX = 0;
      const shardOriginZ = 0;
      const localX = worldPoint.x - shardOriginX;
      const localZ = worldPoint.z - shardOriginZ;
      const halfGround = GROUND_SIZE / 2;
      const outsideCachedWindow =
        Math.abs(localX) > halfGround || Math.abs(localZ) > halfGround;
      const delta = Math.abs(cached - live);

      console.log(
        `[SLOPE DIAG] world(${worldPoint.x.toFixed(2)}, ${worldPoint.z.toFixed(2)}) ` +
        `local(${localX.toFixed(2)}, ${localZ.toFixed(2)}) ` +
        `${outsideCachedWindow ? '⚠ OUTSIDE-WINDOW ' : ''}` +
        `cached=${cached.toFixed(2)}° live=${live.toFixed(2)}° delta=${delta.toFixed(2)}° ` +
        `tier(cached)=${classifySlopeTier(cached)} tier(live)=${classifySlopeTier(live)}`
      );
    }

    const destinationValidity = isStandable(
      worldPoint.x,
      worldPoint.z,
      GRADIENT_B_RED_START_DEG,
      slopemap,
    );
    if (!destinationValidity.valid) {
      destinationMarker.clear();
      logRightClick('reject:destination-validity', () => ({
        reason: destinationValidity.reason ?? 'UNKNOWN',
        clickScreen: { x: event.clientX, y: event.clientY },
        worldPoint: { x: worldPoint.x, y: worldPoint.y, z: worldPoint.z },
        resolvedShard: shard,
        distanceFromApc,
        sampledSlopeDeg,
        maxSlopeDeg: GRADIENT_B_RED_START_DEG,
      }));
      // Future feedback hook: cursor deny state and reject SFX.
      return;
    }

    logRightClick('accept:pre-set-target', () => ({
      clickScreen: { x: event.clientX, y: event.clientY },
      worldPoint: { x: worldPoint.x, y: worldPoint.y, z: worldPoint.z },
      resolvedShard: shard,
      distanceFromApc,
      sampledSlopeDeg,
      maxSlopeDeg: GRADIENT_B_RED_START_DEG,
    }));

    sim.set_apc_target(worldPoint.x, worldPoint.z);

    const targetX = sim.apc_target_x();
    const targetZ = sim.apc_target_z();
    const targetShard = resolveShardForPoint(targetX, targetZ);
    const clampDelta = Math.hypot(targetX - worldPoint.x, targetZ - worldPoint.z);

    const markerPoint = new THREE.Vector3(
      targetX,
      worldPoint.y,
      targetZ,
    );
    destinationMarker.showAt(markerPoint);

    logRightClick('accept:post-set-target', () => ({
      requestedPoint: { x: worldPoint.x, z: worldPoint.z },
      actualTarget: { x: targetX, z: targetZ },
      requestedShard: shard,
      actualTargetShard: targetShard,
      distanceFromApc,
      clampApplied: clampDelta > 1e-6,
      clampDelta,
    }));
  });
}
