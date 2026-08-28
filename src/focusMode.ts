import * as THREE from 'three';
import { getApcInterior } from './entityStore';

export type CameraSnapshot = {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  up: THREE.Vector3;
  viewHeight: number;
};

/// Which interior the player is inside. Buildings reuse the APC's lattice, so
/// they enter the same mode with a different target rather than a parallel one.
export type InteriorTarget =
  | { kind: 'apc' }
  | { kind: 'building'; buildingId: number };

export type FocusModeKind = 'normal' | 'focusInterior' | 'focusCube';

let focusTarget: InteriorTarget | null = null;
let savedCamera: CameraSnapshot | null = null;
let selectedCubeCell: number | null = null;

export function getFocusModeKind(): FocusModeKind {
  if (!focusTarget) return 'normal';
  return selectedCubeCell === null ? 'focusInterior' : 'focusCube';
}

export function isFocusMode(): boolean {
  return focusTarget !== null;
}

export function isCubeFocusMode(): boolean {
  return focusTarget !== null && selectedCubeCell !== null;
}

export function selectedCube(): number | null {
  return selectedCubeCell;
}

export function getFocusTarget(): InteriorTarget | null {
  return focusTarget;
}

export function enterFocusMode(target: InteriorTarget): void {
  focusTarget = target;
  selectedCubeCell = null;
}

export function exitFocusMode(): void {
  focusTarget = null;
  selectedCubeCell = null;
}

export function enterCubeFocus(cell: number): boolean {
  if (!focusTarget || cell < 0) return false;
  selectedCubeCell = cell;
  return true;
}

export function exitCubeFocus(): void {
  selectedCubeCell = null;
}

/// Pops one focus layer per call: cube -> interior -> normal.
export function popFocusModeLevel(): FocusModeKind {
  if (!focusTarget) return 'normal';
  if (selectedCubeCell !== null) {
    selectedCubeCell = null;
    return 'focusInterior';
  }
  focusTarget = null;
  return 'normal';
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
  if (isCubeFocusMode()) return;
  focusLevel = Math.min(Math.max(0, Math.round(next)), maxFocusLevel());
}

export function scrollFocusLevel(delta: number): void {
  setFocusLevel(focusLevel + delta);
}

export function resetFocusLevel(): void {
  focusLevel = 0;
}

/// Orientation is captured explicitly rather than left to camera-follow to
/// rebuild, which it only does while following is enabled. Zoom is stored as a
/// view height so a resize during focus mode cannot restore a stale aspect.
export function saveCameraSnapshot(camera: THREE.OrthographicCamera): void {
  savedCamera = {
    position: camera.position.clone(),
    quaternion: camera.quaternion.clone(),
    up: camera.up.clone(),
    viewHeight: camera.top - camera.bottom,
  };
}

export function restoreCameraSnapshot(camera: THREE.OrthographicCamera): void {
  if (!savedCamera) return;
  const aspect = window.innerWidth / window.innerHeight;
  const height = savedCamera.viewHeight;

  camera.position.copy(savedCamera.position);
  camera.quaternion.copy(savedCamera.quaternion);
  camera.up.copy(savedCamera.up);
  camera.top    =  height * 0.5;
  camera.bottom = -height * 0.5;
  camera.right  =  height * aspect * 0.5;
  camera.left   = -height * aspect * 0.5;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
}
