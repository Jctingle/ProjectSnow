import * as THREE from 'three';
import {
  buildInteriorLabelTexture,
} from '../features/apc/interior/interiorLabels';
import {
  applyInteriorCubeIsolation,
  updateInteriorHighlights,
  updateInteriorSubcellLayer,
} from '../features/apc/interior/interiorInteraction';
import {
  readInteriorHull,
  type InteriorHull,
} from '../features/apc/interior/interiorMath';
import {
  pickInteriorCell,
  pickInteriorSubcell,
} from '../features/apc/interior/interiorPicking';
import {
  applyInteriorVisibility,
  clearInteriorLevels,
  type InteriorLevelView,
} from '../features/apc/interior/interiorRender';
import {
  rebuildInteriorLevels,
  syncInteriorLevels,
} from '../features/apc/interior/interiorSync';
import { APC_GRID_CELL_SIZE } from '../sim/config';
import { machineAtSubcell, type SubcellMachine } from '../features/apc/machines/machineQuery';
import { createUnitPegGeometry, UNIT_PEG_Y_OFFSET } from '../render/unitPeg';

const MACHINE_FILL_RATIO = 0.78;
const PRODUCT_FILL_RATIO = 0.34;
const HOVER_COLOR = 0x40e0d0;
const SELECT_COLOR = 0x2266ff;
const HIGHLIGHT_FILL_RATIO = 0.92;
const SUBCELL_SIZE_RATIO = 0.48;
const GHOST_BLOCKED_COLOR = 0xff3b30;
const SUBCELL_HOVER_OUTLINE_COLOR = 0x8fd8ff;
const SUBCELL_SELECT_OUTLINE_COLOR = 0x33fff1;
const MACHINE_SELECT_OUTLINE_COLOR = 0xffc247;
const UNIT_SELECTION_OUTLINE_COLOR = 0xe0b84f;
const UNIT_FLOOR_ANCHOR_Y = -APC_GRID_CELL_SIZE * 0.5 + UNIT_PEG_Y_OFFSET;

/// A machine held by the cursor, before it is committed to the sim.
export type MachinePlacementPreview = {
  local: number;
  color: number;
  valid: boolean;
};

export type ApcInteriorView = {
  group: THREE.Group;
  rebuild(): void;
  sync(): void;
  setExteriorUnitsVisible(visible: boolean): void;
  setFocusLevel(level: number): void;
  setSubfocusEnabled(enabled: boolean): void;
  setCubeFocus(cell: number | null): void;
  pickCell(ndc: THREE.Vector2, camera: THREE.Camera): number;
  pickSubcell(ndc: THREE.Vector2, camera: THREE.Camera): number;
  setHoveredCell(cell: number): void;
  setSelectedCell(cell: number): void;
  /// Ignored unless the subcell holds a machine; selection is a machine probe.
  setHoveredSubcell(local: number): void;
  setSelectedSubcell(local: number): void;
  setMachinePlacementPreview(preview: MachinePlacementPreview | null): void;
  selectedCell(): number;
  selectedSubcell(): number;
  setSelectedUnit(unitId: number | null): void;
  setLabelsVisible(visible: boolean): void;
  dispose(): void;
};

