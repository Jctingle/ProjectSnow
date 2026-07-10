import * as THREE from 'three';
import { attachApcMoveCommand } from './apcMoveCommand';
import { attachClickSelect } from './clickSelect';
import { createDestinationMarkerController } from './destinationMarker';
import { attachKeyboardShortcuts } from './keyboard';

export { gameMode } from './gameMode';
export type { GameMode } from './gameMode';

export type InputRouterController = {
  update(): void;
  clearDestinationMarker(): void;
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
      destinationMarker.update();
    },
    clearDestinationMarker: () => {
      destinationMarker.clear();
    },
  };
}