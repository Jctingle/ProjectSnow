import * as THREE from 'three';
import type { Sim } from 'wasm-sim';
import {
  GROUND_SEGMENTS,
  GROUND_SIZE,
  HEIGHTMAP_GRID_SIZE,
} from '../sim/config';

function createBaseTerrainMesh(): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(
    GROUND_SIZE,
    GROUND_SIZE,
    GROUND_SEGMENTS,
    GROUND_SEGMENTS
  );
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff });
  const ground = new THREE.Mesh(geometry, material);
  ground.rotation.x = -Math.PI / 2;
  ground.userData.isTerrainMesh = true;
  return ground;
}

function gridIndexFromLocalVertex(lx: number, ly: number): number {
  const fx = (lx / GROUND_SIZE + 0.5) * (HEIGHTMAP_GRID_SIZE - 1);
  const fz = (-ly / GROUND_SIZE + 0.5) * (HEIGHTMAP_GRID_SIZE - 1);
  const col = Math.min(Math.max(Math.round(fx), 0), HEIGHTMAP_GRID_SIZE - 1);
  const row = Math.min(Math.max(Math.round(fz), 0), HEIGHTMAP_GRID_SIZE - 1);
  return row * HEIGHTMAP_GRID_SIZE + col;
}

export function createTerrainMesh(sim: Sim): THREE.Mesh {
  const ground = createBaseTerrainMesh();
  const geometry = ground.geometry as THREE.PlaneGeometry;

  const posAttr = geometry.attributes.position;
  for (let i = 0; i < posAttr.count; i++) {
    const lx = posAttr.getX(i);
    const ly = posAttr.getY(i);
    const h = sim.sample_height(lx, -ly);
    posAttr.setZ(i, h * sim.height_mult());
  }
  posAttr.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  return ground;
}

export function createTerrainMeshFromGrid(
  heightmap: Float32Array,
  heightMult: number
): THREE.Mesh {
  const ground = createBaseTerrainMesh();
  const geometry = ground.geometry as THREE.PlaneGeometry;

  const posAttr = geometry.attributes.position;
  for (let i = 0; i < posAttr.count; i++) {
    const lx = posAttr.getX(i);
    const ly = posAttr.getY(i);
    const h = heightmap[gridIndexFromLocalVertex(lx, ly)] ?? 0;
    posAttr.setZ(i, h * heightMult);
  }
  posAttr.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  return ground;
}
