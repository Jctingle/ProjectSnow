import * as THREE from 'three';

export type CameraSnapshot = {
  position: THREE.Vector3;
  left: number;
  right: number;
  top: number;
  bottom: number;
};

let focusModeActive = false;
let savedCamera: CameraSnapshot | null = null;

export function isFocusMode(): boolean {
  return focusModeActive;
}

export function setFocusMode(active: boolean): void {
  focusModeActive = active;
}

// Halo-ring orbit: azimuth-only rotation around the APC at a fixed elevation.
const DEFAULT_FOCUS_AZIMUTH = Math.PI / 4;
let focusAzimuth = DEFAULT_FOCUS_AZIMUTH;

export function getFocusAzimuth(): number {
  return focusAzimuth;
}

export function rotateFocusAzimuth(delta: number): void {
  focusAzimuth += delta;
}

export function resetFocusAzimuth(): void {
  focusAzimuth = DEFAULT_FOCUS_AZIMUTH;
}

export function saveCameraSnapshot(camera: THREE.OrthographicCamera): void {
  savedCamera = {
    position: camera.position.clone(),
    left: camera.left,
    right: camera.right,
    top: camera.top,
    bottom: camera.bottom,
  };
}

export function getCameraSnapshot(): CameraSnapshot | null {
  return savedCamera;
}

export function restoreCameraSnapshot(camera: THREE.OrthographicCamera): void {
  if (!savedCamera) return;
  camera.position.copy(savedCamera.position);
  camera.left = savedCamera.left;
  camera.right = savedCamera.right;
  camera.top = savedCamera.top;
  camera.bottom = savedCamera.bottom;
  camera.updateProjectionMatrix();
}
