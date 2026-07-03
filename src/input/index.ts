import * as THREE from 'three';
// import { apc } from '../entityStore';
import { getRaycastPoint } from './raycast';
import { clearSelection } from './selection';
import { getSim } from '../entityStore';

export type GameMode =
  | { type: 'freeRoam' }
  | { type: 'subLevel'; buildingId: number; currentFloor: number };

export let gameMode: GameMode = { type: 'freeRoam' };

export function initInputRouter(
  camera: THREE.Camera,
  renderer: THREE.WebGLRenderer,
): void {
  const canvas = renderer.domElement;

  canvas.addEventListener('click', (event: MouseEvent) => {
    if (event.button !== 0) {
      return;
    }

    const worldPoint = getRaycastPoint(event, camera, renderer);
    if (!worldPoint) {
      return;
    }

    // TODO: entity/building hit detection.
  });

  canvas.addEventListener('contextmenu', (event: MouseEvent) => {
    event.preventDefault();

    if (gameMode.type !== 'freeRoam') {
      return;
    }

    const worldPoint = getRaycastPoint(event, camera, renderer);
    if (!worldPoint) {
      return;
    }


  getSim().set_apc_target(worldPoint.x, worldPoint.z);
  });

  window.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key !== 'Escape') {
      return;
    }

    clearSelection();

    if (gameMode.type === 'subLevel') {
      gameMode = { type: 'freeRoam' };
    }
  });
}