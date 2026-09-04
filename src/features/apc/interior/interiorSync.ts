import * as THREE from 'three';
import {
  getApcInterior,
  getApcMachineCells,
  getApcMachineHolding,
  getInteriorUnitCells,
  getInteriorUnitIds,
  getInteriorUnitSubcells,
} from '../../../entityStore';
import {
  cellCentre,
  displayInteriorLevel,
  subcellOffset,
  type InteriorHull,
} from './interiorMath';
import {
  createInteriorLevel,
  type InteriorLevelView,
} from './interiorRender';

const EMPTY_CELL = 0xffffffff;
const EMPTY_SUBCELL = 0xff;

type RebuildInteriorLevelsOptions = {
  group: THREE.Group;
  hull: InteriorHull;
  machineGeometry: THREE.BoxGeometry;
  productGeometry: THREE.SphereGeometry;
  unitGeometry: THREE.CylinderGeometry;
  scratchMatrix: THREE.Matrix4;
  scratchPosition: THREE.Vector3;
  identityQuaternion: THREE.Quaternion;
  scratchScale: THREE.Vector3;
};

type SyncInteriorLevelsOptions = {
  levels: InteriorLevelView[];
  hull: InteriorHull;
  level: number;
  size: number;
  cubeFocusCell: number | null;
  unitFloorAnchorY: number;
  selectedUnitId: number | null;
  selectedUnitOutline: THREE.Mesh;
  scratchMatrix: THREE.Matrix4;
  scratchPosition: THREE.Vector3;
  scratchOffset: THREE.Vector3;
  identityQuaternion: THREE.Quaternion;
  scratchScale: THREE.Vector3;
};

export function rebuildInteriorLevels(options: RebuildInteriorLevelsOptions): InteriorLevelView[] {
  const {
    group,
    hull,
    machineGeometry,
    productGeometry,
    unitGeometry,
    scratchMatrix,
    scratchPosition,
    identityQuaternion,
    scratchScale,
  } = options;

  const levels: InteriorLevelView[] = [];
  const capacity = Math.max(1, hull.w * hull.d);
  for (let y = 0; y < hull.h; y += 1) {
    levels.push(
      createInteriorLevel({
        group,
        machineGeometry,
        productGeometry,
        unitGeometry,
        capacity,
        y,
      }),
    );
  }

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

    const target = levels[displayInteriorLevel(y)];
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

  for (const level of levels) {
    level.machines.count = level.count;
    level.products.count = level.count;
    level.machines.instanceMatrix.needsUpdate = true;
    level.products.instanceMatrix.needsUpdate = true;
  }

  return levels;
}

export function syncInteriorLevels(options: SyncInteriorLevelsOptions): void {
  const {
    levels,
    hull,
    level,
    size,
    cubeFocusCell,
    unitFloorAnchorY,
    selectedUnitId,
    selectedUnitOutline,
    scratchMatrix,
    scratchPosition,
    scratchOffset,
    identityQuaternion,
    scratchScale,
  } = options;

  const holding = getApcMachineHolding();
  const interior = getApcInterior();
  const unitIds = getInteriorUnitIds();
  const unitCells = getInteriorUnitCells();
  const unitSubcells = getInteriorUnitSubcells();
  const unitTotal = interior.interior_unit_count();
  const envelopeW = interior.envelope_w();
  const envelopeD = interior.envelope_d();
  const levelStride = envelopeW * envelopeD;
  let selectedUnitVisible = false;

  for (let y = 0; y < levels.length; y += 1) {
    const current = levels[y];
    current.unitCount = 0;
    current.units.count = 0;
    if (!current.products.visible) continue;

    for (let local = 0; local < current.count; local += 1) {
      const slot = current.slots[local];
      const visibleByCube = cubeFocusCell === null || y !== level || current.cells[local] === cubeFocusCell;
      const visible =
        visibleByCube && slot >= 0 && slot < holding.length && holding[slot] !== 0 ? 1 : 0;
      scratchPosition.set(
        current.positions[local * 3],
        current.positions[local * 3 + 1],
        current.positions[local * 3 + 2],
      );
      scratchMatrix.compose(
        scratchPosition,
        identityQuaternion,
        scratchScale.set(visible, visible, visible),
      );
      current.products.setMatrixAt(local, scratchMatrix);
    }
    current.products.instanceMatrix.needsUpdate = true;
  }

  for (let slot = 0; slot < unitTotal; slot += 1) {
    const cell = unitCells[slot];
    const local = unitSubcells[slot];
    if (cell === EMPTY_CELL || local === EMPTY_SUBCELL || local > 3) continue;

    const y = Math.floor(cell / levelStride);
    const target = levels[displayInteriorLevel(y)];
    if (!target) continue;
    if (target.unitCount >= target.unitCapacity) continue;

    const remainder = cell % levelStride;
    const x = remainder % envelopeW;
    const z = Math.floor(remainder / envelopeW);
    const visibleByCube = cubeFocusCell === null || y !== level || cell === cubeFocusCell;

    cellCentre(x, y, z, hull, scratchPosition);
    subcellOffset(local, size, scratchOffset);
    scratchPosition.x += scratchOffset.x;
    scratchPosition.z += scratchOffset.z;
    scratchPosition.y += unitFloorAnchorY;
    const scale = visibleByCube ? 1 : 0;
    scratchMatrix.compose(scratchPosition, identityQuaternion, scratchScale.set(scale, scale, scale));
    target.units.setMatrixAt(target.unitCount, scratchMatrix);
    if (
      unitIds[slot] === selectedUnitId &&
      target.units.visible &&
      visibleByCube
    ) {
      selectedUnitOutline.position.copy(scratchPosition);
      selectedUnitVisible = true;
    }
    target.unitCount += 1;
  }

  for (const current of levels) {
    current.units.count = current.unitCount;
    current.units.instanceMatrix.needsUpdate = true;
  }

  selectedUnitOutline.visible = selectedUnitVisible;
}