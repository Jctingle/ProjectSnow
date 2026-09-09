import * as THREE from 'three';
import { HEIGHTMAP_GRID_SIZE, GROUND_SIZE } from '../../sim/config';
import { settlementSubtypeClassNumber } from './settlementDebugPalette';
import {
  LARGE_STRUCTURE_SUBTYPE,
  SCRAP_CATEGORY,
  SCRAP_FIELD_SUBTYPE,
  SMALL_STRUCTURE_SUBTYPE,
  STRUCTURE_CATEGORY,
  structureRotationY,
} from './worldNodeKinds';

const APC_CELL_WORLD_SIZE = 0.3;
const SETTLEMENT_TOP_HEIGHT_CELLS = 4;
const LARGE_STRUCTURE_TOP_LIFT_RATIO = 0.08;
const STRUCTURE_RIM_SAMPLES_PER_EDGE = 12;
const STRUCTURE_SHELL_LATERAL_OVERSHOOT = 1.002;
const largeStructureOutlineColor = new THREE.Color('#d2362a');
const smallStructureOutlineColor = new THREE.Color('#29a0d2');
const settlementFillColor = new THREE.Color('#c7b48f');
const structureShellColor = new THREE.Color('#15181c');
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

function settlementDownwardDepth(flags: number): number {
  return ((flags >>> 24) & 0xff) * APC_CELL_WORLD_SIZE;
}

// The terrain cutout removes the whole footprint, so only the rim decides how
// high the roof must sit to stay above every surviving terrain edge.
function footprintRimMaxHeight(
  heightmap: Float32Array,
  heightMult: number,
  centerX: number,
  centerZ: number,
  halfWidth: number,
  halfDepth: number,
  rotationY: number,
): number {
  const cos = Math.cos(rotationY);
  const sin = Math.sin(rotationY);
  let maxHeight = -Infinity;

  for (let step = 0; step <= STRUCTURE_RIM_SAMPLES_PER_EDGE; step += 1) {
    const t = (step / STRUCTURE_RIM_SAMPLES_PER_EDGE) * 2 - 1;
    const rimLocals: [number, number][] = [
      [t * halfWidth, -halfDepth],
      [t * halfWidth, halfDepth],
      [-halfWidth, t * halfDepth],
      [halfWidth, t * halfDepth],
    ];
    for (const [localX, localZ] of rimLocals) {
      const worldX = centerX + localX * cos + localZ * sin;
      const worldZ = centerZ - localX * sin + localZ * cos;
      const height = worldHeightAt(heightmap, worldX, worldZ, heightMult);
      if (height > maxHeight) maxHeight = height;
    }
  }

  return Number.isFinite(maxHeight) ? maxHeight : 0;
}

// Back-face shell so the cutout reads as an enclosed interior instead of void.
function attachStructureShell(
  mesh: THREE.Mesh,
  width: number,
  height: number,
  depth: number,
): void {
  const shell = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth),
    new THREE.MeshStandardMaterial({
      color: structureShellColor,
      roughness: 1,
      metalness: 0,
      side: THREE.BackSide,
    }),
  );
  shell.scale.set(
    STRUCTURE_SHELL_LATERAL_OVERSHOOT,
    1,
    STRUCTURE_SHELL_LATERAL_OVERSHOOT,
  );
  mesh.add(shell);
}

function buildSettlementFaceTexture(classNumber: number): THREE.CanvasTexture | null {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = '#c7b48f';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = 'rgba(68, 54, 35, 0.42)';
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);
  ctx.fillStyle = '#34281a';
  ctx.font = 'bold 72px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(classNumber), canvas.width * 0.5, canvas.height * 0.55);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function buildSettlementMaterials(classNumber: number): THREE.MeshStandardMaterial[] {
  const texture = buildSettlementFaceTexture(classNumber);
  return Array.from({ length: 6 }, () => new THREE.MeshStandardMaterial({
    color: settlementFillColor,
    roughness: 0.95,
    metalness: 0.05,
    map: texture,
  }));
}

