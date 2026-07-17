import * as THREE from 'three';
import './style.css';
import { getNeighborHeightmap, getNeighborSlopemap, getSim, getSlopemap } from './entityStore';
import { initCameraControls, setCameraFollowEnabled, updateCameraFollow } from './input/camera';
import { initInputRouter } from './input/index';
import { instancedUnits, syncInstancedMesh } from './render/instancedUnits';
import { GROUND_SIZE, HEIGHTMAP_GRID_SIZE } from './sim/config';
import { initSim, tick, regenerateTerrain, refreshHeightmap } from './sim/tick';
import { createDevPanel, updateDeployedCount } from './ui/devPanel';
import { createApcMesh, syncApcMesh } from './world/apc';
import { applySlopeDebugColors, clearSlopeDebugColors } from './world/terrainDebug';
import { createTerrainMesh, createTerrainMeshFromGrid } from './world/terrain';

const scene    = new THREE.Scene();
const aspect   = window.innerWidth / window.innerHeight;
const viewSize = 10;
const depthRange = GROUND_SIZE * 4;
const camera   = new THREE.OrthographicCamera(
  (-viewSize * aspect) / 2,
  (viewSize * aspect) / 2,
   viewSize / 2,
  -viewSize / 2,
  -depthRange,
  depthRange
);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// lights
const dirLight = new THREE.DirectionalLight(0xffffff, 2);
dirLight.intensity = 1.5;
dirLight.position.set(2, 2, 2);
scene.add(dirLight);
const ambient = new THREE.HemisphereLight(0xffffff, 0x888888, 0.6);
scene.add(ambient);

await initSim(); // initSim already builds the cached heightmap
const sim = getSim();

initCameraControls(camera, renderer.domElement);
updateCameraFollow(camera, sim.apc_x(), sim.apc_y(), sim.apc_z());

// APC starts parked where it is
sim.set_apc_target(sim.apc_x(), sim.apc_z());

// terrain
let ground = createTerrainMesh(sim);
scene.add(ground);
let slopeDebugOn = false;
const NEIGHBOR_KEYS: [number, number][] = [
  [0, 1], [0, -1], [1, 0], [-1, 0],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];
const neighborMeshes = new Map<string, THREE.Mesh>();
const keyOf = (dr: number, dc: number) => `${dr},${dc}`;
let prevShardRow = sim.current_shard_row();
let prevShardCol = sim.current_shard_col();
let hasRunNeighborHeightmapSanityCheck = false;
let cameraFollowOn = true;

function disposeTerrainMesh(mesh: THREE.Mesh): void {
  scene.remove(mesh);
  mesh.geometry.dispose();
  const material = mesh.material;
  if (Array.isArray(material)) {
    for (const m of material) m.dispose();
  } else {
    material.dispose();
  }
}

function warnIfNeighborHeightmapLooksInvalid(heightmap: Float32Array): void {
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
    ({ value }) => !Number.isFinite(value) || value <= -10 || value >= 50
  );

  if (bad.length > 0) {
    console.warn(
      '[next-shard] heightmap sanity check failed: sampled values look invalid.',
      { samples }
    );
  }
}

function rebuildGroundMesh(): void {
  disposeTerrainMesh(ground);
  for (const mesh of neighborMeshes.values()) disposeTerrainMesh(mesh);
  neighborMeshes.clear();
  ground = createTerrainMesh(sim);
  scene.add(ground);
  if (slopeDebugOn) {
    applySlopeDebugColors(
      ground,
      getSlopemap(HEIGHTMAP_GRID_SIZE, HEIGHTMAP_GRID_SIZE)
    );
  }
}

const inputRouter = initInputRouter(camera, renderer, scene);

// APC
const apcMesh = createApcMesh();
scene.add(apcMesh);

// units
scene.add(instancedUnits);

const regenButton = document.createElement('button');
regenButton.textContent = 'Regenerate Terrain';
regenButton.style.cssText =
  'position:fixed; top:12px; right:12px; z-index:10; padding:8px 12px; font-family:sans-serif; font-size:13px; cursor:pointer;';
document.body.appendChild(regenButton);

const seedLabel = document.createElement('div');
seedLabel.style.cssText =
  'position:fixed; top:48px; right:12px; z-index:10; padding:4px 8px; font-family:monospace; font-size:12px; color:#fff; background:rgba(0,0,0,0.5); border-radius:4px;';
seedLabel.textContent = 'seed: (default)';
document.body.appendChild(seedLabel);

regenButton.addEventListener('click', () => {
  const seed = regenerateTerrain();
  seedLabel.textContent = `seed: ${seed}`;
  console.log('[terrain] regenerated with seed', seed);
  rebuildGroundMesh();
});

