import * as THREE from 'three';
import { GROUND_SIZE } from '../sim/config';

const MIN_VIEW_SIZE = 5;
const MAX_VIEW_SIZE = GROUND_SIZE * 1.25;
const ZOOM_SENSITIVITY = 0.001;
const isoOffset = new THREE.Vector3(10, 10, 10);
let panOffset = new THREE.Vector3(0, 0, 0);

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
    if (event.button !== 1) return;
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

    panOffset.addScaledVector(right, -dx * worldPerPixel);
    panOffset.addScaledVector(forward, dy * worldPerPixel * Math.SQRT2);
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
      panOffset.set(0, 0, 0);
    }
  });
}