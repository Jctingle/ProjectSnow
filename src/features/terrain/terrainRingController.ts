import * as THREE from 'three';
import {
  getNeighborHeightmap,
  getNeighborSlopemap,
  getSlopemap,
} from '../../entityStore';
import type { InputRouterController } from '../../input';
import { isCameraFollowEnabled } from '../../input/camera';
import { GROUND_SIZE, HEIGHTMAP_GRID_SIZE } from '../../sim/config';
import type { Sim } from 'wasm-sim';
import { createTerrainMesh, createTerrainMeshFromGrid } from '../../world/terrain';
import {
  createTierOverlayMesh,
  disposeTierOverlayMesh,
  setTierOverlayVisible,
} from '../../world/terrainTierOverlay';

const NEIGHBOR_KEYS: [number, number][] = [
  [0, 1], [0, -1], [1, 0], [-1, 0],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

export type TerrainRingController = {
  rebuildGroundMesh(): void;
  setSlopeDebugVisible(visible: boolean): void;
  update(camera: THREE.OrthographicCamera, inputRouter: InputRouterController): void;
};

export function createTerrainRingController(
  scene: THREE.Scene,
  sim: Sim,
): TerrainRingController {
  const tierOverlays = new Map<THREE.Mesh, THREE.Mesh>();
  const neighborMeshes = new Map<string, THREE.Mesh>();
  const keyOf = (dr: number, dc: number) => `${dr},${dc}`;

  let ground = createTerrainMesh(sim);
  let slopeDebugOn = false;
  let prevShardRow = sim.current_shard_row();
  let prevShardCol = sim.current_shard_col();
  let hasRunNeighborHeightmapSanityCheck = false;

  const attachTierOverlay = (mesh: THREE.Mesh, slopemap: Float32Array): void => {
    const overlay = createTierOverlayMesh(mesh, slopemap);
    overlay.visible = slopeDebugOn;
    mesh.add(overlay);
    tierOverlays.set(mesh, overlay);
  };

  const disposeTerrainMesh = (mesh: THREE.Mesh): void => {
    disposeTierOverlayMesh(tierOverlays.get(mesh));
    tierOverlays.delete(mesh);
    scene.remove(mesh);
    mesh.geometry.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) {
      for (const entry of material) entry.dispose();
    } else {
      material.dispose();
    }
  };

  const warnIfNeighborHeightmapLooksInvalid = (heightmap: Float32Array): void => {
    if (hasRunNeighborHeightmapSanityCheck) return;
    hasRunNeighborHeightmapSanityCheck = true;

    const length = heightmap.length;
    if (length === 0) {
      console.warn('[next-shard] heightmap sanity check failed: empty next-heightmap view.');
      return;
    }

    const indices = [
      0,
      Math.floor(length * 0.25),
      Math.floor(length * 0.5),
      length - 1,
    ];
    const samples = indices.map((idx) => ({ idx, value: heightmap[idx] }));
    const bad = samples.filter(
      ({ value }) => !Number.isFinite(value) || value <= -10 || value >= 50,
    );

    if (bad.length > 0) {
      console.warn(
        '[next-shard] heightmap sanity check failed: sampled values look invalid.',
        { samples },
      );
    }
  };

  const rebuildGroundMesh = (): void => {
    disposeTerrainMesh(ground);
    for (const mesh of neighborMeshes.values()) disposeTerrainMesh(mesh);
    neighborMeshes.clear();
    ground = createTerrainMesh(sim);
    scene.add(ground);
    attachTierOverlay(ground, getSlopemap(HEIGHTMAP_GRID_SIZE, HEIGHTMAP_GRID_SIZE));
  };

  scene.add(ground);
  attachTierOverlay(ground, getSlopemap(HEIGHTMAP_GRID_SIZE, HEIGHTMAP_GRID_SIZE));

  return {
    rebuildGroundMesh,
    setSlopeDebugVisible(visible: boolean) {
      slopeDebugOn = visible;
      setTierOverlayVisible(tierOverlays.get(ground), visible);
      for (const mesh of neighborMeshes.values()) {
        setTierOverlayVisible(tierOverlays.get(mesh), visible);
      }
    },
    update(camera: THREE.OrthographicCamera, inputRouter: InputRouterController): void {
      const prevBeforeUpdateRow = prevShardRow;
      const prevBeforeUpdateCol = prevShardCol;
      const currentShardRow = sim.current_shard_row();
      const currentShardCol = sim.current_shard_col();
      const didCrossShard =
        currentShardRow !== prevBeforeUpdateRow || currentShardCol !== prevBeforeUpdateCol;
      const crossDr = currentShardRow - prevBeforeUpdateRow;
      const crossDc = currentShardCol - prevBeforeUpdateCol;
      const shiftX = -(currentShardCol - prevBeforeUpdateCol) * GROUND_SIZE;
      const shiftZ = -(currentShardRow - prevBeforeUpdateRow) * GROUND_SIZE;
      prevShardRow = currentShardRow;
      prevShardCol = currentShardCol;

      if (didCrossShard) {
        inputRouter.shiftDestinationMarker(shiftX, shiftZ);
        if (!isCameraFollowEnabled()) {
          camera.position.x += shiftX;
          camera.position.z += shiftZ;
          camera.updateMatrixWorld();
        }

        const crossKey = keyOf(crossDr, crossDc);
        const promoted = neighborMeshes.get(crossKey);
        if (promoted) {
          neighborMeshes.delete(crossKey);

          const rekeyed = new Map<string, THREE.Mesh>();
          for (const [key, mesh] of neighborMeshes) {
            const [dr, dc] = key.split(',').map(Number);
            const ndr = dr - crossDr;
            const ndc = dc - crossDc;
            if (Math.abs(ndr) <= 1 && Math.abs(ndc) <= 1 && !(ndr === 0 && ndc === 0)) {
              rekeyed.set(keyOf(ndr, ndc), mesh);
            } else {
              disposeTerrainMesh(mesh);
            }
          }

          rekeyed.set(keyOf(-crossDr, -crossDc), ground);
          ground = promoted;

          neighborMeshes.clear();
          for (const [key, mesh] of rekeyed) neighborMeshes.set(key, mesh);
          ground.position.set(0, 0, 0);
          for (const [key, mesh] of neighborMeshes) {
            const [dr, dc] = key.split(',').map(Number);
            mesh.position.set(dc * GROUND_SIZE, 0, dr * GROUND_SIZE);
          }
        } else {
          rebuildGroundMesh();
        }
      }

      let builtThisFrame = false;
      for (const [dr, dc] of NEIGHBOR_KEYS) {
        const key = keyOf(dr, dc);
        const ready = sim.neighbor_ready(dr, dc);
        const mesh = neighborMeshes.get(key);
        if (ready && !mesh && !builtThisFrame) {
          const heightmap = getNeighborHeightmap(dr, dc, HEIGHTMAP_GRID_SIZE, HEIGHTMAP_GRID_SIZE);
          if (heightmap) {
            warnIfNeighborHeightmapLooksInvalid(heightmap);
            const terrainMesh = createTerrainMeshFromGrid(heightmap, sim.height_mult());
            const slopemap = getNeighborSlopemap(dr, dc, HEIGHTMAP_GRID_SIZE, HEIGHTMAP_GRID_SIZE);
            if (slopemap) attachTierOverlay(terrainMesh, slopemap);
            terrainMesh.position.x = dc * GROUND_SIZE;
            terrainMesh.position.z = dr * GROUND_SIZE;
            scene.add(terrainMesh);
            neighborMeshes.set(key, terrainMesh);
            builtThisFrame = true;
          }
        } else if (!ready && mesh) {
          disposeTerrainMesh(mesh);
          neighborMeshes.delete(key);
        }
      }

      if (import.meta.env.DEV) {
        const terrainCount = scene.children.filter(
          (child) => child !== ground && (child as THREE.Mesh).userData?.isTerrainMesh,
        ).length;
        if (terrainCount !== neighborMeshes.size) {
          console.error(
            `[ring] mesh/map desync: ${terrainCount} terrain meshes in scene, ` +
            `${neighborMeshes.size} tracked`,
          );
        }
      }
    },
  };
}