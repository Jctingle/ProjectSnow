import * as THREE from 'three';
import { createUnitPegMaterial } from '../../../render/unitPeg';
import { SUBCELLS_PER_CELL } from './interiorMath';

const PRODUCT_COLOR = 0xffdd33;
const BELOW_LEVEL_OPACITY = 0.22;

export type InteriorLevelView = {
  machines: THREE.InstancedMesh;
  products: THREE.InstancedMesh;
  units: THREE.InstancedMesh;
  machineMaterial: THREE.MeshStandardMaterial;
  productMaterial: THREE.MeshStandardMaterial;
  unitMaterial: THREE.MeshStandardMaterial;
  positions: Float32Array;
  /// Subcell span per axis, so a merged machine renders as one stretched box.
  scales: Float32Array;
  cells: Uint32Array;
  slots: Int32Array;
  count: number;
  machineCapacity: number;
  unitCount: number;
  unitCapacity: number;
};

type CreateInteriorLevelOptions = {
  group: THREE.Group;
  machineGeometry: THREE.BoxGeometry;
  productGeometry: THREE.SphereGeometry;
  unitGeometry: THREE.CylinderGeometry;
  cellCapacity: number;
  y: number;
};

export function createInteriorLevel(
  options: CreateInteriorLevelOptions,
): InteriorLevelView {
  const { group, machineGeometry, productGeometry, unitGeometry, cellCapacity, y } = options;

  // White base so per-instance colours from the machine catalogue survive the
  // multiply the standard material applies.
  const machineMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.9,
  });
  const productMaterial = new THREE.MeshStandardMaterial({
    color: PRODUCT_COLOR,
    emissive: PRODUCT_COLOR,
    emissiveIntensity: 0.6,
    transparent: true,
    opacity: 1,
    depthTest: false,
  });
  const unitMaterial = createUnitPegMaterial();
  unitMaterial.depthTest = false;
  unitMaterial.transparent = true;
  unitMaterial.opacity = 0.95;
  const machineCapacity = Math.max(1, cellCapacity * SUBCELLS_PER_CELL);
  const unitCapacity = Math.max(1, cellCapacity * 4);

  const machines = new THREE.InstancedMesh(machineGeometry, machineMaterial, machineCapacity);
  const products = new THREE.InstancedMesh(productGeometry, productMaterial, machineCapacity);
  const units = new THREE.InstancedMesh(unitGeometry, unitMaterial, unitCapacity);
  machines.count = 0;
  products.count = 0;
  units.count = 0;
  machines.renderOrder = 2 + y * 2;
  products.renderOrder = 3 + y * 2;
  units.renderOrder = 4 + y * 2;
  machines.frustumCulled = false;
  products.frustumCulled = false;
  units.frustumCulled = false;

  group.add(machines);
  group.add(products);
  group.add(units);

  return {
    machines,
    products,
    units,
    machineMaterial,
    productMaterial,
    unitMaterial,
    positions: new Float32Array(machineCapacity * 3),
    scales: new Float32Array(machineCapacity * 3),
    cells: new Uint32Array(machineCapacity),
    slots: new Int32Array(machineCapacity).fill(-1),
    count: 0,
    machineCapacity,
    unitCount: 0,
    unitCapacity,
  };
}

export function clearInteriorLevels(
  group: THREE.Group,
  levels: InteriorLevelView[],
): InteriorLevelView[] {
  for (const level of levels) {
    group.remove(level.machines);
    group.remove(level.products);
    group.remove(level.units);
    level.machineMaterial.dispose();
    level.productMaterial.dispose();
    level.unitMaterial.dispose();
  }
  return [];
}

export function applyInteriorVisibility(
  levels: InteriorLevelView[],
  level: number,
  subfocusEnabled: boolean,
  exteriorUnitsVisible: boolean,
): void {
  for (let y = 0; y < levels.length; y += 1) {
    const current = levels[y];
    const hidden = subfocusEnabled && y > level;
    const dimmed = subfocusEnabled && y < level;
    const unitsVisible = !hidden && (subfocusEnabled || exteriorUnitsVisible);

    current.machines.visible = !hidden;
    current.products.visible = !hidden;
    current.units.visible = unitsVisible;
    current.machineMaterial.opacity = dimmed ? BELOW_LEVEL_OPACITY : 0.9;
    current.productMaterial.opacity = dimmed ? BELOW_LEVEL_OPACITY : 1;
    current.unitMaterial.opacity = dimmed ? BELOW_LEVEL_OPACITY : 0.95;
    current.machineMaterial.depthWrite = !dimmed;
    current.productMaterial.depthWrite = !dimmed;
    current.unitMaterial.depthWrite = !dimmed;
  }
}
