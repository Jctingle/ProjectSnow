import * as THREE from 'three';
import { HEIGHTMAP_GRID_SIZE, GROUND_SIZE } from '../../sim/config';

const STRUCTURE_CATEGORY = 1;
const SCRAP_CATEGORY = 2;

const structureColor = new THREE.Color('#c98c3a');
const scrapColor = new THREE.Color('#4aa0a8');

function gridIndexFromWorld(x: number, z: number): number {
  const fx = (x / GROUND_SIZE + 0.5) * (HEIGHTMAP_GRID_SIZE - 1);
  const fz = (z / GROUND_SIZE + 0.5) * (HEIGHTMAP_GRID_SIZE - 1);
  const col = Math.min(Math.max(Math.round(fx), 0), HEIGHTMAP_GRID_SIZE - 1);
  const row = Math.min(Math.max(Math.round(fz), 0), HEIGHTMAP_GRID_SIZE - 1);
  return row * HEIGHTMAP_GRID_SIZE + col;
}

function worldHeightAt(heightmap: Float32Array, x: number, z: number, heightMult: number): number {
  return (heightmap[gridIndexFromWorld(x, z)] ?? 0) * heightMult;
}

function structureMesh(width: number, depth: number, seed: number): THREE.Mesh {
  const height = Math.max(width, depth) * 0.9;
  const geometry = new THREE.BoxGeometry(width, height, depth);
  const material = new THREE.MeshStandardMaterial({
    color: structureColor,
    roughness: 0.95,
    metalness: 0.05,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.y = ((seed & 0xff) / 255) * Math.PI * 2;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.userData.debugNodeHeight = height;
  return mesh;
}

function scrapMesh(radius: number, depth: number, seed: number): THREE.Mesh {
  const geometry = new THREE.CylinderGeometry(radius, radius * 0.7, Math.max(depth * 0.45, 0.6), 7);
  const material = new THREE.MeshStandardMaterial({
    color: scrapColor,
    roughness: 0.8,
    metalness: 0.2,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.y = ((seed >>> 8) & 0xff) / 255 * Math.PI * 2;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.userData.debugNodeHeight = Math.max(depth * 0.45, 0.6);
  return mesh;
}

function disposeNodeMesh(mesh: THREE.Mesh): void {
  mesh.geometry.dispose();
  const material = mesh.material;
  if (Array.isArray(material)) {
    for (const entry of material) entry.dispose();
  } else {
    material.dispose();
  }
}

export function createWorldNodeDebugGroup(params: {
  count: number;
  categories: Uint8Array;
  x: Float32Array;
  z: Float32Array;
  radiusOrW: Float32Array;
  depthOrH: Float32Array;
  seeds: Uint32Array;
  heightmap: Float32Array;
  heightMult: number;
}): THREE.Group {
  const group = new THREE.Group();
  group.userData.isWorldNodeDebugGroup = true;

  for (let index = 0; index < params.count; index++) {
    const category = params.categories[index];
    const nodeX = params.x[index] ?? 0;
    const nodeZ = params.z[index] ?? 0;
    const radiusOrW = params.radiusOrW[index] ?? 1;
    const depthOrH = params.depthOrH[index] ?? 1;
    const seed = params.seeds[index] ?? 0;
    const baseHeight = worldHeightAt(params.heightmap, nodeX, nodeZ, params.heightMult);

    let mesh: THREE.Mesh | null = null;
    if (category === STRUCTURE_CATEGORY) {
      mesh = structureMesh(radiusOrW * 2.0, depthOrH * 2.0, seed);
    } else if (category === SCRAP_CATEGORY) {
      mesh = scrapMesh(radiusOrW, depthOrH, seed);
    }

    if (!mesh) {
      continue;
    }

    const meshHeight = (mesh.userData.debugNodeHeight as number | undefined) ?? 1;
    mesh.position.set(nodeX, baseHeight + meshHeight * 0.5, nodeZ);
    group.add(mesh);
  }

  return group;
}

export function disposeWorldNodeDebugGroup(group: THREE.Group | undefined): void {
  if (!group) {
    return;
  }
  for (const child of group.children) {
    if (child instanceof THREE.Mesh) {
      disposeNodeMesh(child);
    }
  }
}