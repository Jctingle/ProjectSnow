import * as THREE from 'three';
import { getApcInterior, getApcMachineCells, getApcMachineHolding } from '../entityStore';
import { APC_GRID_CELL_SIZE } from '../sim/config';

const MACHINE_COLOR = 0x8899aa;
const PRODUCT_COLOR = 0xffdd33;
const MACHINE_FILL_RATIO = 0.78;
const PRODUCT_FILL_RATIO = 0.34;
const LABEL_CELL_PIXELS = 64;
/// Floors below the focused one stay readable as context; floors above are hidden outright.
const BELOW_LEVEL_OPACITY = 0.22;
const HOVER_COLOR = 0x40e0d0;
const SELECT_COLOR = 0x2266ff;
const HIGHLIGHT_FILL_RATIO = 0.92;
const SUBCELL_SIZE_RATIO = 0.48;
const SUBCELL_FILL_OPACITY = 0.16;
const SUBCELL_HOVER_COLOR = 0x33fff1;
const SUBCELL_SELECT_COLOR = 0xff7e29;

export type ApcInteriorView = {
  group: THREE.Group;
  rebuild(): void;
  sync(): void;
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
  setLabelsVisible(visible: boolean): void;
  dispose(): void;
};

type Hull = { w: number; h: number; d: number };

type LevelView = {
  machines: THREE.InstancedMesh;
  products: THREE.InstancedMesh;
  machineMaterial: THREE.MeshStandardMaterial;
  productMaterial: THREE.MeshStandardMaterial;
  positions: Float32Array;
  cells: Uint32Array;
  slots: Int32Array;
  count: number;
};

function readHull(): Hull {
  const interior = getApcInterior();
  return { w: interior.hull_w(), h: interior.hull_h(), d: interior.hull_d() };
}

/// Seam for multi-floor rooms: a room spanning floors will report its ground
/// floor here instead of the cell's own Y.
function displayLevel(cellY: number): number {
  return cellY;
}

/// Cell centre in APC-local space; the hull box is centred on the mesh origin.
function cellCentre(x: number, y: number, z: number, hull: Hull, out: THREE.Vector3): THREE.Vector3 {
  const size = APC_GRID_CELL_SIZE;
  return out.set(
    -hull.w * size * 0.5 + (x + 0.5) * size,
    -hull.h * size * 0.5 + (y + 0.5) * size,
    -hull.d * size * 0.5 + (z + 0.5) * size,
  );
}

/**
 * One canvas for the whole level instead of a sprite per cell: a full-envelope
 * level is 300 cells, which would otherwise be 300 draw calls.
 */
