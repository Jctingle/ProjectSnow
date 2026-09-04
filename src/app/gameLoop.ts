import * as THREE from 'three';
import type { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { getFocusAzimuth, getFocusLevel, isFocusMode, selectedCube } from '../focusMode';
import { isCameraFollowEnabled, updateCameraFollow, updateFocusCamera } from '../input/camera';
import type { InputRouterController } from '../input';
import type { BlizzardMaskController } from '../render/blizzardMask';
import { APC_GRID_CELL_SIZE } from '../sim/config';
import { tick } from '../sim/tick';
import { setApcGridFocus, syncApcMesh } from '../world/apc';
import type { ApcInteriorView } from '../world/apcInterior';
import type { TerrainRingController } from '../features/terrain/terrainRingController';
import type { FocusUiController } from '../features/focus/focusUiController';

type SyncController = {
  sync(): void;
};

type ApcInteriorLike = {
  hull_h(): number;
  hull_w(): number;
  hull_d(): number;
};

type SimLike = {
  apc_x(): number;
  apc_y(): number;
  apc_z(): number;
};

type GameLoopOptions = {
  camera: THREE.OrthographicCamera;
  composer: EffectComposer;
  sim: SimLike;
  apcMesh: THREE.Mesh;
  apcInterior: ApcInteriorLike;
  apcInteriorView: ApcInteriorView;
  unitRosterPanel: SyncController;
  blizzardMask: BlizzardMaskController;
  inputRouter: InputRouterController;
  terrainRing: TerrainRingController;
  focusUi: FocusUiController;
};

export function startGameLoop(options: GameLoopOptions): void {
  const {
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
  } = options;

  const focusTarget = new THREE.Vector3();
  const focusOrientation = new THREE.Quaternion();

  const SIM_RATE = 1 / 60;
  let lastTime = performance.now();
  let accumulator = 0;

  const animate = (): void => {
    requestAnimationFrame(animate);

    const now = performance.now();
    const frameTime = Math.min((now - lastTime) / 1000, 0.25);
    lastTime = now;
    accumulator += frameTime;

    while (accumulator >= SIM_RATE) {
      tick(SIM_RATE);
      accumulator -= SIM_RATE;
    }

    terrainRing.update(camera, inputRouter);

    syncApcMesh(apcMesh, sim as never, frameTime);
    if (isFocusMode()) apcInteriorView.setFocusLevel(getFocusLevel());
    apcInteriorView.setCubeFocus(selectedCube());
    setApcGridFocus(apcMesh, getFocusLevel(), isFocusMode());
    apcInteriorView.sync();
    unitRosterPanel.sync();
    blizzardMask.update(sim.apc_x(), sim.apc_y(), sim.apc_z());
    if (isFocusMode()) {
      const hullH = apcInterior.hull_h();
      const focusedLevel = getFocusLevel();
      apcMesh.updateMatrixWorld();
      focusTarget.set(0, (-hullH * 0.5 + focusedLevel + 0.5) * APC_GRID_CELL_SIZE, 0);
      apcMesh.localToWorld(focusTarget);
      apcMesh.getWorldQuaternion(focusOrientation);
      updateFocusCamera(
        camera,
        focusTarget,
        focusOrientation,
        apcInterior.hull_w() * APC_GRID_CELL_SIZE,
        hullH * APC_GRID_CELL_SIZE,
        apcInterior.hull_d() * APC_GRID_CELL_SIZE,
        getFocusAzimuth(),
      );
    } else if (isCameraFollowEnabled()) {
      updateCameraFollow(camera, sim.apc_x(), sim.apc_y(), sim.apc_z());
    }
    focusUi.updateSubfocusExitButton();
    inputRouter.update();

    composer.render();
  };

  animate();
}