export function createApcInteriorView(): ApcInteriorView {
  const group = new THREE.Group();
  group.name = 'apc-interior';

  const size = APC_GRID_CELL_SIZE;
  // One subcell box, scaled by the machine footprint span at instance time, so
  // a 1x1x1 and a merged 2x2x2 share a single instanced mesh.
  const machineGeometry = new THREE.BoxGeometry(
    size * 0.5 * MACHINE_FILL_RATIO,
    size * 0.5 * MACHINE_FILL_RATIO,
    size * 0.5 * MACHINE_FILL_RATIO,
  );
  const productGeometry = new THREE.SphereGeometry(size * PRODUCT_FILL_RATIO * 0.5, 10, 8);
  const unitGeometry = createUnitPegGeometry();

  let levels: InteriorLevelView[] = [];
  let labelMesh: THREE.Mesh | null = null;
  let labelsVisible = false;
  let subfocusEnabled = false;
  let exteriorUnitsVisible = true;
  let level = 0;
  let hull: InteriorHull = readInteriorHull();

  const scratchMatrix = new THREE.Matrix4();
  const scratchPosition = new THREE.Vector3();
  const identityQuaternion = new THREE.Quaternion();
  const scratchScale = new THREE.Vector3();
  const scratchOffset = new THREE.Vector3();
  const scratchBox = new THREE.Box3();
  const scratchHit = new THREE.Vector3();

  const pickRaycaster = new THREE.Raycaster();
  const localRay = new THREE.Ray();
  const inverseWorld = new THREE.Matrix4();

  let hoveredCell = -1;
  let selectedCell = -1;
  let selectedUnitId: number | null = null;
  let cubeFocusCell: number | null = null;
  let hoveredSubcell = -1;
  let selectedSubcell = -1;
  let selectedMachine: SubcellMachine | null = null;
  let placementPreview: MachinePlacementPreview | null = null;

  const highlightGeometry = new THREE.BoxGeometry(
    size * HIGHLIGHT_FILL_RATIO,
    size * HIGHLIGHT_FILL_RATIO,
    size * HIGHLIGHT_FILL_RATIO,
  );
  const makeHighlight = (color: number, opacity: number): THREE.Mesh => {
    const mesh = new THREE.Mesh(
      highlightGeometry,
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        depthTest: false,
        depthWrite: false,
      }),
    );
    mesh.visible = false;
    mesh.renderOrder = 900;
    group.add(mesh);
    return mesh;
  };
  const hoverMesh = makeHighlight(HOVER_COLOR, 0.45);
  const selectMesh = makeHighlight(SELECT_COLOR, 0.6);
  const selectedUnitOutline = new THREE.Mesh(
    unitGeometry,
    new THREE.MeshBasicMaterial({
      color: UNIT_SELECTION_OUTLINE_COLOR,
      side: THREE.BackSide,
      transparent: true,
      opacity: 0.98,
      depthTest: false,
      depthWrite: false,
    }),
  );
  selectedUnitOutline.scale.setScalar(1.3);
  selectedUnitOutline.visible = false;
  selectedUnitOutline.renderOrder = 905;
  group.add(selectedUnitOutline);

  const subcellGeometry = new THREE.BoxGeometry(
    size * SUBCELL_SIZE_RATIO,
    size * SUBCELL_SIZE_RATIO,
    size * SUBCELL_SIZE_RATIO,
  );
  const subcellLayer = new THREE.Group();
  subcellLayer.visible = false;
  subcellLayer.renderOrder = 901;
  group.add(subcellLayer);

  const subcellGhostMesh = new THREE.Mesh(
    subcellGeometry,
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.55,
      depthTest: false,
      depthWrite: false,
    }),
  );
  subcellGhostMesh.visible = false;
  subcellGhostMesh.renderOrder = 902;
  subcellLayer.add(subcellGhostMesh);

  // Unit cube edges, scaled per use, so one geometry covers both a single
  // subcell and a merged machine's full footprint.
  const outlineGeometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
  const makeOutline = (color: number, opacity: number): THREE.LineSegments => {
    const lines = new THREE.LineSegments(
      outlineGeometry,
      new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity,
        depthTest: false,
        depthWrite: false,
      }),
    );
    lines.visible = false;
    lines.renderOrder = 903;
    subcellLayer.add(lines);
    return lines;
  };
  const hoverOutline = makeOutline(SUBCELL_HOVER_OUTLINE_COLOR, 0.55);
  const subcellOutline = makeOutline(SUBCELL_SELECT_OUTLINE_COLOR, 0.95);
  const machineOutline = makeOutline(MACHINE_SELECT_OUTLINE_COLOR, 0.95);

  function clearSubcellPicks(): void {
    hoveredSubcell = -1;
    selectedSubcell = -1;
    selectedMachine = null;
  }

  function updateSubcellLayer(): void {
    updateInteriorSubcellLayer({
      cubeFocusCell,
      level,
      hull,
      size,
      subcellLayer,
      subcellGhostMesh,
      hoverOutline,
      subcellOutline,
      machineOutline,
      ghostSubcell: placementPreview?.local ?? -1,
      hoveredSubcell,
      selectedSubcell,
      selectedFootprint: selectedMachine?.footprint ?? 0,
      scratchPosition,
      scratchScale,
      clearSubcellPicks,
    });
  }

  function applyCubeIsolation(): void {
    applyInteriorCubeIsolation({
      levels,
      cubeFocusCell,
      level,
      scratchPosition,
      scratchMatrix,
      identityQuaternion,
      scratchScale,
    });
    updateSubcellLayer();
  }

  function updateHighlights(): void {
    updateInteriorHighlights({
      selectMesh,
      hoverMesh,
      selectedCell,
      hoveredCell,
      level,
      hull,
      // The cell-sized highlight blankets the cube it marks, so sub-focus
      // drops it rather than looking through it.
      suppressed: cubeFocusCell !== null,
      scratchPosition,
    });
  }

  function pickCell(ndc: THREE.Vector2, camera: THREE.Camera): number {
    return pickInteriorCell({
      ndc,
      camera,
      group,
      hull,
      level,
      size,
      pickRaycaster,
      localRay,
      inverseWorld,
    });
  }

  function clearPicks(): void {
    hoveredCell = -1;
    selectedCell = -1;
    updateHighlights();
    clearSubcellPicks();
    updateSubcellLayer();
  }

  function clearLevels(): void {
    levels = clearInteriorLevels(group, levels);
  }

  function clearLabels(): void {
    if (!labelMesh) return;
    group.remove(labelMesh);
    labelMesh.geometry.dispose();
    const material = labelMesh.material as THREE.MeshBasicMaterial;
    material.map?.dispose();
    material.dispose();
    labelMesh = null;
  }

  function applyVisibility(): void {
    applyInteriorVisibility(levels, level, subfocusEnabled, exteriorUnitsVisible);
  }

  /// A join replaces the machine under the cursor with a larger one, so the
  /// selection is re-resolved from the subcell rather than kept by id.
  function refreshSelectedMachine(): void {
    if (cubeFocusCell === null || selectedSubcell < 0) return;
    selectedMachine = machineAtSubcell(cubeFocusCell, selectedSubcell);
    if (!selectedMachine) selectedSubcell = -1;
  }

  function buildLabels(): void {
    clearLabels();
    const texture = buildInteriorLabelTexture(hull, level);
    if (!texture) return;

    const plane = new THREE.PlaneGeometry(hull.w * size, hull.d * size);
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      side: THREE.DoubleSide,
    });
    labelMesh = new THREE.Mesh(plane, material);
    labelMesh.rotation.x = -Math.PI / 2;
    labelMesh.position.y = -hull.h * size * 0.5 + (level + 0.5) * size;
    labelMesh.renderOrder = 1000;
    labelMesh.visible = labelsVisible || subfocusEnabled;
    group.add(labelMesh);
  }

  function rebuild(): void {
    clearLevels();
    hull = readInteriorHull();
    level = Math.min(level, Math.max(0, hull.h - 1));
    levels = rebuildInteriorLevels({
      group,
      hull,
      size,
      machineGeometry,
      productGeometry,
      unitGeometry,
      scratchMatrix,
      scratchPosition,
      scratchOffset,
      identityQuaternion,
      scratchScale,
    });

    applyVisibility();
    refreshSelectedMachine();
    applyCubeIsolation();
    buildLabels();
    updateHighlights();
    sync();
  }

  function sync(): void {
    syncInteriorLevels({
      levels,
      hull,
      level,
      size,
      cubeFocusCell,
      unitFloorAnchorY: UNIT_FLOOR_ANCHOR_Y,
      selectedUnitId,
      selectedUnitOutline,
      scratchMatrix,
      scratchPosition,
      scratchOffset,
      identityQuaternion,
      scratchScale,
    });
  }

  rebuild();

  return {
    group,
    rebuild,
    sync,
    setExteriorUnitsVisible(visible: boolean) {
      if (visible === exteriorUnitsVisible) return;
      exteriorUnitsVisible = visible;
      applyVisibility();
    },
    setFocusLevel(next: number) {
      const clamped = Math.min(Math.max(0, Math.round(next)), Math.max(0, hull.h - 1));
      if (clamped === level) return;
      level = clamped;
      clearPicks();
      applyVisibility();
      applyCubeIsolation();
      buildLabels();
    },
    setSubfocusEnabled(enabled: boolean) {
      if (enabled === subfocusEnabled) return;
      subfocusEnabled = enabled;
      if (!enabled) clearPicks();
      applyVisibility();
      applyCubeIsolation();
      if (labelMesh) labelMesh.visible = labelsVisible || subfocusEnabled;
    },
    setCubeFocus(cell: number | null) {
      const next = cell !== null && cell >= 0 ? cell : null;
      if (next === cubeFocusCell) return;
      cubeFocusCell = next;
      if (next === null) placementPreview = null;
      clearSubcellPicks();
      updateHighlights();
      applyCubeIsolation();
    },
    pickCell,
    pickSubcell(ndc: THREE.Vector2, camera: THREE.Camera) {
      return pickInteriorSubcell({
        ndc,
        camera,
        group,
        hull,
        level,
        size,
        cubeFocusCell,
        pickRaycaster,
        localRay,
        inverseWorld,
        scratchPosition,
        scratchBox,
        scratchHit,
      });
    },
    setHoveredCell(cell: number) {
      if (cell === hoveredCell) return;
      hoveredCell = cell;
      updateHighlights();
    },
    setSelectedCell(cell: number) {
      if (cell === selectedCell) return;
      selectedCell = cell;
      updateHighlights();
    },
    setHoveredSubcell(local: number) {
      const next =
        cubeFocusCell !== null && machineAtSubcell(cubeFocusCell, local) !== null ? local : -1;
      if (next === hoveredSubcell) return;
      hoveredSubcell = next;
      updateSubcellLayer();
    },
    setSelectedSubcell(local: number) {
      const machine = cubeFocusCell === null ? null : machineAtSubcell(cubeFocusCell, local);
      const next = machine ? local : -1;
      if (next === selectedSubcell && machine?.footprint === selectedMachine?.footprint) return;
      selectedSubcell = next;
      selectedMachine = machine;
      updateSubcellLayer();
    },
    setMachinePlacementPreview(preview: MachinePlacementPreview | null) {
      placementPreview = preview;
      if (preview) {
        const material = subcellGhostMesh.material as THREE.MeshBasicMaterial;
        material.color.setHex(preview.valid ? preview.color : GHOST_BLOCKED_COLOR);
        material.opacity = preview.valid ? 0.55 : 0.35;
      }
      updateSubcellLayer();
    },
    selectedCell: () => selectedCell,
    selectedSubcell: () => selectedSubcell,
    setSelectedUnit(unitId: number | null) {
      selectedUnitId = unitId;
      if (unitId === null) {
        selectedUnitOutline.visible = false;
      }
    },
    setLabelsVisible(visible: boolean) {
      labelsVisible = visible;
      if (labelMesh) labelMesh.visible = labelsVisible || subfocusEnabled;
    },
    dispose() {
      clearLevels();
      clearLabels();
      machineGeometry.dispose();
      productGeometry.dispose();
      unitGeometry.dispose();
      highlightGeometry.dispose();
      subcellGeometry.dispose();
      outlineGeometry.dispose();
      (hoverMesh.material as THREE.Material).dispose();
      (selectMesh.material as THREE.Material).dispose();
      (subcellGhostMesh.material as THREE.Material).dispose();
      (hoverOutline.material as THREE.Material).dispose();
      (subcellOutline.material as THREE.Material).dispose();
      (machineOutline.material as THREE.Material).dispose();
      (subcellGhostMesh.material as THREE.Material).dispose();
      (selectedUnitOutline.material as THREE.Material).dispose();
    },
  };
}
