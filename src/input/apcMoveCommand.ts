import * as THREE from 'three';
import { getSim, getSlopemap } from '../entityStore';
import { isFocusMode } from '../focusMode';
import {
  DEBUG_INPUT_LOGGING,
  GROUND_SIZE,
  HEIGHTMAP_GRID_SIZE,
  SLOPE_CLIFF_THRESHOLD_DEG,
} from '../sim/config';
import { gameMode } from './gameMode';
import { getGroundClickPoint } from './raycast';
import { validateSegment } from './destinationValidity';
import type { DestinationMarkerController } from './destinationMarker';
import { classifySlopeTier, nearestSlopeAt } from '../world/slopeLookup';

type ShardResolution = {
  relativeDr: number;
  relativeDc: number;
  absoluteRow: number;
  absoluteCol: number;
};

type Waypoint = { x: number; z: number };

let waypointQueue: Waypoint[] = [];

export function getApcWaypointQueue(): Waypoint[] {
  return waypointQueue.map(({ x, z }) => ({ x, z }));
}

export function updateApcWaypointQueue(destinationMarker: DestinationMarkerController): void {
  if (waypointQueue.length === 0) return;

  const sim = getSim();
  const waypoint = waypointQueue[0];
  const dx = waypoint.x - sim.apc_x();
  const dz = waypoint.z - sim.apc_z();
  const touchRadius = sim.apc_touch_radius();
  if (dx * dx + dz * dz > touchRadius * touchRadius) return;

  waypointQueue.shift();
  destinationMarker.rebuild(getApcWaypointQueue(), sim.apc_y());
  const next = waypointQueue[0];
  if (next) sim.set_apc_target(next.x, next.z);
}

export function shiftApcWaypointQueue(dx: number, dz: number): void {
  for (const waypoint of waypointQueue) {
    waypoint.x += dx;
    waypoint.z += dz;
  }
}

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
  if (!DEBUG_INPUT_LOGGING) return;

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

    if (isFocusMode()) return;

    const sim = getSim();
    const apcX = sim.apc_x();
    const apcZ = sim.apc_z();
    const append = event.ctrlKey;
    if (!append) {
      waypointQueue = [];
      sim.set_apc_target(apcX, apcZ);
      destinationMarker.rebuild([], sim.apc_y());
    }

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
    if (DEBUG_INPUT_LOGGING) {
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

    const tail = waypointQueue[waypointQueue.length - 1];
    const fromX = tail?.x ?? apcX;
    const fromZ = tail?.z ?? apcZ;
    const destinationValidity = validateSegment(
      fromX,
      fromZ,
      worldPoint.x,
      worldPoint.z,
      slopemap,
    );
    if (!destinationValidity.valid) {
      logRightClick('reject:destination-validity', () => ({
        reason: destinationValidity.reason ?? 'UNKNOWN',
        clickScreen: { x: event.clientX, y: event.clientY },
        worldPoint: { x: worldPoint.x, y: worldPoint.y, z: worldPoint.z },
        resolvedShard: shard,
        distanceFromApc,
        sampledSlopeDeg,
        segmentFrom: { x: fromX, z: fromZ },
        appended: append,
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
      maxSlopeDeg: SLOPE_CLIFF_THRESHOLD_DEG,
    }));

    const wasEmpty = waypointQueue.length === 0;
    waypointQueue.push({ x: worldPoint.x, z: worldPoint.z });
    destinationMarker.rebuild(getApcWaypointQueue(), sim.apc_y());
    if (wasEmpty) {
      sim.set_apc_target(worldPoint.x, worldPoint.z);
    }

    const targetX = sim.apc_target_x();
    const targetZ = sim.apc_target_z();
    const targetShard = resolveShardForPoint(targetX, targetZ);
    const clampDelta = Math.hypot(targetX - worldPoint.x, targetZ - worldPoint.z);

    logRightClick('accept:post-set-target', () => ({
      requestedPoint: { x: worldPoint.x, z: worldPoint.z },
      actualTarget: { x: targetX, z: targetZ },
      requestedShard: shard,
      actualTargetShard: targetShard,
      distanceFromApc,
      appended: append,
      clampApplied: clampDelta > 1e-6,
      clampDelta,
    }));
  });
}
