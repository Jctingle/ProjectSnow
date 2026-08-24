import * as THREE from 'three';
import { getApcInterior, getApcMachineCells, getApcMachineHolding } from '../entityStore';
import { APC_GRID_CELL_SIZE } from '../sim/config';

const MACHINE_COLOR = 0x8899aa;
const PRODUCT_COLOR = 0xffdd33;
const MACHINE_FILL_RATIO = 0.78;
const PRODUCT_FILL_RATIO = 0.34;
const LABEL_CELL_PIXELS = 64;

export type ApcInteriorView = {
  group: THREE.Group;
  rebuild(): void;
  sync(): void;
  setFocusLevel(level: number): void;
  focusLevel(): number;
  setLabelsVisible(visible: boolean): void;
  dispose(): void;
};

type Hull = { w: number; h: number; d: number };

function readHull(): Hull {
  const interior = getApcInterior();
  return { w: interior.hull_w(), h: interior.hull_h(), d: interior.hull_d() };
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

function disposeObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
      child.geometry.dispose();
      const material = child.material;
      if (Array.isArray(material)) material.forEach((m) => m.dispose());
      else material.dispose();
    }
  });
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

  let machineMesh: THREE.InstancedMesh | null = null;
  let productMesh: THREE.InstancedMesh | null = null;
  let labelMesh: THREE.Mesh | null = null;
  let labelsVisible = false;
  let level = 0;
  let hull: Hull = readHull();

  const scratchMatrix = new THREE.Matrix4();
  const scratchPosition = new THREE.Vector3();
  const scratchQuaternion = new THREE.Quaternion();
  const scratchScale = new THREE.Vector3();

  function clearChildren(): void {
    for (const child of [...group.children]) {
      group.remove(child);
      disposeObject(child);
    }
    if (labelMesh) {
      const material = labelMesh.material as THREE.MeshBasicMaterial;
      material.map?.dispose();
    }
    machineMesh = null;
    productMesh = null;
    labelMesh = null;
  }

  function buildLabels(): void {
    const texture = buildLabelTexture(hull, level);
    if (!texture) return;

    const size = APC_GRID_CELL_SIZE;
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
    labelMesh.renderOrder = 3;
    labelMesh.visible = labelsVisible;
    group.add(labelMesh);
  }

  function rebuild(): void {
    clearChildren();
    hull = readHull();
    level = Math.min(level, Math.max(0, hull.h - 1));

    const interior = getApcInterior();
    const count = interior.machine_count();

    if (count > 0) {
      const size = APC_GRID_CELL_SIZE;
      const cells = getApcMachineCells();

      machineMesh = new THREE.InstancedMesh(
        new THREE.BoxGeometry(
          size * MACHINE_FILL_RATIO,
          size * MACHINE_FILL_RATIO,
          size * MACHINE_FILL_RATIO,
        ),
        new THREE.MeshStandardMaterial({
          color: MACHINE_COLOR,
          transparent: true,
          opacity: 0.9,
        }),
        count,
      );
      machineMesh.renderOrder = 2;

      productMesh = new THREE.InstancedMesh(
        new THREE.SphereGeometry(size * PRODUCT_FILL_RATIO * 0.5, 10, 8),
        new THREE.MeshStandardMaterial({
          color: PRODUCT_COLOR,
          emissive: PRODUCT_COLOR,
          emissiveIntensity: 0.6,
        }),
        count,
      );
      productMesh.renderOrder = 4;

      const envelopeW = interior.envelope_w();
      const envelopeD = interior.envelope_d();
      const levelStride = envelopeW * envelopeD;

      for (let slot = 0; slot < count; slot += 1) {
        const cell = cells[slot];
        const y = Math.floor(cell / levelStride);
        const remainder = cell % levelStride;
        const x = remainder % envelopeW;
        const z = Math.floor(remainder / envelopeW);

        cellCentre(x, y, z, hull, scratchPosition);
        scratchMatrix.compose(
          scratchPosition,
          scratchQuaternion.identity(),
          scratchScale.set(1, 1, 1),
        );
        machineMesh.setMatrixAt(slot, scratchMatrix);
        productMesh.setMatrixAt(slot, scratchMatrix);
      }

      machineMesh.instanceMatrix.needsUpdate = true;
      productMesh.instanceMatrix.needsUpdate = true;

      group.add(machineMesh);
      group.add(productMesh);
    }

    buildLabels();
    sync();
  }

  /// Product markers snap between cells so the one-cell-per-step invariant
  /// stays visible; interpolating would hide exactly what this stage verifies.
  function sync(): void {
    if (!productMesh) return;
    const holding = getApcMachineHolding();
    const count = Math.min(productMesh.count, holding.length);

    for (let slot = 0; slot < count; slot += 1) {
      productMesh.getMatrixAt(slot, scratchMatrix);
      scratchMatrix.decompose(scratchPosition, scratchQuaternion, scratchScale);
      const visible = holding[slot] !== 0 ? 1 : 0;
      scratchMatrix.compose(
        scratchPosition,
        scratchQuaternion,
        scratchScale.set(visible, visible, visible),
      );
      productMesh.setMatrixAt(slot, scratchMatrix);
    }
    productMesh.instanceMatrix.needsUpdate = true;
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
      if (labelMesh) {
        group.remove(labelMesh);
        (labelMesh.material as THREE.MeshBasicMaterial).map?.dispose();
        disposeObject(labelMesh);
        labelMesh = null;
      }
      buildLabels();
    },
    focusLevel: () => level,
    setLabelsVisible(visible: boolean) {
      labelsVisible = visible;
      if (labelMesh) labelMesh.visible = visible;
    },
    dispose: clearChildren,
  };
}
