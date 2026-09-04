import './style.css';
import {
  getApcInterior,
  spawnRandomInteriorUnit,
  UnitSpecialization,
} from './entityStore';
import { bootstrapApp } from './app/bootstrap';
import { startGameLoop } from './app/gameLoop';
import { createTerrainRingController } from './features/terrain/terrainRingController';
import { resetCameraPan, setCameraFollowEnabled, updateCameraFollow } from './input/camera';
import { initInputRouter } from './input/index';
import { attachFocusOrbitControls } from './input/focusOrbit';
import { attachFocusFloorControls } from './input/focusFloor';
import { attachInteriorPicking } from './input/interiorPick';
import {
  isFocusMode,
} from './focusMode';
import { getSelectedUnitId, subscribeSelectionChanged, toggleUnitSelection } from './input/selection';
import { createFocusUiController } from './features/focus/focusUiController';
import { createBlizzardMask } from './render/blizzardMask';
import { APC_GRID_CELL_SIZE } from './sim/config';
import { regenerateTerrain, refreshHeightmap } from './sim/tick';
import { createDevPanel } from './ui/devPanel';
import { createUnitRosterPanel } from './ui/unitRosterPanel';
import { createApcMesh, resizeApcMesh, setApcGridVisible, setApcHullVisible } from './world/apc';
import { createApcInteriorView } from './world/apcInterior';

const { scene, camera, renderer, composer, tiltShift, sim } = await bootstrapApp();

let apcGridOn = false;
const terrainRing = createTerrainRingController(scene, sim);

const inputRouter = initInputRouter(camera, renderer, scene);

// APC
const apcMesh = createApcMesh();
scene.add(apcMesh);

const apcInterior = getApcInterior();

const apcInteriorView = createApcInteriorView();
apcMesh.add(apcInteriorView.group);
const unitRosterPanel = createUnitRosterPanel(
  (unitId) => {
    toggleUnitSelection(unitId);
  },
  (visible) => {
    apcInteriorView.setExteriorUnitsVisible(visible);
  },
);
const blizzardMask = createBlizzardMask();
scene.add(blizzardMask.mesh);

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
  terrainRing.rebuildGroundMesh();
});

const focusUi = createFocusUiController({
  camera,
  sim,
  apcMesh,
  apcInterior,
  apcInteriorView,
  isApcGridEnabled: () => apcGridOn,
});

subscribeSelectionChanged(() => {
  const selectedUnitId = getSelectedUnitId();
  apcInteriorView.setSelectedUnit(selectedUnitId);
  inputRouter.setSelectedUnit(selectedUnitId);
});

attachFocusOrbitControls(renderer.domElement);
attachFocusFloorControls(renderer.domElement);
attachInteriorPicking(renderer.domElement, camera, apcInteriorView);

createDevPanel(
  sim,
  () => {
    refreshHeightmap();
    terrainRing.rebuildGroundMesh();
  },
  (checked) => {
    terrainRing.setSlopeDebugVisible(checked);
  },
  (followActive) => {
    setCameraFollowEnabled(followActive);
  },
  () => {
    resetCameraPan();
    // Applied immediately so the button also recentres while follow is off.
    updateCameraFollow(camera, sim.apc_x(), sim.apc_y(), sim.apc_z());
  },
  (settings) => {
    blizzardMask.setSettings(settings);
  },
  (enabled) => {
    tiltShift.setEnabled(enabled);
  },
  (settings) => {
    tiltShift.setSettings(settings);
  },
  (enabled) => {
    console.log('[debug] console output', enabled ? 'enabled' : 'disabled');
  },
  (visible) => {
    apcGridOn = visible;
    setApcGridVisible(apcMesh, visible || isFocusMode());
  },
  (cells, reset) => {
    if (reset) {
      apcInterior.reset_hull_extent(cells.x, cells.y, cells.z);
    } else {
      apcInterior.set_hull_extent(cells.x, cells.y, cells.z);
    }
    resizeApcMesh(apcMesh, {
      width: apcInterior.hull_w() * APC_GRID_CELL_SIZE,
      height: apcInterior.hull_h() * APC_GRID_CELL_SIZE,
      length: apcInterior.hull_d() * APC_GRID_CELL_SIZE,
    });
    apcInteriorView.rebuild();
  },
  (visible) => {
    apcInteriorView.setLabelsVisible(visible);
  },
  (visible) => {
    setApcHullVisible(apcMesh, visible);
  },
  () => {
    const createdId = spawnRandomInteriorUnit(UnitSpecialization.Generalist);
    if (createdId >= 0) {
      apcInteriorView.rebuild();
    }
  },
);

startGameLoop({
  camera,
  composer,
  sim,
  apcMesh,
  apcInterior,
  apcInteriorView,
  unitRosterPanel,
  blizzardMask,
  inputRouter,
  terrainRing,
  focusUi,
});

window.addEventListener('resize', () => {
  const aspect = window.innerWidth / window.innerHeight;
  const currentViewSize = camera.top - camera.bottom;
  camera.left   = (-currentViewSize * aspect) / 2;
  camera.right  = ( currentViewSize * aspect) / 2;
  camera.top    =   currentViewSize / 2;
  camera.bottom =  -currentViewSize / 2;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  tiltShift.setResolution(window.innerWidth, window.innerHeight);
});

if (import.meta.env.DEV) {
  Object.assign(window as Window & { __tiltShiftDebug?: unknown }, {
    __tiltShiftDebug: {
      isEnabled: () => tiltShift.isEnabled(),
      isPassAttached: () => tiltShift.isPassAttached(),
      getLiveUniforms: () => tiltShift.getLiveUniforms(),
    },
  });
}