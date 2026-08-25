import * as THREE from 'three';
import { getApcInterior } from './entityStore';

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

// Sub-focus: the single floor the player is currently interacting with.
// The sim always runs the whole interior; this only selects what is drawn.
let focusLevel = 0;

function maxFocusLevel(): number {
  return Math.max(0, getApcInterior().hull_h() - 1);
}

export function getFocusLevel(): number {
  return focusLevel;
}

export function setFocusLevel(next: number): void {
  focusLevel = Math.min(Math.max(0, Math.round(next)), maxFocusLevel());
}

export function scrollFocusLevel(delta: number): void {
  setFocusLevel(focusLevel + delta);
}

export function resetFocusLevel(): void {
  focusLevel = 0;
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
