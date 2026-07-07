import * as THREE from 'three';
import { getPositions, activeCount, MAX_UNITS } from '../entityStore';

const geometry = new THREE.BoxGeometry(0.075, 0.075, 0.075);
const material = new THREE.MeshStandardMaterial({ color: 0x66ccff });

export const instancedUnits = new THREE.InstancedMesh(geometry, material, MAX_UNITS);
instancedUnits.frustumCulled = false;
instancedUnits.count = 0;

export function syncInstancedMesh(): void {
  const count = activeCount();
  const positions = getPositions(); // zero-copy view into WASM memory
  const matrices = instancedUnits.instanceMatrix.array as Float32Array;

  instancedUnits.count = count;

  // Units only translate (no rotation/scale), so skip the Object3D
  // compose entirely and write translation into the 4x4 directly.
  // Column-major: translation lives at elements 12, 13, 14.
  for (let i = 0; i < count; i++) {
    const m = i * 16;
    const p = i * 3;
    matrices[m]      = 1; matrices[m + 1]  = 0; matrices[m + 2]  = 0; matrices[m + 3]  = 0;
    matrices[m + 4]  = 0; matrices[m + 5]  = 1; matrices[m + 6]  = 0; matrices[m + 7]  = 0;
    matrices[m + 8]  = 0; matrices[m + 9]  = 0; matrices[m + 10] = 1; matrices[m + 11] = 0;
    matrices[m + 12] = positions[p];
    matrices[m + 13] = positions[p + 1];
    matrices[m + 14] = positions[p + 2];
    matrices[m + 15] = 1;
  }

  instancedUnits.instanceMatrix.needsUpdate = true;
}