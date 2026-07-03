import * as THREE from 'three';
import type { Sim } from 'wasm-sim';
import { GROUND_SEGMENTS, GROUND_SIZE } from '../sim/config';

export function createTerrainMesh(sim: Sim): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(
    GROUND_SIZE,
    GROUND_SIZE,
    GROUND_SEGMENTS,
    GROUND_SEGMENTS
  );
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff });
  const ground = new THREE.Mesh(geometry, material);

  ground.rotation.x = -Math.PI / 2;

  const posAttr = geometry.attributes.position;
  for (let i = 0; i < posAttr.count; i++) {
    const lx = posAttr.getX(i);
    const ly = posAttr.getY(i);
    const h = sim.sample_height(lx, -ly);
    posAttr.setZ(i, h * sim.height_mult());
  }
  posAttr.needsUpdate = true;
  geometry.computeVertexNormals();

  return ground;
}
