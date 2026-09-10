import * as THREE from 'three';
import {
  cellCentre,
  cellToCoords,
  footprintTransform,
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
  subcellGhostMesh: THREE.Mesh;
  hoverOutline: THREE.LineSegments;
  subcellOutline: THREE.LineSegments;
  machineOutline: THREE.LineSegments;
  /// Subcell the held machine would drop into, or -1 while nothing is held.
  ghostSubcell: number;
  /// Only ever a subcell backed by a machine; -1 otherwise.
  hoveredSubcell: number;
  selectedSubcell: number;
  /// Footprint of the machine owning the selected subcell, or 0 when none.
  selectedFootprint: number;
  scratchPosition: THREE.Vector3;
  scratchScale: THREE.Vector3;
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
  suppressed: boolean;
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
    subcellGhostMesh,
    hoverOutline,
    subcellOutline,
    machineOutline,
    ghostSubcell,
    hoveredSubcell,
    selectedSubcell,
    selectedFootprint,
    scratchPosition,
    scratchScale,
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

  // Sub-focus draws no standing subcell fills: they hid whatever the player
  // entered the cube to look at. Only the held machine shows a volume.
  const holding = ghostSubcell >= 0 && ghostSubcell < 8;
  if (holding) {
    subcellOffset(ghostSubcell, size, scratchPosition);
    subcellGhostMesh.position.copy(scratchPosition);
  }
  subcellGhostMesh.visible = holding;

  const subcellEdge = size * 0.5;
  // A 1x1x1 machine's two outlines are the same box, so the subcell one nests
  // inside rather than z-fighting the machine one.
  const nestedEdge = subcellEdge * 0.86;

  const showHover =
    !holding && hoveredSubcell >= 0 && hoveredSubcell < 8 && hoveredSubcell !== selectedSubcell;
  if (showHover) {
    subcellOffset(hoveredSubcell, size, scratchPosition);
    hoverOutline.position.copy(scratchPosition);
    hoverOutline.scale.setScalar(nestedEdge);
  }
  hoverOutline.visible = showHover;

  const showSelection = !holding && selectedSubcell >= 0 && selectedSubcell < 8;
  if (showSelection) {
    subcellOffset(selectedSubcell, size, scratchPosition);
    subcellOutline.position.copy(scratchPosition);
    subcellOutline.scale.setScalar(nestedEdge);
  }
  subcellOutline.visible = showSelection;

  // The joined machine can span several subcells, so its outline is derived
  // from the footprint rather than from the clicked subcell.
  const showMachine =
    showSelection && footprintTransform(selectedFootprint, size, scratchPosition, scratchScale);
  if (showMachine) {
    machineOutline.position.copy(scratchPosition);
    machineOutline.scale.set(
      scratchScale.x * subcellEdge,
      scratchScale.y * subcellEdge,
      scratchScale.z * subcellEdge,
    );
  }
  machineOutline.visible = showMachine;
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
      scratchScale.set(
        current.scales[local * 3],
        current.scales[local * 3 + 1],
        current.scales[local * 3 + 2],
      );
      if (!show) scratchScale.set(0, 0, 0);
      scratchMatrix.compose(scratchPosition, identityQuaternion, scratchScale);
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
    suppressed,
    scratchPosition,
  } = options;

  if (suppressed) {
    selectMesh.visible = false;
    hoverMesh.visible = false;
    return;
  }

  placeInteriorHighlight(selectMesh, selectedCell, level, hull, scratchPosition);
  placeInteriorHighlight(
    hoverMesh,
    hoveredCell === selectedCell ? -1 : hoveredCell,
    level,
    hull,
    scratchPosition,
  );
}