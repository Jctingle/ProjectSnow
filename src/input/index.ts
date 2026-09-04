import * as THREE from 'three';
import { getSim } from '../entityStore';
import {
  attachApcMoveCommand,
  getApcWaypointQueue,
  shiftApcWaypointQueue,
  updateApcWaypointQueue,
} from './apcMoveCommand';
import { attachClickSelect } from './clickSelect';
import { createDestinationMarkerController, createSortieMarkerController } from './destinationMarker';
import { attachKeyboardShortcuts, setSortieCommandHandler } from './keyboard';
import { createUnitSortieController } from './unitSortieCommand';

export type InputRouterController = {
  update(): void;
  shiftDestinationMarker(dx: number, dz: number): void;
  getWorldUnitPosition(unitId: number, out: THREE.Vector3): boolean;
  setSelectedUnit(unitId: number | null): void;
};

export function initInputRouter(
  camera: THREE.Camera,
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
): InputRouterController {
  const destinationMarker = createDestinationMarkerController(scene);
  const sortieMarker = createSortieMarkerController(scene);
  const sortieController = createUnitSortieController(camera, renderer, scene, sortieMarker);

  attachClickSelect(camera, renderer);
  attachApcMoveCommand(camera, renderer, destinationMarker);
  setSortieCommandHandler(() => sortieController.triggerAtCursor());
  attachKeyboardShortcuts();

  return {
    update: () => {
      updateApcWaypointQueue(destinationMarker);
      destinationMarker.updateDynamicLine();
      sortieController.update(performance.now());
    },
    shiftDestinationMarker: (dx: number, dz: number) => {
      shiftApcWaypointQueue(dx, dz);
      destinationMarker.shiftBy(dx, dz, getApcWaypointQueue(), getSim().apc_y());
      sortieController.shiftBy(dx, dz);
    },
    getWorldUnitPosition: (unitId: number, out: THREE.Vector3) =>
      sortieController.getWorldPosition(unitId, out),
    setSelectedUnit: (unitId: number | null) => {
      sortieController.setSelectedUnit(unitId);
    },
  };
}