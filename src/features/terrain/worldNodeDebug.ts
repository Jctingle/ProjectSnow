import * as THREE from 'three';
import { HEIGHTMAP_GRID_SIZE, GROUND_SIZE } from '../../sim/config';

const STRUCTURE_CATEGORY = 1;
const SCRAP_CATEGORY = 2;
const RAW_RESOURCE_CATEGORY = 3;
const SETTLEMENT_PERCHED_SUBTYPE = 3;
const SETTLEMENT_EMBEDDED_SUBTYPE = 4;
const SCRAP_FIELD_SUBTYPE = 1;
const NICKEL_BAND_SUBTYPE = 2;

const balancedSettlementColor = new THREE.Color('#b88a48');
const perchedSettlementColor = new THREE.Color('#d0b17a');
const embeddedSettlementColor = new THREE.Color('#8d6a42');
const scrapColor = new THREE.Color('#4aa0a8');
const nickelColor = new THREE.Color('#9ec7d8');

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

function unitFloatFromFlags(flags: number, shift: number): number {
  return ((flags >>> shift) & 0xff) / 255;
}

function settlementColor(subtype: number): THREE.Color {
  if (subtype === SETTLEMENT_PERCHED_SUBTYPE) return perchedSettlementColor;
  if (subtype === SETTLEMENT_EMBEDDED_SUBTYPE) return embeddedSettlementColor;
  return balancedSettlementColor;
}

function structureMesh(
  width: number,
  depth: number,
  seed: number,
  subtype: number,
  floatWell: number,
): THREE.Mesh {
  const height = Math.max(width, depth) * 0.9;
  const geometry = new THREE.BoxGeometry(width, height, depth);
  const material = new THREE.MeshStandardMaterial({
    color: settlementColor(subtype),
    roughness: 0.95,
    metalness: 0.05,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.y = ((seed & 0xff) / 255) * Math.PI * 2;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.userData.debugNodeHeight = height;
  mesh.userData.debugNodeVerticalOffset = height * (0.5 - floatWell * 0.22);
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

function disposeNodeObject(object: THREE.Object3D): void {
  if (object instanceof THREE.Mesh) {
    object.geometry.dispose();
  }
  if (!(object instanceof THREE.Mesh)) {
    return;
  }
  const material = object.material;
  if (Array.isArray(material)) {
    for (const entry of material) {
      entry.dispose();
    }
  } else {
    material.dispose();
  }
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
    const floatWell = unitFloatFromFlags(flags, 0);

    let mesh: THREE.Mesh | null = null;
    if (category === STRUCTURE_CATEGORY) {
      mesh = structureMesh(radiusOrW * 2.0, depthOrH * 2.0, seed, subtype, floatWell);
    } else if (category === SCRAP_CATEGORY || subtype === SCRAP_FIELD_SUBTYPE) {
      mesh = scrapMesh(radiusOrW, depthOrH, seed);
    } else if (category === RAW_RESOURCE_CATEGORY && subtype === NICKEL_BAND_SUBTYPE) {
      mesh = nickelBandMesh(radiusOrW, depthOrH, yawFromFlags(flags));
    }

    if (!mesh) {
      continue;
    }

    const meshHeight = (mesh.userData.debugNodeHeight as number | undefined) ?? 1;
    const verticalOffset = (mesh.userData.debugNodeVerticalOffset as number | undefined)
      ?? meshHeight * 0.5;
    mesh.position.set(nodeX, baseHeight + verticalOffset, nodeZ);
    group.add(mesh);
  }

  return group;
}

export function disposeWorldNodeDebugGroup(group: THREE.Group | undefined): void {
  if (!group) {
    return;
  }
  group.traverse((child) => {
    disposeNodeObject(child);
  });
}