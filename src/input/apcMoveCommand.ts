import * as THREE from 'three';
import { getSim } from '../entityStore';
import { gameMode } from './gameMode';
import { getGroundClickPoint } from './raycast';
import type { DestinationMarkerController } from './destinationMarker';

export function attachApcMoveCommand(
  camera: THREE.Camera,
  renderer: THREE.WebGLRenderer,
  destinationMarker: DestinationMarkerController,
): void {
  const canvas = renderer.domElement;

  canvas.addEventListener('contextmenu', (event: MouseEvent) => {
    event.preventDefault();

    if (gameMode.type !== 'freeRoam') {
      return;
    }

    const worldPoint = getGroundClickPoint(event, camera, renderer);
    if (!worldPoint) {
      return;
    }

    destinationMarker.showAt(worldPoint);
    getSim().set_apc_target(worldPoint.x, worldPoint.z);
  });
}
