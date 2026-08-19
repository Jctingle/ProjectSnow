import * as THREE from 'three';
import { HEIGHTMAP_GRID_SIZE } from '../sim/config';
import { classifySlopeTier, type SlopeTier } from './slopeLookup';

const TIER_COLORS: Record<SlopeTier, [number, number, number]> = {
  passable: [0, 1, 0],
  rolling: [1, 0.75, 0],
  cliff: [1, 0, 0],
};

/**
 * Builds a non-indexed overlay mesh with one flat color per slopemap cell.
 * The overlay is local to the source terrain mesh and never mutates it.
 */
export function createTierOverlayMesh(
  terrainMesh: THREE.Mesh,
  slopemap: Float32Array,
): THREE.Mesh {
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
      // PlaneGeometry uses [i00, i01, i10, i01, i11, i10].
      const corners = [i00, i01, i10, i01, i11, i10];
      const [r, g, b] = TIER_COLORS[classifySlopeTier(slopemap[i00])];

      for (const vertexIndex of corners) {
        positions.push(
          srcPos.getX(vertexIndex),
          srcPos.getY(vertexIndex),
          srcPos.getZ(vertexIndex) + 0.05,
        );
        colors.push(r, g, b);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'tierOverlay';
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
