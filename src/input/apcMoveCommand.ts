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
import { nearestSlopeAt } from '../world/slopeLookup';

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
