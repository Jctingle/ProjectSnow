import * as THREE from 'three';
import { attachApcMoveCommand } from './apcMoveCommand';
import { attachClickSelect } from './clickSelect';
import { createDestinationMarkerController } from './destinationMarker';
import { attachKeyboardShortcuts } from './keyboard';

export { gameMode } from './gameMode';
export type { GameMode } from './gameMode';

export function initInputRouter(
  camera: THREE.Camera,
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
): () => void {
  const destinationMarker = createDestinationMarkerController(scene);

  attachClickSelect(camera, renderer);
  attachApcMoveCommand(camera, renderer, destinationMarker);
  attachKeyboardShortcuts();

  return () => {
    destinationMarker.update();
  };
}