function buildLabelTexture(hull: Hull, level: number): THREE.CanvasTexture | null {
  const interior = getApcInterior();
  const canvas = document.createElement('canvas');
  canvas.width = hull.w * LABEL_CELL_PIXELS;
  canvas.height = hull.d * LABEL_CELL_PIXELS;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = `${Math.floor(LABEL_CELL_PIXELS * 0.28)}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (let z = 0; z < hull.d; z += 1) {
    for (let x = 0; x < hull.w; x += 1) {
      const px = x * LABEL_CELL_PIXELS;
      const py = z * LABEL_CELL_PIXELS;
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 2;
      ctx.strokeRect(px + 1, py + 1, LABEL_CELL_PIXELS - 2, LABEL_CELL_PIXELS - 2);

      const index = interior.cell_index(x, level, z);
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.fillText(
        String(index),
        px + LABEL_CELL_PIXELS * 0.5,
        py + LABEL_CELL_PIXELS * 0.5,
      );
      ctx.fillStyle = 'rgba(150,200,255,0.8)';
      ctx.fillText(
        `${x},${level},${z}`,
        px + LABEL_CELL_PIXELS * 0.5,
        py + LABEL_CELL_PIXELS * 0.78,
      );
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

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

  let levels: LevelView[] = [];
  let labelMesh: THREE.Mesh | null = null;
  let labelsVisible = false;
  let subfocusEnabled = false;
  let level = 0;
  let hull: Hull = readHull();

  const scratchMatrix = new THREE.Matrix4();
  const scratchPosition = new THREE.Vector3();
  const identityQuaternion = new THREE.Quaternion();
  const scratchScale = new THREE.Vector3();
  const scratchBox = new THREE.Box3();
  const scratchHit = new THREE.Vector3();

  const pickRaycaster = new THREE.Raycaster();
  const localRay = new THREE.Ray();
  const inverseWorld = new THREE.Matrix4();

  let hoveredCell = -1;
  let selectedCell = -1;
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
      // Ignores depth like the grid and labels: the hull writes depth in the
      // transparent pass, which would otherwise bury it.
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

  function cellToCoords(cell: number): { x: number; y: number; z: number } | null {
    if (cell < 0) return null;
    const interior = getApcInterior();
    const stride = interior.envelope_w() * interior.envelope_d();
    const y = Math.floor(cell / stride);
    const remainder = cell % stride;
    return { x: remainder % interior.envelope_w(), y, z: Math.floor(remainder / interior.envelope_w()) };
  }

  function placeHighlight(mesh: THREE.Mesh, cell: number): void {
    const coords = cellToCoords(cell);
    if (!coords || coords.y !== level) {
      mesh.visible = false;
      return;
    }
    cellCentre(coords.x, coords.y, coords.z, hull, scratchPosition);
    mesh.position.copy(scratchPosition);
    mesh.visible = true;
  }

  function subcellOffset(local: number, out: THREE.Vector3): THREE.Vector3 {
    const x = local & 1;
    const z = (local >> 1) & 1;
    const y = (local >> 2) & 1;
    const half = size * 0.25;
    return out.set(
      x === 0 ? -half : half,
      y === 0 ? -half : half,
      z === 0 ? -half : half,
    );
  }

  function clearSubcellPicks(): void {
    hoveredSubcell = -1;
    selectedSubcell = -1;
    subcellHoverMesh.visible = false;
    subcellSelectMesh.visible = false;
  }

  function updateSubcellLayer(): void {
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
      subcellOffset(local, scratchPosition);
      subcellPreviewMeshes[local].position.copy(scratchPosition);
    }

    if (selectedSubcell >= 0 && selectedSubcell < 8) {
      subcellOffset(selectedSubcell, scratchPosition);
      subcellSelectMesh.position.copy(scratchPosition);
      subcellSelectMesh.visible = true;
    } else {
      subcellSelectMesh.visible = false;
    }

    if (hoveredSubcell >= 0 && hoveredSubcell < 8 && hoveredSubcell !== selectedSubcell) {
      subcellOffset(hoveredSubcell, scratchPosition);
      subcellHoverMesh.position.copy(scratchPosition);
      subcellHoverMesh.visible = true;
    } else {
      subcellHoverMesh.visible = false;
    }
  }

  function applyCubeIsolation(): void {
    for (let y = 0; y < levels.length; y += 1) {
      const lv = levels[y];
      for (let local = 0; local < lv.count; local += 1) {
        const show = cubeFocusCell === null || y !== level || lv.cells[local] === cubeFocusCell;
        scratchPosition.set(
          lv.positions[local * 3],
          lv.positions[local * 3 + 1],
          lv.positions[local * 3 + 2],
        );
        const s = show ? 1 : 0;
        scratchMatrix.compose(scratchPosition, identityQuaternion, scratchScale.set(s, s, s));
        lv.machines.setMatrixAt(local, scratchMatrix);
      }
      lv.machines.instanceMatrix.needsUpdate = true;
    }
    updateSubcellLayer();
  }

  function updateHighlights(): void {
    placeHighlight(selectMesh, selectedCell);
    // A selected cell keeps its blue rather than flickering to hover turquoise.
    placeHighlight(hoverMesh, hoveredCell === selectedCell ? -1 : hoveredCell);
  }

  /// Intersects the focused floor's plane in APC-local space rather than
  /// raycasting geometry, so empty cells pick exactly like occupied ones.
  /// No `t >= 0` gate: this camera's ortho depth range makes that rejection
  /// unreliable, and the manual solve does not need it.
  function pickCell(ndc: THREE.Vector2, camera: THREE.Camera): number {
    if (hull.h === 0 || hull.w === 0 || hull.d === 0) return -1;

    pickRaycaster.setFromCamera(ndc, camera);
    inverseWorld.copy(group.matrixWorld).invert();
    localRay.copy(pickRaycaster.ray).applyMatrix4(inverseWorld);
    if (Math.abs(localRay.direction.y) < 1e-8) return -1;

    const planeY = -hull.h * size * 0.5 + (level + 0.5) * size;
    const t = (planeY - localRay.origin.y) / localRay.direction.y;
    const localX = localRay.origin.x + localRay.direction.x * t;
    const localZ = localRay.origin.z + localRay.direction.z * t;

    const cx = Math.floor((localX + hull.w * size * 0.5) / size);
    const cz = Math.floor((localZ + hull.d * size * 0.5) / size);
    if (cx < 0 || cx >= hull.w || cz < 0 || cz >= hull.d) return -1;

    return getApcInterior().cell_index(cx, level, cz);
  }

  function clearPicks(): void {
    hoveredCell = -1;
    selectedCell = -1;
    updateHighlights();
    clearSubcellPicks();
    updateSubcellLayer();
  }

  function clearLevels(): void {
    for (const lv of levels) {
      group.remove(lv.machines);
      group.remove(lv.products);
      lv.machineMaterial.dispose();
      lv.productMaterial.dispose();
    }
    levels = [];
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

  /// Instances are allocated at per-floor cell capacity rather than current
  /// machine count so machines can appear and vanish without reallocating.
  function createLevel(y: number, capacity: number): LevelView {
    const machineMaterial = new THREE.MeshStandardMaterial({
      color: MACHINE_COLOR,
      transparent: true,
      opacity: 0.9,
    });
    // The marker sits inside its machine cube, so it has to ignore depth or the
    // cube's front face occludes it entirely.
    const productMaterial = new THREE.MeshStandardMaterial({
      color: PRODUCT_COLOR,
      emissive: PRODUCT_COLOR,
      emissiveIntensity: 0.6,
      transparent: true,
      opacity: 1,
      depthTest: false,
    });

    const machines = new THREE.InstancedMesh(machineGeometry, machineMaterial, capacity);
    const products = new THREE.InstancedMesh(productGeometry, productMaterial, capacity);
    machines.count = 0;
    products.count = 0;
    // Bottom-to-top ordering so transparent lower floors composite correctly.
    machines.renderOrder = 2 + y * 2;
    products.renderOrder = 3 + y * 2;
    machines.frustumCulled = false;
    products.frustumCulled = false;

    group.add(machines);
    group.add(products);

    return {
      machines,
      products,
      machineMaterial,
      productMaterial,
      positions: new Float32Array(capacity * 3),
      cells: new Uint32Array(capacity),
      slots: new Int32Array(capacity).fill(-1),
      count: 0,
    };
  }

  function applyVisibility(): void {
    for (let y = 0; y < levels.length; y += 1) {
      const lv = levels[y];
      const hidden = subfocusEnabled && y > level;
      const dimmed = subfocusEnabled && y < level;

      lv.machines.visible = !hidden;
      lv.products.visible = !hidden;
      lv.machineMaterial.opacity = dimmed ? BELOW_LEVEL_OPACITY : 0.9;
      lv.productMaterial.opacity = dimmed ? BELOW_LEVEL_OPACITY : 1;
      lv.machineMaterial.depthWrite = !dimmed;
      lv.productMaterial.depthWrite = !dimmed;
    }
  }

  function buildLabels(): void {
    clearLabels();
    const texture = buildLabelTexture(hull, level);
    if (!texture) return;

    const plane = new THREE.PlaneGeometry(hull.w * size, hull.d * size);
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      side: THREE.DoubleSide,
    });
    labelMesh = new THREE.Mesh(plane, material);
    // -90deg about X puts the plane in XZ with texture-up mapping to -Z, so
    // canvas row 0 lines up with cell z = 0.
    labelMesh.rotation.x = -Math.PI / 2;
    labelMesh.position.y = -hull.h * size * 0.5 + (level + 0.5) * size;
    labelMesh.renderOrder = 1000;
    labelMesh.visible = labelsVisible || subfocusEnabled;
    group.add(labelMesh);
  }

  function rebuild(): void {
    clearLevels();
    hull = readHull();
    level = Math.min(level, Math.max(0, hull.h - 1));

    const capacity = Math.max(1, hull.w * hull.d);
    for (let y = 0; y < hull.h; y += 1) levels.push(createLevel(y, capacity));

    const interior = getApcInterior();
    const count = interior.machine_count();
    const cells = getApcMachineCells();
    const envelopeW = interior.envelope_w();
    const envelopeD = interior.envelope_d();
    const levelStride = envelopeW * envelopeD;

    for (let slot = 0; slot < count; slot += 1) {
      const cell = cells[slot];
      const y = Math.floor(cell / levelStride);
      const remainder = cell % levelStride;
      const x = remainder % envelopeW;
      const z = Math.floor(remainder / envelopeW);

      const target = levels[displayLevel(y)];
      if (!target || target.count >= capacity) continue;

      const local = target.count;
      target.count += 1;
      target.slots[local] = slot;
      target.cells[local] = cell;

      cellCentre(x, y, z, hull, scratchPosition);
      target.positions[local * 3] = scratchPosition.x;
      target.positions[local * 3 + 1] = scratchPosition.y;
      target.positions[local * 3 + 2] = scratchPosition.z;

      scratchMatrix.compose(scratchPosition, identityQuaternion, scratchScale.set(1, 1, 1));
      target.machines.setMatrixAt(local, scratchMatrix);
      scratchMatrix.compose(scratchPosition, identityQuaternion, scratchScale.set(0, 0, 0));
      target.products.setMatrixAt(local, scratchMatrix);
    }

    for (const lv of levels) {
      lv.machines.count = lv.count;
      lv.products.count = lv.count;
      lv.machines.instanceMatrix.needsUpdate = true;
      lv.products.instanceMatrix.needsUpdate = true;
    }

    applyVisibility();
    applyCubeIsolation();
    buildLabels();
    updateHighlights();
    sync();
  }

  /// Product markers snap between cells so the one-cell-per-step invariant
  /// stays visible; interpolating would hide exactly what this stage verifies.
  /// State is read absolutely from the sim rather than accumulated, so a hidden
  /// floor renders correctly on the first frame it is revealed despite being skipped.
  function sync(): void {
    const holding = getApcMachineHolding();

    for (let y = 0; y < levels.length; y += 1) {
      const lv = levels[y];
      if (!lv.products.visible) continue;

      for (let local = 0; local < lv.count; local += 1) {
        const slot = lv.slots[local];
        const visibleByCube = cubeFocusCell === null || y !== level || lv.cells[local] === cubeFocusCell;
        const on =
          visibleByCube && slot >= 0 && slot < holding.length && holding[slot] !== 0 ? 1 : 0;
        scratchPosition.set(
          lv.positions[local * 3],
          lv.positions[local * 3 + 1],
          lv.positions[local * 3 + 2],
        );
        scratchMatrix.compose(scratchPosition, identityQuaternion, scratchScale.set(on, on, on));
        lv.products.setMatrixAt(local, scratchMatrix);
      }
      lv.products.instanceMatrix.needsUpdate = true;
    }
  }

  rebuild();

  return {
    group,
    rebuild,
    sync,
    setFocusLevel(next: number) {
      const clamped = Math.min(Math.max(0, Math.round(next)), Math.max(0, hull.h - 1));
      if (clamped === level) return;
      level = clamped;
      // Scrolling away from a floor drops its selection rather than carrying it.
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
      if (cubeFocusCell === null) return -1;
      const coords = cellToCoords(cubeFocusCell);
      if (!coords || coords.y !== level) return -1;

      pickRaycaster.setFromCamera(ndc, camera);
      inverseWorld.copy(group.matrixWorld).invert();
      localRay.copy(pickRaycaster.ray).applyMatrix4(inverseWorld);

      cellCentre(coords.x, coords.y, coords.z, hull, scratchPosition);
      const half = size * 0.5;
      scratchBox.min.set(
        scratchPosition.x - half,
        scratchPosition.y - half,
        scratchPosition.z - half,
      );
      scratchBox.max.set(
        scratchPosition.x + half,
        scratchPosition.y + half,
        scratchPosition.z + half,
      );

      if (!localRay.intersectBox(scratchBox, scratchHit)) return -1;

      const relX = Math.min(Math.max((scratchHit.x - scratchBox.min.x) / (size * 0.5), 0), 1.999999);
      const relY = Math.min(Math.max((scratchHit.y - scratchBox.min.y) / (size * 0.5), 0), 1.999999);
      const relZ = Math.min(Math.max((scratchHit.z - scratchBox.min.z) / (size * 0.5), 0), 1.999999);
      const lx = Math.floor(relX);
      const ly = Math.floor(relY);
      const lz = Math.floor(relZ);
      return lx + 2 * (lz + 2 * ly);
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
    setLabelsVisible(visible: boolean) {
      labelsVisible = visible;
      if (labelMesh) labelMesh.visible = labelsVisible || subfocusEnabled;
    },
    dispose() {
      clearLevels();
      clearLabels();
      machineGeometry.dispose();
      productGeometry.dispose();
      highlightGeometry.dispose();
      subcellGeometry.dispose();
      (hoverMesh.material as THREE.Material).dispose();
      (selectMesh.material as THREE.Material).dispose();
      for (const mesh of subcellPreviewMeshes) {
        (mesh.material as THREE.Material).dispose();
      }
      (subcellHoverMesh.material as THREE.Material).dispose();
      (subcellSelectMesh.material as THREE.Material).dispose();
    },
  };
}
