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

export type ApcInteriorView = {
  group: THREE.Group;
  rebuild(): void;
  sync(): void;
  setFocusLevel(level: number): void;
  focusLevel(): number;
  setSubfocusEnabled(enabled: boolean): void;
  cellAt(level: number, instanceId: number): number;
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
  cells: Int32Array;
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
    const productMaterial = new THREE.MeshStandardMaterial({
      color: PRODUCT_COLOR,
      emissive: PRODUCT_COLOR,
      emissiveIntensity: 0.6,
      transparent: true,
      opacity: 1,
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
      cells: new Int32Array(capacity).fill(-1),
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
      target.cells[local] = cell;
      target.slots[local] = slot;

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
    buildLabels();
    sync();
  }

  /// Product markers snap between cells so the one-cell-per-step invariant
  /// stays visible; interpolating would hide exactly what this stage verifies.
  /// State is read absolutely from the sim rather than accumulated, so a hidden
  /// floor renders correctly on the first frame it is revealed despite being skipped.
  function sync(): void {
    const holding = getApcMachineHolding();

    for (const lv of levels) {
      if (!lv.products.visible) continue;

      for (let local = 0; local < lv.count; local += 1) {
        const slot = lv.slots[local];
        const on = slot >= 0 && slot < holding.length && holding[slot] !== 0 ? 1 : 0;
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
      applyVisibility();
      buildLabels();
    },
    focusLevel: () => level,
    setSubfocusEnabled(enabled: boolean) {
      if (enabled === subfocusEnabled) return;
      subfocusEnabled = enabled;
      applyVisibility();
      if (labelMesh) labelMesh.visible = labelsVisible || subfocusEnabled;
    },
    /// Maps a raycast instanceId back to its sim cell; -1 when out of range.
    cellAt(targetLevel: number, instanceId: number) {
      const lv = levels[targetLevel];
      if (!lv || instanceId < 0 || instanceId >= lv.count) return -1;
      return lv.cells[instanceId];
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
    },
  };
}
