import * as THREE from 'three';
import { positions, activeCount } from '../entityStore';

const MAX_UNITS = 256;
const geometry = new THREE.BoxGeometry(0.075, 0.075, 0.075);
const material = new THREE.MeshStandardMaterial({ color: 0x66ccff });

export const instancedUnits = new THREE.InstancedMesh(geometry, material, MAX_UNITS);
instancedUnits.count = 0;

const dummy = new THREE.Object3D();

export function syncInstancedMesh() {
  instancedUnits.count = activeCount;
  for (let i = 0; i < activeCount; i++) {
    dummy.position.set(
      positions[i * 3],
      positions[i * 3 + 1],
      positions[i * 3 + 2]
    );
    dummy.updateMatrix();
    instancedUnits.setMatrixAt(i, dummy.matrix);
  }
  instancedUnits.instanceMatrix.needsUpdate = true;
}