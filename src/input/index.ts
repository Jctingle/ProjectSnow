import * as THREE from 'three';
// import { apc } from '../entityStore';
import { getRaycastPoint } from './raycast';
import { clearSelection } from './selection';
import { getSim } from '../entityStore';

export type GameMode =
  | { type: 'freeRoam' }
  | { type: 'subLevel'; buildingId: number; currentFloor: number };

export let gameMode: GameMode = { type: 'freeRoam' };

const APC_TOUCH_RADIUS = 0.3;
const APC_TOUCH_RADIUS_SQ = APC_TOUCH_RADIUS * APC_TOUCH_RADIUS;

type DebugMarkerState = {
  marker: THREE.Mesh;
  targetX: number;
  targetZ: number;
};

export function initInputRouter(
  camera: THREE.Camera,
  renderer: THREE.WebGLRenderer,
  ground: THREE.Mesh,
  scene: THREE.Scene,
): () => void {
  const canvas = renderer.domElement;
  let debugMarkerState: DebugMarkerState | null = null;

  const clearDebugMarker = (): void => {
    if (!debugMarkerState) {
      return;
    }
    scene.remove(debugMarkerState.marker);
    debugMarkerState.marker.geometry.dispose();
    (debugMarkerState.marker.material as THREE.Material).dispose();
    debugMarkerState = null;
  };

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

  canvas.addEventListener('contextmenu', (event: MouseEvent) => {
    event.preventDefault();

    if (gameMode.type !== 'freeRoam') {
      return;
    }

    const worldPoint = getRaycastPoint(event, camera, renderer, ground);
    if (!worldPoint) {
      return;
    }

    clearDebugMarker();

    const debugMarker = new THREE.Mesh(
      new THREE.SphereGeometry(0.08),
      new THREE.MeshBasicMaterial({ color: 0xff0000 })
    );
    debugMarker.position.set(worldPoint.x, worldPoint.y + 0.05, worldPoint.z);
    scene.add(debugMarker);
    debugMarkerState = {
      marker: debugMarker,
      targetX: worldPoint.x,
      targetZ: worldPoint.z,
    };


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

  return () => {
    if (!debugMarkerState) {
      return;
    }

    const sim = getSim();
    const dx = debugMarkerState.targetX - sim.apc_x();
    const dz = debugMarkerState.targetZ - sim.apc_z();
    const distSq = dx * dx + dz * dz;
    if (distSq <= APC_TOUCH_RADIUS_SQ) {
      clearDebugMarker();
    }
  };
}