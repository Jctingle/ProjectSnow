import * as THREE from 'three';
import { getSim, getSlopemap } from '../entityStore';
import { GRADIENT_B_RED_START_DEG } from '../sim/config';
import { HEIGHTMAP_GRID_SIZE } from '../sim/config';
import { gameMode } from './gameMode';
import { getGroundClickPoint } from './raycast';
import { isValidDestination } from './destinationValidity';
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

    const slopemap = getSlopemap(HEIGHTMAP_GRID_SIZE, HEIGHTMAP_GRID_SIZE);

    const destinationValidity = isValidDestination(
      worldPoint.x,
      worldPoint.z,
      GRADIENT_B_RED_START_DEG,
      slopemap,
    );
    if (!destinationValidity.valid) {
      destinationMarker.clear();
      // Future feedback hook: cursor deny state and reject SFX.
      return;
    }

    const sim = getSim();
    sim.set_apc_target(worldPoint.x, worldPoint.z);

    const markerPoint = new THREE.Vector3(
      sim.apc_target_x(),
      worldPoint.y,
      sim.apc_target_z(),
    );
    destinationMarker.showAt(markerPoint);
  });
}
