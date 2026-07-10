import * as THREE from 'three';
import { getSim } from '../entityStore';

type DebugMarkerState = {
  marker: THREE.Mesh;
  targetX: number;
  targetZ: number;
};

export type DestinationMarkerController = {
  showAt(worldPoint: THREE.Vector3): void;
  clear(): void;
  shiftBy(dx: number, dz: number): void;
  update(): void;
};

export function createDestinationMarkerController(
  scene: THREE.Scene,
): DestinationMarkerController {
  // Read from the sim so marker-arrival logic tracks APC tuning in one place.
  const apcTouchRadius = getSim().apc_touch_radius();
  const apcTouchRadiusSq = apcTouchRadius * apcTouchRadius;
  let debugMarkerState: DebugMarkerState | null = null;

  const clear = (): void => {
    if (!debugMarkerState) {
      return;
    }
    scene.remove(debugMarkerState.marker);
    debugMarkerState.marker.geometry.dispose();
    (debugMarkerState.marker.material as THREE.Material).dispose();
    debugMarkerState = null;
  };

  const showAt = (worldPoint: THREE.Vector3): void => {
    clear();

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
  };

  const update = (): void => {
    if (!debugMarkerState) {
      return;
    }

    const sim = getSim();
    const dx = debugMarkerState.targetX - sim.apc_x();
    const dz = debugMarkerState.targetZ - sim.apc_z();
    const distSq = dx * dx + dz * dz;

    if (distSq <= apcTouchRadiusSq) {
      clear();
    }
  };

  const shiftBy = (dx: number, dz: number): void => {
    if (!debugMarkerState) {
      return;
    }

    debugMarkerState.marker.position.x += dx;
    debugMarkerState.marker.position.z += dz;
    debugMarkerState.targetX += dx;
    debugMarkerState.targetZ += dz;
  };

  return {
    showAt,
    clear,
    shiftBy,
    update,
  };
}