function settlementMesh(
  width: number,
  depth: number,
  seed: number,
  subtype: number,
  flags: number,
): THREE.Mesh {
  const height = Math.max(width, depth) * 0.9;
  const geometry = new THREE.BoxGeometry(width, height, depth);
  const material = buildSettlementMaterials(settlementSubtypeClassNumber(subtype));
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.y = structureRotationY(seed);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.userData.debugNodeHeight = height;
  const floatWell = (flags & 0xff) / 255;
  mesh.userData.debugNodeVerticalOffset = height * (0.5 - floatWell * 0.22);
  return mesh;
}

function largeStructureMesh(
  width: number,
  depth: number,
  seed: number,
  flags: number,
  outlineColor: THREE.Color,
  topLiftRatio = 0,
): THREE.Mesh {
  const topHeight = SETTLEMENT_TOP_HEIGHT_CELLS * APC_CELL_WORLD_SIZE;
  const downwardDepth = settlementDownwardDepth(flags);
  const height = topHeight + downwardDepth;
  const geometry = new THREE.BoxGeometry(width, height, depth);
  const material = new THREE.MeshBasicMaterial({
    color: outlineColor,
    wireframe: true,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.y = structureRotationY(seed);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.userData.debugNodeHeight = height;
  mesh.userData.debugNodeVerticalOffset = topHeight - height * 0.5 + topHeight * topLiftRatio;
  attachStructureShell(mesh, width, height, depth);
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

function disposeNodeObject(object: THREE.Object3D): void {
  if (object instanceof THREE.Mesh) {
    object.geometry.dispose();
  }
  if (!(object instanceof THREE.Mesh)) {
    return;
  }
  const material = object.material;
  if (Array.isArray(material)) {
    const seenMaps = new Set<THREE.Texture>();
    for (const entry of material) {
      if ('map' in entry && entry.map && !seenMaps.has(entry.map)) {
        seenMaps.add(entry.map);
        entry.map.dispose();
      }
      entry.dispose();
    }
  } else {
    if ('map' in material && material.map) {
      material.map.dispose();
    }
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
    const isCutoutStructure = category === STRUCTURE_CATEGORY
      && (subtype === LARGE_STRUCTURE_SUBTYPE || subtype === SMALL_STRUCTURE_SUBTYPE);

    let mesh: THREE.Mesh | null = null;
    if (category === STRUCTURE_CATEGORY) {
      if (subtype === LARGE_STRUCTURE_SUBTYPE) {
        mesh = largeStructureMesh(
          radiusOrW * 2.0,
          depthOrH * 2.0,
          seed,
          flags,
          largeStructureOutlineColor,
          LARGE_STRUCTURE_TOP_LIFT_RATIO,
        );
      } else if (subtype === SMALL_STRUCTURE_SUBTYPE) {
        mesh = largeStructureMesh(
          radiusOrW * 2.0,
          depthOrH * 2.0,
          seed,
          flags,
          smallStructureOutlineColor,
        );
      } else {
        mesh = settlementMesh(radiusOrW * 2.0, depthOrH * 2.0, seed, subtype, flags);
      }
    } else if (category === SCRAP_CATEGORY || subtype === SCRAP_FIELD_SUBTYPE) {
      mesh = scrapMesh(radiusOrW, depthOrH, seed);
    }

    if (!mesh) {
      continue;
    }

    const meshHeight = (mesh.userData.debugNodeHeight as number | undefined) ?? 1;
    const verticalOffset = (mesh.userData.debugNodeVerticalOffset as number | undefined)
      ?? meshHeight * 0.5;
    const anchorHeight = isCutoutStructure
      ? footprintRimMaxHeight(
        params.heightmap,
        params.heightMult,
        nodeX,
        nodeZ,
        radiusOrW,
        depthOrH,
        structureRotationY(seed),
      )
      : baseHeight;
    mesh.position.set(nodeX, anchorHeight + verticalOffset, nodeZ);
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