import * as THREE from 'three';
import {
  getHeightmap,
  getNeighborWorldNodeCategories,
  getNeighborWorldNodeCount,
  getNeighborWorldNodeDepthOrH,
  getNeighborWorldNodeFlags,
  getNeighborWorldNodeRadiusOrW,
  getNeighborWorldNodeSeeds,
  getNeighborWorldNodeSubtypes,
  getNeighborWorldNodeX,
  getNeighborWorldNodeZ,
  getNeighborHeightmap,
  getNeighborSlopemap,
  getSlopemap,
  getWorldNodeCategories,
  getWorldNodeCount,
  getWorldNodeDepthOrH,
  getWorldNodeFlags,
  getWorldNodeRadiusOrW,
  getWorldNodeSeeds,
  getWorldNodeSubtypes,
  getWorldNodeX,
  getWorldNodeZ,
} from '../../entityStore';
import type { InputRouterController } from '../../input';
import { isCameraFollowEnabled } from '../../input/camera';
import { GROUND_SIZE, HEIGHTMAP_GRID_SIZE } from '../../sim/config';
import type { Sim } from 'wasm-sim';
import { createWorldNodeDebugGroup, disposeWorldNodeDebugGroup } from './worldNodeDebug';
import {
  applyTerrainMaskTexture,
  disposeTerrainMaskTexture,
  type TerrainMaskSpec,
} from './terrainMaskOverlay';
import {
  applyTerrainCutoutFields,
  type TerrainCutoutField,
} from './terrainCutoutField';
import {
  NICKEL_BAND_SUBTYPE,
  LARGE_STRUCTURE_SUBTYPE,
  RAW_RESOURCE_CATEGORY,
  SMALL_STRUCTURE_SUBTYPE,
  STRUCTURE_CATEGORY,
  structureRotationY,
} from './worldNodeKinds';
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
const NICKEL_MASK_TINT = '#8ca8b2';

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
  const neighborNodeGroups = new Map<string, THREE.Group>();
  const keyOf = (dr: number, dc: number) => `${dr},${dc}`;

  let ground = createTerrainMesh(sim);
  let groundNodeGroup = buildCurrentWorldNodeGroup();
  applyTerrainMaskTexture(ground, { masks: buildCurrentTerrainMaskSpecs() });
  applyTerrainCutoutFields(ground, buildCurrentStructureCutoutFields());
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
    disposeTerrainMaskTexture(mesh);
    mesh.geometry.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) {
      for (const entry of material) entry.dispose();
    } else {
      material.dispose();
    }
  };

  function buildCurrentWorldNodeGroup(): THREE.Group {
    return createWorldNodeDebugGroup({
      count: getWorldNodeCount(),
      categories: getWorldNodeCategories(),
      subtypes: getWorldNodeSubtypes(),
      x: getWorldNodeX(),
      z: getWorldNodeZ(),
      radiusOrW: getWorldNodeRadiusOrW(),
      depthOrH: getWorldNodeDepthOrH(),
      seeds: getWorldNodeSeeds(),
      flags: getWorldNodeFlags(),
      heightmap: getHeightmap(HEIGHTMAP_GRID_SIZE, HEIGHTMAP_GRID_SIZE),
      heightMult: sim.height_mult(),
    });
  }

  function buildTerrainMaskSpecs(params: {
    count: number;
    categories: Uint8Array;
    subtypes: Uint8Array;
    x: Float32Array;
    z: Float32Array;
    radiusOrW: Float32Array;
    depthOrH: Float32Array;
    seeds: Uint32Array;
  }): TerrainMaskSpec[] {
    const masks: TerrainMaskSpec[] = [];
    for (let index = 0; index < params.count; index += 1) {
      if (params.categories[index] !== RAW_RESOURCE_CATEGORY) continue;
      if ((params.subtypes[index] ?? 0) !== NICKEL_BAND_SUBTYPE) continue;
      const halfWidth = params.radiusOrW[index] ?? 0;
      const halfLength = params.depthOrH[index] ?? 0;
      masks.push({
        x: params.x[index] ?? 0,
        z: params.z[index] ?? 0,
        radius: Math.max(halfWidth, halfLength),
        seed: params.seeds[index] ?? 0,
        tint: NICKEL_MASK_TINT,
      });
    }
    return masks;
  }

  function buildCurrentTerrainMaskSpecs(): TerrainMaskSpec[] {
    return buildTerrainMaskSpecs({
      count: getWorldNodeCount(),
      categories: getWorldNodeCategories(),
      subtypes: getWorldNodeSubtypes(),
      x: getWorldNodeX(),
      z: getWorldNodeZ(),
      radiusOrW: getWorldNodeRadiusOrW(),
      depthOrH: getWorldNodeDepthOrH(),
      seeds: getWorldNodeSeeds(),
    });
  }

  function buildStructureCutoutFields(params: {
    count: number;
    categories: Uint8Array;
    subtypes: Uint8Array;
    x: Float32Array;
    z: Float32Array;
    radiusOrW: Float32Array;
    depthOrH: Float32Array;
    seeds: Uint32Array;
  }): TerrainCutoutField[] {
    const fields: TerrainCutoutField[] = [];
    for (let index = 0; index < params.count; index += 1) {
      if (params.categories[index] !== STRUCTURE_CATEGORY) continue;
      const subtype = params.subtypes[index] ?? 0;
      if (subtype !== LARGE_STRUCTURE_SUBTYPE && subtype !== SMALL_STRUCTURE_SUBTYPE) continue;
      fields.push({
        x: params.x[index] ?? 0,
        z: params.z[index] ?? 0,
        halfWidth: params.radiusOrW[index] ?? 0,
        halfDepth: params.depthOrH[index] ?? 0,
        rotationY: structureRotationY(params.seeds[index] ?? 0),
      });
    }
    return fields;
  }

  function buildCurrentStructureCutoutFields(): TerrainCutoutField[] {
    return buildStructureCutoutFields({
      count: getWorldNodeCount(),
      categories: getWorldNodeCategories(),
      subtypes: getWorldNodeSubtypes(),
      x: getWorldNodeX(),
      z: getWorldNodeZ(),
      radiusOrW: getWorldNodeRadiusOrW(),
      depthOrH: getWorldNodeDepthOrH(),
      seeds: getWorldNodeSeeds(),
    });
  }

  function buildNeighborStructureCutoutFields(dr: number, dc: number): TerrainCutoutField[] {
    const count = getNeighborWorldNodeCount(dr, dc);
    if (count === 0) {
      return [];
    }

    return buildStructureCutoutFields({
      count,
      categories: getNeighborWorldNodeCategories(dr, dc),
      subtypes: getNeighborWorldNodeSubtypes(dr, dc),
      x: getNeighborWorldNodeX(dr, dc),
      z: getNeighborWorldNodeZ(dr, dc),
      radiusOrW: getNeighborWorldNodeRadiusOrW(dr, dc),
      depthOrH: getNeighborWorldNodeDepthOrH(dr, dc),
      seeds: getNeighborWorldNodeSeeds(dr, dc),
    });
  }

  function buildNeighborWorldNodeGroup(dr: number, dc: number): THREE.Group | null {
    const count = getNeighborWorldNodeCount(dr, dc);
    const heightmap = getNeighborHeightmap(dr, dc, HEIGHTMAP_GRID_SIZE, HEIGHTMAP_GRID_SIZE);
    if (!heightmap || count === 0) {
      return null;
    }

    return createWorldNodeDebugGroup({
      count,
      categories: getNeighborWorldNodeCategories(dr, dc),
      subtypes: getNeighborWorldNodeSubtypes(dr, dc),
      x: getNeighborWorldNodeX(dr, dc),
      z: getNeighborWorldNodeZ(dr, dc),
      radiusOrW: getNeighborWorldNodeRadiusOrW(dr, dc),
      depthOrH: getNeighborWorldNodeDepthOrH(dr, dc),
      seeds: getNeighborWorldNodeSeeds(dr, dc),
      flags: getNeighborWorldNodeFlags(dr, dc),
      heightmap,
      heightMult: sim.height_mult(),
    });
  }

  function buildNeighborTerrainMaskSpecs(dr: number, dc: number): TerrainMaskSpec[] {
    const count = getNeighborWorldNodeCount(dr, dc);
    if (count === 0) {
      return [];
    }

    return buildTerrainMaskSpecs({
      count,
      categories: getNeighborWorldNodeCategories(dr, dc),
      subtypes: getNeighborWorldNodeSubtypes(dr, dc),
      x: getNeighborWorldNodeX(dr, dc),
      z: getNeighborWorldNodeZ(dr, dc),
      radiusOrW: getNeighborWorldNodeRadiusOrW(dr, dc),
      depthOrH: getNeighborWorldNodeDepthOrH(dr, dc),
      seeds: getNeighborWorldNodeSeeds(dr, dc),
    });
  }

  const disposeWorldNodeGroup = (group: THREE.Group): void => {
    disposeWorldNodeDebugGroup(group);
    scene.remove(group);
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
    disposeWorldNodeGroup(groundNodeGroup);
    for (const group of neighborNodeGroups.values()) disposeWorldNodeGroup(group);
    neighborMeshes.clear();
    neighborNodeGroups.clear();
    ground = createTerrainMesh(sim);
    groundNodeGroup = buildCurrentWorldNodeGroup();
    applyTerrainMaskTexture(ground, { masks: buildCurrentTerrainMaskSpecs() });
    applyTerrainCutoutFields(ground, buildCurrentStructureCutoutFields());
    scene.add(ground);
    scene.add(groundNodeGroup);
    attachTierOverlay(ground, getSlopemap(HEIGHTMAP_GRID_SIZE, HEIGHTMAP_GRID_SIZE));
  };

  scene.add(ground);
  scene.add(groundNodeGroup);
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
        const promotedNodeGroup = neighborNodeGroups.get(crossKey);
        if (promoted) {
          neighborMeshes.delete(crossKey);
          if (promotedNodeGroup) {
            neighborNodeGroups.delete(crossKey);
          }

          const rekeyed = new Map<string, THREE.Mesh>();
          const rekeyedNodeGroups = new Map<string, THREE.Group>();
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
          for (const [key, group] of neighborNodeGroups) {
            const [dr, dc] = key.split(',').map(Number);
            const ndr = dr - crossDr;
            const ndc = dc - crossDc;
            if (Math.abs(ndr) <= 1 && Math.abs(ndc) <= 1 && !(ndr === 0 && ndc === 0)) {
              rekeyedNodeGroups.set(keyOf(ndr, ndc), group);
            } else {
              disposeWorldNodeGroup(group);
            }
          }

          rekeyed.set(keyOf(-crossDr, -crossDc), ground);
          rekeyedNodeGroups.set(keyOf(-crossDr, -crossDc), groundNodeGroup);
          ground = promoted;
          groundNodeGroup = promotedNodeGroup ?? buildCurrentWorldNodeGroup();

          neighborMeshes.clear();
          for (const [key, mesh] of rekeyed) neighborMeshes.set(key, mesh);
          neighborNodeGroups.clear();
          for (const [key, group] of rekeyedNodeGroups) neighborNodeGroups.set(key, group);
          ground.position.set(0, 0, 0);
          groundNodeGroup.position.set(0, 0, 0);
          for (const [key, mesh] of neighborMeshes) {
            const [dr, dc] = key.split(',').map(Number);
            mesh.position.set(dc * GROUND_SIZE, 0, dr * GROUND_SIZE);
          }
          for (const [key, group] of neighborNodeGroups) {
            const [dr, dc] = key.split(',').map(Number);
            group.position.set(dc * GROUND_SIZE, 0, dr * GROUND_SIZE);
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
        const nodeGroup = neighborNodeGroups.get(key);
        if (ready && !mesh && !builtThisFrame) {
          const heightmap = getNeighborHeightmap(dr, dc, HEIGHTMAP_GRID_SIZE, HEIGHTMAP_GRID_SIZE);
          if (heightmap) {
            warnIfNeighborHeightmapLooksInvalid(heightmap);
            const terrainMesh = createTerrainMeshFromGrid(heightmap, sim.height_mult());
            applyTerrainMaskTexture(terrainMesh, { masks: buildNeighborTerrainMaskSpecs(dr, dc) });
            applyTerrainCutoutFields(terrainMesh, buildNeighborStructureCutoutFields(dr, dc));
            const slopemap = getNeighborSlopemap(dr, dc, HEIGHTMAP_GRID_SIZE, HEIGHTMAP_GRID_SIZE);
            if (slopemap) attachTierOverlay(terrainMesh, slopemap);
            terrainMesh.position.x = dc * GROUND_SIZE;
            terrainMesh.position.z = dr * GROUND_SIZE;
            scene.add(terrainMesh);
            neighborMeshes.set(key, terrainMesh);
            const group = buildNeighborWorldNodeGroup(dr, dc);
            if (group) {
              group.position.set(dc * GROUND_SIZE, 0, dr * GROUND_SIZE);
              scene.add(group);
              neighborNodeGroups.set(key, group);
            }
            builtThisFrame = true;
          }
        } else if (!ready) {
          if (mesh) {
            disposeTerrainMesh(mesh);
            neighborMeshes.delete(key);
          }
          if (nodeGroup) {
            disposeWorldNodeGroup(nodeGroup);
            neighborNodeGroups.delete(key);
          }
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