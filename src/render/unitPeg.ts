import * as THREE from 'three';
import { APC_GRID_CELL_SIZE } from '../sim/config';

// Match the existing subcell preview cube edge so unit pegs read as occupying
// one floor subcell both in the interior and during deployment.
export const UNIT_PEG_HEIGHT = APC_GRID_CELL_SIZE * 0.48;
export const UNIT_PEG_RADIUS = UNIT_PEG_HEIGHT * 0.24;
export const UNIT_PEG_Y_OFFSET = UNIT_PEG_HEIGHT * 0.5;

export const UNIT_PEG_COLOR = 0x46ffb4;
export const UNIT_PEG_EMISSIVE = 0x126e4a;

export function createUnitPegGeometry(): THREE.CylinderGeometry {
  return new THREE.CylinderGeometry(UNIT_PEG_RADIUS, UNIT_PEG_RADIUS, UNIT_PEG_HEIGHT, 12);
}

export function createUnitPegMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: UNIT_PEG_COLOR,
    emissive: UNIT_PEG_EMISSIVE,
    emissiveIntensity: 0.85,
  });
}
