import * as THREE from 'three';
import type { Sim } from 'wasm-sim';

export function createApcMesh(): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.3, 0.3),
    new THREE.MeshStandardMaterial({ color: 0xff8844 })
  );
}

export function syncApcMesh(mesh: THREE.Mesh, sim: Sim): void {
  mesh.position.set(sim.apc_x(), sim.apc_y() + 0.15, sim.apc_z());
}
