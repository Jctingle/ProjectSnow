import * as THREE from 'three';
import {
  cellCentre,
  cellToCoords,
  subcellOffset,
  type InteriorHull,
} from './interiorMath';
import type { InteriorLevelView } from './interiorRender';

type UpdateInteriorSubcellLayerOptions = {
  cubeFocusCell: number | null;
  level: number;
  hull: InteriorHull;
  size: number;
  subcellLayer: THREE.Group;
  subcellPreviewMeshes: THREE.Mesh[];
  subcellHoverMesh: THREE.Mesh;
  subcellSelectMesh: THREE.Mesh;
  hoveredSubcell: number;
  selectedSubcell: number;
  scratchPosition: THREE.Vector3;
  clearSubcellPicks(): void;
};

type ApplyInteriorCubeIsolationOptions = {
  levels: InteriorLevelView[];
  cubeFocusCell: number | null;
  level: number;
  scratchPosition: THREE.Vector3;
  scratchMatrix: THREE.Matrix4;
  identityQuaternion: THREE.Quaternion;
  scratchScale: THREE.Vector3;
};

type UpdateInteriorHighlightsOptions = {
  selectMesh: THREE.Mesh;
  hoverMesh: THREE.Mesh;
  selectedCell: number;
  hoveredCell: number;
  level: number;
  hull: InteriorHull;
  scratchPosition: THREE.Vector3;
};

function placeInteriorHighlight(
  mesh: THREE.Mesh,
  cell: number,
  level: number,
  hull: InteriorHull,
  scratchPosition: THREE.Vector3,
): void {
  const coords = cellToCoords(cell);
  if (!coords || coords.y !== level) {
    mesh.visible = false;
    return;
  }
  cellCentre(coords.x, coords.y, coords.z, hull, scratchPosition);
  mesh.position.copy(scratchPosition);
  mesh.visible = true;
}

export function updateInteriorSubcellLayer(options: UpdateInteriorSubcellLayerOptions): void {
  const {
    cubeFocusCell,
    level,
    hull,
    size,
    subcellLayer,
    subcellPreviewMeshes,
    subcellHoverMesh,
    subcellSelectMesh,
    hoveredSubcell,
    selectedSubcell,
    scratchPosition,
    clearSubcellPicks,
  } = options;

  if (cubeFocusCell === null) {
    subcellLayer.visible = false;
    clearSubcellPicks();
    return;
  }

  const coords = cellToCoords(cubeFocusCell);
  if (!coords || coords.y !== level) {
    subcellLayer.visible = false;
    clearSubcellPicks();
    return;
  }

  cellCentre(coords.x, coords.y, coords.z, hull, scratchPosition);
  subcellLayer.position.copy(scratchPosition);
  subcellLayer.visible = true;

  for (let local = 0; local < 8; local += 1) {
    subcellOffset(local, size, scratchPosition);
    subcellPreviewMeshes[local].position.copy(scratchPosition);
  }

  if (selectedSubcell >= 0 && selectedSubcell < 8) {
    subcellOffset(selectedSubcell, size, scratchPosition);
    subcellSelectMesh.position.copy(scratchPosition);
    subcellSelectMesh.visible = true;
  } else {
    subcellSelectMesh.visible = false;
  }

  if (hoveredSubcell >= 0 && hoveredSubcell < 8 && hoveredSubcell !== selectedSubcell) {
    subcellOffset(hoveredSubcell, size, scratchPosition);
    subcellHoverMesh.position.copy(scratchPosition);
    subcellHoverMesh.visible = true;
  } else {
    subcellHoverMesh.visible = false;
  }
}

export function applyInteriorCubeIsolation(options: ApplyInteriorCubeIsolationOptions): void {
  const {
    levels,
    cubeFocusCell,
    level,
    scratchPosition,
    scratchMatrix,
    identityQuaternion,
    scratchScale,
  } = options;

  for (let y = 0; y < levels.length; y += 1) {
    const current = levels[y];
    for (let local = 0; local < current.count; local += 1) {
      const show = cubeFocusCell === null || y !== level || current.cells[local] === cubeFocusCell;
      scratchPosition.set(
        current.positions[local * 3],
        current.positions[local * 3 + 1],
        current.positions[local * 3 + 2],
      );
      const scale = show ? 1 : 0;
      scratchMatrix.compose(
        scratchPosition,
        identityQuaternion,
        scratchScale.set(scale, scale, scale),
      );
      current.machines.setMatrixAt(local, scratchMatrix);
    }
    current.machines.instanceMatrix.needsUpdate = true;
  }
}

export function updateInteriorHighlights(options: UpdateInteriorHighlightsOptions): void {
  const {
    selectMesh,
    hoverMesh,
    selectedCell,
    hoveredCell,
    level,
    hull,
    scratchPosition,
  } = options;

  placeInteriorHighlight(selectMesh, selectedCell, level, hull, scratchPosition);
  placeInteriorHighlight(
    hoverMesh,
    hoveredCell === selectedCell ? -1 : hoveredCell,
    level,
    hull,
    scratchPosition,
  );
}