import * as THREE from 'three';
import './style.css';
import { getNextHeightmap, getSim, getSlopemap } from './entityStore';
import { initCameraControls } from './input/camera';
import { initInputRouter } from './input/index';
import { instancedUnits, syncInstancedMesh } from './render/instancedUnits';
import { GROUND_SIZE, HEIGHTMAP_GRID_SIZE } from './sim/config';
import { initSim, tick, regenerateTerrain, refreshHeightmap } from './sim/tick';
import { createDevPanel } from './ui/devPanel';
import { createApcMesh, syncApcMesh } from './world/apc';
import { applySlopeDebugColors, clearSlopeDebugColors } from './world/terrainDebug';
import { createTerrainMesh, createTerrainMeshFromGrid } from './world/terrain';
import { spawnInitialUnits } from './world/units';

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
camera.position.set(10, 10, 10);
camera.lookAt(0, 0, 0);

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

// APC starts parked where it is
sim.set_apc_target(sim.apc_x(), sim.apc_z());

// terrain
let ground = createTerrainMesh(sim);
scene.add(ground);
let slopeDebugOn = false;
let nextGround: THREE.Mesh | null = null;
let nextShardKey: string | null = null;
let prevShardRow = sim.current_shard_row();
let prevShardCol = sim.current_shard_col();
let hasRunNextHeightmapSanityCheck = false;

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

function warnIfNextHeightmapLooksInvalid(heightmap: Float32Array): void {
  if (hasRunNextHeightmapSanityCheck) return;
  hasRunNextHeightmapSanityCheck = true;

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
  ground = createTerrainMesh(sim);
  scene.add(ground);
  if (slopeDebugOn) {
    applySlopeDebugColors(
      ground,
      getSlopemap(HEIGHTMAP_GRID_SIZE, HEIGHTMAP_GRID_SIZE)
    );
  }
}

const updateInputRouter = initInputRouter(camera, renderer, scene);

// APC
const apcMesh = createApcMesh();
scene.add(apcMesh);

// units
scene.add(instancedUnits);
spawnInitialUnits();

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
    } else {
      clearSlopeDebugColors(ground);
    }
  }
);

// sim loop
const SIM_RATE = 1 / 60;
let lastTime   = performance.now();
let accumulator = 0;

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

  const currentShardRow = sim.current_shard_row();
  const currentShardCol = sim.current_shard_col();
  const didCrossShard =
    currentShardRow !== prevShardRow || currentShardCol !== prevShardCol;
  prevShardRow = currentShardRow;
  prevShardCol = currentShardCol;

  const nextReady = sim.next_shard_ready();
  if (nextReady) {
    const nextDr = sim.next_shard_dr();
    const nextDc = sim.next_shard_dc();
    const key = `${nextDr},${nextDc}`;

    if (nextGround === null || nextShardKey !== key) {
      if (nextGround) {
        disposeTerrainMesh(nextGround);
        nextGround = null;
        nextShardKey = null;
      }

      const nextHeightmap = getNextHeightmap(
        HEIGHTMAP_GRID_SIZE,
        HEIGHTMAP_GRID_SIZE
      );

      if (nextHeightmap) {
        warnIfNextHeightmapLooksInvalid(nextHeightmap);
        nextGround = createTerrainMeshFromGrid(nextHeightmap, sim.height_mult());
        nextGround.position.x = nextDc * GROUND_SIZE;
        nextGround.position.z = nextDr * GROUND_SIZE;
        scene.add(nextGround);
        nextShardKey = key;
      }
    }
  }

  if (didCrossShard) {
    rebuildGroundMesh();
    if (nextGround) {
      disposeTerrainMesh(nextGround);
      nextGround = null;
      nextShardKey = null;
    }
  }

  if (!nextReady && nextGround) {
    disposeTerrainMesh(nextGround);
    nextGround = null;
    nextShardKey = null;
  }

  syncApcMesh(apcMesh, sim);
  updateInputRouter();

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