createDevPanel(
  sim,
  () => {
    refreshHeightmap();
    rebuildGroundMesh();
  },
  (checked) => {
    slopeDebugOn = checked;
    if (checked) {
      applySlopeDebugColors(
        ground,
        getSlopemap(HEIGHTMAP_GRID_SIZE, HEIGHTMAP_GRID_SIZE)
      );
      for (const [key, mesh] of neighborMeshes) {
        const [dr, dc] = key.split(',').map(Number);
        const sm = getNeighborSlopemap(dr, dc, HEIGHTMAP_GRID_SIZE, HEIGHTMAP_GRID_SIZE);
        if (sm) applySlopeDebugColors(mesh, sm);
      }
    } else {
      clearSlopeDebugColors(ground);
      for (const mesh of neighborMeshes.values()) clearSlopeDebugColors(mesh);
    }
  },
  (recallActive) => {
    if (recallActive) {
      sim.set_unit_recall(true);
    } else {
      sim.set_unit_recall(false);
      sim.deploy_all_units();
    }
  },
  (followActive) => {
    cameraFollowOn = followActive;
    setCameraFollowEnabled(followActive);
  }
);
updateDeployedCount(sim.deployed_unit_count());

// sim loop
const SIM_RATE = 1 / 60;
let lastTime   = performance.now();
let accumulator = 0;
let nextDeployedCountUpdateAtMs = 0;

function animate() {
  requestAnimationFrame(animate);

  const now = performance.now();
  let frameTime = Math.min((now - lastTime) / 1000, 0.25);
  lastTime = now;
  accumulator += frameTime;

  while (accumulator >= SIM_RATE) {
    tick(SIM_RATE);
    accumulator -= SIM_RATE;
  }

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
    if (!cameraFollowOn) {
      camera.position.x += shiftX;
      camera.position.z += shiftZ;
      camera.updateMatrixWorld();
    }

    const crossKey = keyOf(crossDr, crossDc);
    const promoted = neighborMeshes.get(crossKey);
    if (promoted) {
      neighborMeshes.delete(crossKey);

      // 1. Re-key REMAINING neighbors first — old ground is not yet inserted.
      //    Inserting it first would clobber the existing mesh at the back key
      //    without disposal (orphaned mesh overlay) and then double-shift it
      //    out of ring, disposing the mesh that should be the back neighbor.
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

      // 2. Now place old ground as back neighbor. Safe: the only pre-cross key
      //    that re-keys to (-crossDr,-crossDc) would be (0,0), which is never
      //    in the map, so this slot is guaranteed empty after step 1.
      rekeyed.set(keyOf(-crossDr, -crossDc), ground);
      ground = promoted;

      neighborMeshes.clear();
      for (const [k, m] of rekeyed) neighborMeshes.set(k, m);
      ground.position.set(0, 0, 0);
      for (const [k, m] of neighborMeshes) {
        const [dr, dc] = k.split(',').map(Number);
        m.position.set(dc * GROUND_SIZE, 0, dr * GROUND_SIZE);
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
      const hm = getNeighborHeightmap(dr, dc, HEIGHTMAP_GRID_SIZE, HEIGHTMAP_GRID_SIZE);
      if (hm) {
        warnIfNeighborHeightmapLooksInvalid(hm);
        const m = createTerrainMeshFromGrid(hm, sim.height_mult());
        if (slopeDebugOn) {
          const sm = getNeighborSlopemap(dr, dc, HEIGHTMAP_GRID_SIZE, HEIGHTMAP_GRID_SIZE);
          if (sm) applySlopeDebugColors(m, sm);
        }
        m.position.x = dc * GROUND_SIZE;
        m.position.z = dr * GROUND_SIZE;
        scene.add(m);
        neighborMeshes.set(key, m);
        builtThisFrame = true;
      }
    } else if (!ready && mesh) {
      disposeTerrainMesh(mesh);
      neighborMeshes.delete(key);
    }
  }

  if (import.meta.env.DEV) {
    const terrainCount = scene.children.filter(
      (c) => c !== ground && (c as THREE.Mesh).userData?.isTerrainMesh
    ).length;
    if (terrainCount !== neighborMeshes.size) {
      console.error(
        `[ring] mesh/map desync: ${terrainCount} terrain meshes in scene, ` +
        `${neighborMeshes.size} tracked`
      );
    }
  }

  syncApcMesh(apcMesh, sim);
  if (cameraFollowOn) {
    updateCameraFollow(camera, sim.apc_x(), sim.apc_y(), sim.apc_z());
  }
  inputRouter.update();

  if (now >= nextDeployedCountUpdateAtMs) {
    updateDeployedCount(sim.deployed_unit_count());
    nextDeployedCountUpdateAtMs = now + 250;
  }

  syncInstancedMesh();
  renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => {
  const aspect = window.innerWidth / window.innerHeight;
  const currentViewSize = camera.top - camera.bottom;
  camera.left   = (-currentViewSize * aspect) / 2;
  camera.right  = ( currentViewSize * aspect) / 2;
  camera.top    =   currentViewSize / 2;
  camera.bottom =  -currentViewSize / 2;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});