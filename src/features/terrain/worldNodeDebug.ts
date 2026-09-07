import * as THREE from 'three';
import { HEIGHTMAP_GRID_SIZE, GROUND_SIZE } from '../../sim/config';

const STRUCTURE_CATEGORY = 1;
const SCRAP_CATEGORY = 2;
const RAW_RESOURCE_CATEGORY = 3;
const SCRAP_FIELD_SUBTYPE = 1;
const NICKEL_BAND_SUBTYPE = 2;
const COAL_SEAM_SUBTYPE = 3;

const structureColor = new THREE.Color('#c98c3a');
const scrapColor = new THREE.Color('#4aa0a8');
const nickelColor = new THREE.Color('#9ec7d8');
const coalColor = new THREE.Color('#2b2b30');

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

function nickelBandMesh(width: number, length: number, yaw: number): THREE.Mesh {
  const thickness = 0.18;
  const geometry = new THREE.BoxGeometry(width, thickness, length);
  const material = new THREE.MeshStandardMaterial({
    color: nickelColor,
    roughness: 0.55,
    metalness: 0.35,
    transparent: true,
    opacity: 0.9,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.y = yaw;
  mesh.userData.debugNodeHeight = thickness;
  return mesh;
}

function yawFromFlags(flags: number): number {
  return (flags & 0xff) / 255 * Math.PI * 2;
}

function coalClusterNode(
  originX: number,
  originZ: number,
  span: number,
  height: number,
  yaw: number,
  seed: number,
  heightmap: Float32Array,
  heightMult: number,
): THREE.Group {
  const group = new THREE.Group();
  const chainCount = 3 + (seed & 1);
  const cliffNormal = new THREE.Vector2(Math.cos(yaw), Math.sin(yaw));
  const direction = new THREE.Vector2(-cliffNormal.y, cliffNormal.x);
  const mainRadius = Math.max(0.45, height * 0.22);
  const wallBias = cliffNormal.clone().multiplyScalar(-mainRadius * 0.22);
  const bubbleMaterial = new THREE.MeshStandardMaterial({
    color: coalColor,
    roughness: 1.0,
    metalness: 0.0,
  });

  const placeBubble = (x: number, z: number, radius: number): void => {
    const geometry = new THREE.SphereGeometry(radius, 12, 10);
    const bubble = new THREE.Mesh(geometry, bubbleMaterial.clone());
    const y = worldHeightAt(heightmap, x, z, heightMult) + radius * 0.68;
    bubble.position.set(x, y, z);
    group.add(bubble);
  };

  placeBubble(originX + wallBias.x, originZ + wallBias.y, mainRadius);

  let traveled = mainRadius * 0.9;
  let previousRadius = mainRadius;

  for (let index = 0; index < chainCount; index++) {
    const bubbleRadius = mainRadius * (0.72 - index * 0.12);
    const gap = 0.82 * (previousRadius + bubbleRadius);
    traveled += gap;
    const clampSpan = Math.min(traveled, span + mainRadius * 0.35);
    const sideJitter = (((seed >>> (index * 3 + 4)) & 0x3) - 1.5) * 0.08 * mainRadius;
    const x = originX + wallBias.x + direction.x * clampSpan + cliffNormal.x * sideJitter;
    const z = originZ + wallBias.y + direction.y * clampSpan + cliffNormal.y * sideJitter;
    placeBubble(x, z, Math.max(0.2, bubbleRadius));
    previousRadius = bubbleRadius;
  }

  return group;
}

function disposeNodeObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) {
      return;
    }
    child.geometry.dispose();
    const material = child.material;
    if (Array.isArray(material)) {
      for (const entry of material) entry.dispose();
    } else {
      material.dispose();
    }
  });
}

export function createWorldNodeDebugGroup(params: {
  count: number;
  categories: Uint8Array;
  subtypes: Uint8Array;
  x: Float32Array;
  z: Float32Array;
  radiusOrW: Float32Array;
  depthOrH: Float32Array;
  seeds: Uint32Array;
  flags: Uint32Array;
  heightmap: Float32Array;
  heightMult: number;
}): THREE.Group {
  const group = new THREE.Group();
  group.userData.isWorldNodeDebugGroup = true;

  for (let index = 0; index < params.count; index++) {
    const category = params.categories[index];
    const subtype = params.subtypes[index] ?? 0;
    const nodeX = params.x[index] ?? 0;
    const nodeZ = params.z[index] ?? 0;
    const radiusOrW = params.radiusOrW[index] ?? 1;
    const depthOrH = params.depthOrH[index] ?? 1;
    const seed = params.seeds[index] ?? 0;
    const flags = params.flags[index] ?? 0;
    const baseHeight = worldHeightAt(params.heightmap, nodeX, nodeZ, params.heightMult);

    let object: THREE.Object3D | null = null;
    if (category === STRUCTURE_CATEGORY) {
      object = structureMesh(radiusOrW * 2.0, depthOrH * 2.0, seed);
    } else if (category === SCRAP_CATEGORY || subtype === SCRAP_FIELD_SUBTYPE) {
      object = scrapMesh(radiusOrW, depthOrH, seed);
    } else if (category === RAW_RESOURCE_CATEGORY && subtype === NICKEL_BAND_SUBTYPE) {
      object = nickelBandMesh(radiusOrW, depthOrH, yawFromFlags(flags));
    } else if (category === RAW_RESOURCE_CATEGORY && subtype === COAL_SEAM_SUBTYPE) {
      object = coalClusterNode(
        nodeX,
        nodeZ,
        radiusOrW,
        depthOrH,
        yawFromFlags(flags),
        seed,
        params.heightmap,
        params.heightMult,
      );
    }

    if (!object) {
      continue;
    }

    if (subtype === COAL_SEAM_SUBTYPE) {
      group.add(object);
      continue;
    }

    const meshHeight = (object.userData.debugNodeHeight as number | undefined) ?? 1;
    const verticalOffset = (object.userData.debugNodeVerticalOffset as number | undefined)
      ?? meshHeight * 0.5;
    object.position.set(nodeX, baseHeight + verticalOffset, nodeZ);
    group.add(object);
  }

  return group;
}

export function disposeWorldNodeDebugGroup(group: THREE.Group | undefined): void {
  if (!group) {
    return;
  }
  for (const child of group.children) {
    disposeNodeObject(child);
  }
}