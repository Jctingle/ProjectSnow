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
import { createUnitPegGeometry, UNIT_PEG_Y_OFFSET } from '../render/unitPeg';

const MACHINE_FILL_RATIO = 0.78;
const PRODUCT_FILL_RATIO = 0.34;
const HOVER_COLOR = 0x40e0d0;
const SELECT_COLOR = 0x2266ff;
const HIGHLIGHT_FILL_RATIO = 0.92;
const SUBCELL_SIZE_RATIO = 0.48;
const SUBCELL_FILL_OPACITY = 0.16;
const SUBCELL_HOVER_COLOR = 0x33fff1;
const SUBCELL_SELECT_COLOR = 0xff7e29;
const UNIT_SELECTION_OUTLINE_COLOR = 0xe0b84f;
const UNIT_FLOOR_ANCHOR_Y = -APC_GRID_CELL_SIZE * 0.5 + UNIT_PEG_Y_OFFSET;

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
  setHoveredSubcell(local: number): void;
  setSelectedSubcell(local: number): void;
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
  const machineGeometry = new THREE.BoxGeometry(
    size * MACHINE_FILL_RATIO,
    size * MACHINE_FILL_RATIO,
    size * MACHINE_FILL_RATIO,
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

  const subcellPreviewMeshes: THREE.Mesh[] = [];
  for (let i = 0; i < 8; i += 1) {
    const mesh = new THREE.Mesh(
      subcellGeometry,
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: SUBCELL_FILL_OPACITY,
        depthTest: false,
        depthWrite: false,
      }),
    );
    subcellLayer.add(mesh);
    subcellPreviewMeshes.push(mesh);
  }

  const subcellHoverMesh = new THREE.Mesh(
    subcellGeometry,
    new THREE.MeshBasicMaterial({
      color: SUBCELL_HOVER_COLOR,
      transparent: true,
      opacity: 0.5,
      depthTest: false,
      depthWrite: false,
    }),
  );
  subcellHoverMesh.visible = false;
  subcellLayer.add(subcellHoverMesh);

  const subcellSelectMesh = new THREE.Mesh(
    subcellGeometry,
    new THREE.MeshBasicMaterial({
      color: SUBCELL_SELECT_COLOR,
      transparent: true,
      opacity: 0.6,
      depthTest: false,
      depthWrite: false,
    }),
  );
  subcellSelectMesh.visible = false;
  subcellLayer.add(subcellSelectMesh);

  function clearSubcellPicks(): void {
    hoveredSubcell = -1;
    selectedSubcell = -1;
    subcellHoverMesh.visible = false;
    subcellSelectMesh.visible = false;
  }

  function updateSubcellLayer(): void {
    updateInteriorSubcellLayer({
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
      machineGeometry,
      productGeometry,
      unitGeometry,
      scratchMatrix,
      scratchPosition,
      identityQuaternion,
      scratchScale,
    });

    applyVisibility();
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
      clearSubcellPicks();
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
      if (local === hoveredSubcell) return;
      hoveredSubcell = local;
      updateSubcellLayer();
    },
    setSelectedSubcell(local: number) {
      if (local === selectedSubcell) return;
      selectedSubcell = local;
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
      (hoverMesh.material as THREE.Material).dispose();
      (selectMesh.material as THREE.Material).dispose();
      for (const mesh of subcellPreviewMeshes) {
        (mesh.material as THREE.Material).dispose();
      }
      (subcellHoverMesh.material as THREE.Material).dispose();
      (subcellSelectMesh.material as THREE.Material).dispose();
      (selectedUnitOutline.material as THREE.Material).dispose();
    },
  };
}
