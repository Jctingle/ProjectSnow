import * as THREE from 'three';
import { isFocusMode } from '../focusMode';
import { GROUND_SIZE } from '../sim/config';

const MIN_VIEW_SIZE = 1.0;
const MAX_VIEW_SIZE = GROUND_SIZE * 1.25;
const ZOOM_SENSITIVITY = 0.001;
const isoOffset = new THREE.Vector3(10, 10, 10);
let panOffset = new THREE.Vector3(0, 0, 0);
let cameraFollowEnabled = true;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function updateCameraFollow(
  camera: THREE.OrthographicCamera,
  ax: number,
  ay: number,
  az: number,
): void {
  camera.position.set(
    ax + panOffset.x + isoOffset.x,
    ay + panOffset.y + isoOffset.y,
    az + panOffset.z + isoOffset.z,
  );
  camera.lookAt(ax + panOffset.x, ay, az + panOffset.z);
  camera.updateMatrixWorld();
}

export function setCameraFollowEnabled(enabled: boolean): void {
  cameraFollowEnabled = enabled;
}

export function isCameraFollowEnabled(): boolean {
  return cameraFollowEnabled;
}

/// Drops accumulated panning so the next follow update recentres on the APC.
export function resetCameraPan(): void {
  panOffset.set(0, 0, 0);
}

const FOCUS_PADDING = 2.1;
const FOCUS_MIN_VIEW_SIZE = 0.5;
// Fixed elevation of the halo ring, matching the (1,1,1) iso angle the default azimuth starts at.
const FOCUS_ELEVATION = Math.asin(1 / Math.sqrt(3));
const FOCUS_HORIZ = Math.cos(FOCUS_ELEVATION);

const focusDirection = new THREE.Vector3();
const focusUp = new THREE.Vector3();

// Frames the APC hull tightly, scaling to hull size so it stays valid as the hull grows.
// The ring and the camera's up vector are built in the APC's own frame, so terrain
// tilt moves the vehicle without changing how it is presented on screen.
export function updateFocusCamera(
  camera: THREE.OrthographicCamera,
  target: THREE.Vector3,
  orientation: THREE.Quaternion,
  hullWidth: number,
  hullHeight: number,
  hullLength: number,
  azimuth: number,
): void {
  const aspect = window.innerWidth / window.innerHeight;
  const radius =
    0.5 * Math.sqrt(hullWidth * hullWidth + hullHeight * hullHeight + hullLength * hullLength);
  const viewSize = Math.max(radius * FOCUS_PADDING, FOCUS_MIN_VIEW_SIZE);

  camera.top    =  viewSize * 0.5;
  camera.bottom = -viewSize * 0.5;
  camera.right  =  viewSize * aspect * 0.5;
  camera.left   = -viewSize * aspect * 0.5;

  const distance = radius * 4 + 1;
  focusDirection
    .set(
      FOCUS_HORIZ * Math.cos(azimuth),
      Math.sin(FOCUS_ELEVATION),
      FOCUS_HORIZ * Math.sin(azimuth),
    )
    .applyQuaternion(orientation);
  focusUp.set(0, 1, 0).applyQuaternion(orientation);

  // Assigned before lookAt, which derives the camera basis from it.
  camera.up.copy(focusUp);
  camera.position.copy(target).addScaledVector(focusDirection, distance);
  camera.lookAt(target);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
}

export function initCameraControls(
  camera: THREE.OrthographicCamera,
  canvas: HTMLCanvasElement,
): void {
  let isPanning = false;
  let lastX = 0;
  let lastY = 0;

  const right = new THREE.Vector3();
  const forward = new THREE.Vector3();

  canvas.addEventListener('mousedown', (event: MouseEvent) => {
    if (event.button !== 1 || isFocusMode()) return;
    event.preventDefault();
    isPanning = true;
    lastX = event.clientX;
    lastY = event.clientY;
  });

  window.addEventListener('mousemove', (event: MouseEvent) => {
    if (!isPanning) return;

    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;

    const worldPerPixel = (camera.top - camera.bottom) / window.innerHeight;

    // right vector from camera matrix column 0, flattened to XZ
    right.setFromMatrixColumn(camera.matrixWorld, 0);
    right.y = 0;
    right.normalize();

    // forward vector from camera matrix column 1, flattened to XZ
    forward.setFromMatrixColumn(camera.matrixWorld, 1);
    forward.y = 0;
    forward.normalize();

    const panDx = -dx * worldPerPixel;
    const panDz = dy * worldPerPixel * Math.SQRT2;
    panOffset.addScaledVector(right, panDx);
    panOffset.addScaledVector(forward, panDz);

    if (!cameraFollowEnabled) {
      camera.position.addScaledVector(right, panDx);
      camera.position.addScaledVector(forward, panDz);
      camera.updateMatrixWorld();
    }
  });

  const endPan = (): void => {
    isPanning = false;
  };

  window.addEventListener('mouseup', endPan);
  canvas.addEventListener('mouseleave', endPan);

  canvas.addEventListener(
    'wheel',
    (event: WheelEvent) => {
      event.preventDefault();

      if (isFocusMode()) return;

      const aspect = window.innerWidth / window.innerHeight;
      const currentViewSize = camera.top - camera.bottom;
      const scaled = currentViewSize * Math.exp(event.deltaY * ZOOM_SENSITIVITY);
      const next = clamp(scaled, MIN_VIEW_SIZE, MAX_VIEW_SIZE);

      camera.top    =  next * 0.5;
      camera.bottom = -next * 0.5;
      camera.right  =  next * aspect * 0.5;
      camera.left   = -next * aspect * 0.5;
      camera.updateProjectionMatrix();
    },
    { passive: false },
  );

  window.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.code === 'Home' || event.code === 'KeyF') {
      resetCameraPan();
    }
  });
}