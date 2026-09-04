import * as THREE from 'three';
import {
  exitCubeFocus,
  getFocusModeKind,
  isFocusMode,
  selectedCube,
  restoreCameraSnapshot,
  saveCameraSnapshot,
  enterFocusMode,
  exitFocusMode,
  resetFocusAzimuth,
  resetFocusLevel,
} from '../../focusMode';
import { resetCameraPan, updateCameraFollow } from '../../input/camera';
import {
  setFocusModeChangedHandler,
  setFocusModeEnterHandler,
  setResetViewHandler,
} from '../../input/keyboard';
import type { ApcInteriorView } from '../../world/apcInterior';
import {
  setApcGridVisible,
  setApcHullCutaway,
} from '../../world/apc';
import { APC_GRID_CELL_SIZE } from '../../sim/config';
import { clearSelection } from '../../input/selection';
import type { Sim } from 'wasm-sim';

export type FocusUiController = {
  updateSubfocusExitButton(): void;
};

type FocusUiOptions = {
  camera: THREE.OrthographicCamera;
  sim: Sim;
  apcMesh: THREE.Mesh;
  apcInterior: ReturnType<typeof import('../../entityStore').getApcInterior>;
  apcInteriorView: ApcInteriorView;
  isApcGridEnabled: () => boolean;
};

export function createFocusUiController(options: FocusUiOptions): FocusUiController {
  const {
    camera,
    sim,
    apcMesh,
    apcInterior,
    apcInteriorView,
    isApcGridEnabled,
  } = options;

  const subfocusExitButton = document.createElement('button');
  subfocusExitButton.textContent = 'Exit Cell';
  subfocusExitButton.style.cssText =
    'position:fixed; z-index:16; padding:6px 10px; border:1px solid rgba(255,255,255,0.24); border-radius:999px; background:rgba(10,18,28,0.58); color:#f4f7ff; font-family:monospace; font-size:12px; cursor:pointer; backdrop-filter:blur(3px); transform:translate(-50%, -100%); display:none;';
  document.body.appendChild(subfocusExitButton);

  const focusButton = document.createElement('button');
  focusButton.textContent = 'Focus APC Interior';
  focusButton.style.cssText =
    'position:fixed; top:12px; right:180px; z-index:10; padding:8px 12px; font-family:sans-serif; font-size:13px; cursor:pointer;';
  document.body.appendChild(focusButton);

  const subfocusButtonWorld = new THREE.Vector3();

  const applyFocusUiState = (): void => {
    const mode = getFocusModeKind();
    if (mode === 'normal') {
      restoreCameraSnapshot(camera);
      apcInteriorView.setCubeFocus(null);
      apcInteriorView.setSelectedCell(-1);
      apcInteriorView.setSelectedSubcell(-1);
      apcInteriorView.setSubfocusEnabled(false);
      setApcGridVisible(apcMesh, isApcGridEnabled());
      setApcHullCutaway(apcMesh, false);
      focusButton.textContent = 'Focus APC Interior';
      return;
    }

    if (mode === 'focusInterior') {
      apcInteriorView.setCubeFocus(null);
      apcInteriorView.setSelectedCell(-1);
      apcInteriorView.setSelectedSubcell(-1);
    }

    apcInteriorView.setSubfocusEnabled(true);
    setApcGridVisible(apcMesh, true);
    setApcHullCutaway(apcMesh, true);
    focusButton.textContent = 'Exit Focus Mode';
  };

  const resetToDefaultView = (): void => {
    clearSelection();
    if (isFocusMode()) {
      exitFocusMode();
      applyFocusUiState();
    }
    resetCameraPan();
    updateCameraFollow(camera, sim.apc_x(), sim.apc_y(), sim.apc_z());
  };

  const enterApcFocusMode = (): void => {
    if (isFocusMode()) return;
    saveCameraSnapshot(camera);
    resetFocusAzimuth();
    resetFocusLevel();
    enterFocusMode({ kind: 'apc' });
    apcInteriorView.setFocusLevel(0);
    applyFocusUiState();
  };

  subfocusExitButton.addEventListener('click', () => {
    if (selectedCube() === null) return;
    exitCubeFocus();
    applyFocusUiState();
  });

  focusButton.addEventListener('click', () => {
    if (!isFocusMode()) {
      enterApcFocusMode();
      return;
    }
    exitFocusMode();
    applyFocusUiState();
  });

  setFocusModeChangedHandler(() => {
    applyFocusUiState();
  });
  setResetViewHandler(resetToDefaultView);
  setFocusModeEnterHandler(enterApcFocusMode);

  return {
    updateSubfocusExitButton(): void {
      const cubeCell = selectedCube();
      if (!isFocusMode() || cubeCell === null) {
        subfocusExitButton.style.display = 'none';
        return;
      }

      const envelopeW = apcInterior.envelope_w();
      const envelopeD = apcInterior.envelope_d();
      const levelStride = envelopeW * envelopeD;
      const y = Math.floor(cubeCell / levelStride);
      const remainder = cubeCell % levelStride;
      const x = remainder % envelopeW;
      const z = Math.floor(remainder / envelopeW);

      subfocusButtonWorld.set(
        -apcInterior.hull_w() * APC_GRID_CELL_SIZE * 0.5 + (x + 0.5) * APC_GRID_CELL_SIZE,
        -apcInterior.hull_h() * APC_GRID_CELL_SIZE * 0.5 + (y + 1.45) * APC_GRID_CELL_SIZE,
        -apcInterior.hull_d() * APC_GRID_CELL_SIZE * 0.5 + (z + 0.5) * APC_GRID_CELL_SIZE,
      );
      apcMesh.localToWorld(subfocusButtonWorld);
      subfocusButtonWorld.project(camera);

      if (subfocusButtonWorld.z < -1 || subfocusButtonWorld.z > 1) {
        subfocusExitButton.style.display = 'none';
        return;
      }

      subfocusExitButton.style.display = 'block';
      subfocusExitButton.style.left = `${(subfocusButtonWorld.x * 0.5 + 0.5) * window.innerWidth}px`;
      subfocusExitButton.style.top = `${(-subfocusButtonWorld.y * 0.5 + 0.5) * window.innerHeight}px`;
    },
  };
}