import * as THREE from 'three';
import { getRaycastPoint } from './raycast';

export function attachClickSelect(
  camera: THREE.Camera,
  renderer: THREE.WebGLRenderer,
  ground: THREE.Mesh,
): void {
  const canvas = renderer.domElement;

  canvas.addEventListener('click', (event: MouseEvent) => {
    if (event.button !== 0) {
      return;
    }

    const worldPoint = getRaycastPoint(event, camera, renderer, ground);
    if (!worldPoint) {
      return;
    }

    // TODO: entity/building hit detection.
  });
}
