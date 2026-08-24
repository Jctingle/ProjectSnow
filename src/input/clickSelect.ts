import * as THREE from 'three';
import { isFocusMode } from '../focusMode';
import { getGroundClickPoint } from './raycast';

export function attachClickSelect(
  camera: THREE.Camera,
  renderer: THREE.WebGLRenderer,
): void {
  const canvas = renderer.domElement;

  canvas.addEventListener('click', (event: MouseEvent) => {
    if (event.button !== 0) {
      return;
    }

    if (isFocusMode()) {
      return;
    }

    const worldPoint = getGroundClickPoint(event, camera, renderer);
    if (!worldPoint) {
      return;
    }

    // TODO: entity/building hit detection.
  });
}
