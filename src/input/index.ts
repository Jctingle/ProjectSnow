import * as THREE from 'three';
import { getSim } from '../entityStore';
import {
  attachApcMoveCommand,
  getApcWaypointQueue,
  shiftApcWaypointQueue,
  updateApcWaypointQueue,
} from './apcMoveCommand';
import { attachClickSelect } from './clickSelect';
import { createDestinationMarkerController } from './destinationMarker';
import { attachKeyboardShortcuts } from './keyboard';

export { gameMode } from './gameMode';
export type { GameMode } from './gameMode';

export type InputRouterController = {
  update(): void;
  shiftDestinationMarker(dx: number, dz: number): void;
};

export function initInputRouter(
  camera: THREE.Camera,
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
): InputRouterController {
  const destinationMarker = createDestinationMarkerController(scene);

  attachClickSelect(camera, renderer);
  attachApcMoveCommand(camera, renderer, destinationMarker);
  attachKeyboardShortcuts();

  return {
    update: () => {
      updateApcWaypointQueue(destinationMarker);
      destinationMarker.updateDynamicLine();
    },
    shiftDestinationMarker: (dx: number, dz: number) => {
      shiftApcWaypointQueue(dx, dz);
      destinationMarker.shiftBy(dx, dz, getApcWaypointQueue(), getSim().apc_y());
    },
  };
}