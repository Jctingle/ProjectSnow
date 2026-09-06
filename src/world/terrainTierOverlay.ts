import * as THREE from 'three';
import { HEIGHTMAP_GRID_SIZE } from '../sim/config';
import { classifySlopeTier, type SlopeTier } from './slopeLookup';

const TIER_COLORS: Record<SlopeTier, [number, number, number]> = {
  passable: [0, 1, 0],
  rolling: [1, 0.75, 0],
  cliff: [1, 0, 0],
};

const ACCESS_HILL_EPSILON = 0.015;

function buildOverlayGeometry(
  terrainMesh: THREE.Mesh,
  triangleWriter: (
    positions: number[],
    colors: number[],
    srcPos: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
    row: number,
    col: number,
    i00: number,
    i10: number,
    i01: number,
    i11: number,
  ) => void,
): THREE.BufferGeometry {
  const srcPos = (terrainMesh.geometry as THREE.PlaneGeometry).attributes.position;
  const gridSize = HEIGHTMAP_GRID_SIZE;
  const positions: number[] = [];
  const colors: number[] = [];
  const idx = (row: number, col: number): number => row * gridSize + col;

  for (let row = 0; row < gridSize - 1; row++) {
    for (let col = 0; col < gridSize - 1; col++) {
      const i00 = idx(row, col);
      const i10 = idx(row, col + 1);
      const i01 = idx(row + 1, col);
      const i11 = idx(row + 1, col + 1);
      triangleWriter(positions, colors, srcPos, row, col, i00, i10, i01, i11);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geometry;
}

function pushTriangle(
  positions: number[],
  colors: number[],
  srcPos: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  vertexIndices: number[],
  rgb: [number, number, number],
  zOffset: number,
): void {
  for (const vertexIndex of vertexIndices) {
    positions.push(
      srcPos.getX(vertexIndex),
      srcPos.getY(vertexIndex),
      srcPos.getZ(vertexIndex) + zOffset,
    );
    colors.push(rgb[0], rgb[1], rgb[2]);
  }
}

/**
 * Builds a non-indexed overlay mesh with one flat color per slopemap cell.
 * The overlay is local to the source terrain mesh and never mutates it.
 */
export function createTierOverlayMesh(
  terrainMesh: THREE.Mesh,
  slopemap: Float32Array,
): THREE.Mesh {
  const geometry = buildOverlayGeometry(
    terrainMesh,
    (positions, colors, srcPos, _row, _col, i00, i10, i01, i11) => {
      const tri1 = [i00, i01, i10];
      const tri2 = [i01, i11, i10];
      pushTriangle(
        positions,
        colors,
        srcPos,
        tri1,
        TIER_COLORS[classifySlopeTier(slopemap[i00] ?? 0)],
        0.05,
      );
      pushTriangle(
        positions,
        colors,
        srcPos,
        tri2,
        TIER_COLORS[classifySlopeTier(slopemap[i11] ?? 0)],
        0.05,
      );
    },
  );

  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'tierOverlay';
  return mesh;
}

export function createAccessHillOverlayMesh(
  terrainMesh: THREE.Mesh,
  accessHillmap: Float32Array,
): THREE.Mesh {
  let maxValue = 0;
  for (const value of accessHillmap) {
    if (value > maxValue) maxValue = value;
  }

  const geometry = buildOverlayGeometry(
    terrainMesh,
    (positions, colors, srcPos, _row, _col, i00, i10, i01, i11) => {
      const tri1Value = Math.max(accessHillmap[i00] ?? 0, accessHillmap[i01] ?? 0, accessHillmap[i10] ?? 0);
      const tri2Value = Math.max(accessHillmap[i01] ?? 0, accessHillmap[i11] ?? 0, accessHillmap[i10] ?? 0);

      if (tri1Value > ACCESS_HILL_EPSILON) {
        const intensity = maxValue > 0 ? Math.min(tri1Value / maxValue, 1) : 0;
        const color: [number, number, number] = [
          0.1 + intensity * 0.2,
          0.55 + intensity * 0.35,
          0.7 + intensity * 0.3,
        ];
        pushTriangle(positions, colors, srcPos, [i00, i01, i10], color, 0.12);
      }

      if (tri2Value > ACCESS_HILL_EPSILON) {
        const intensity = maxValue > 0 ? Math.min(tri2Value / maxValue, 1) : 0;
        const color: [number, number, number] = [
          0.1 + intensity * 0.2,
          0.55 + intensity * 0.35,
          0.7 + intensity * 0.3,
        ];
        pushTriangle(positions, colors, srcPos, [i01, i11, i10], color, 0.12);
      }
    },
  );

  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'accessHillOverlay';
  return mesh;
}

export function disposeTierOverlayMesh(mesh: THREE.Mesh | null | undefined): void {
  if (!mesh) return;
  mesh.parent?.remove(mesh);
  mesh.geometry.dispose();
  const material = mesh.material;
  if (Array.isArray(material)) {
    for (const entry of material) entry.dispose();
  } else {
    material.dispose();
  }
}

export function setTierOverlayVisible(
  mesh: THREE.Mesh | null | undefined,
  visible: boolean,
): void {
  if (mesh) mesh.visible = visible;
}
