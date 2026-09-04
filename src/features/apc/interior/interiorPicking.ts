import * as THREE from 'three';
import { getApcInterior } from '../../../entityStore';
import { cellCentre, cellToCoords, type InteriorHull } from './interiorMath';

type PickCellOptions = {
  ndc: THREE.Vector2;
  camera: THREE.Camera;
  group: THREE.Group;
  hull: InteriorHull;
  level: number;
  size: number;
  pickRaycaster: THREE.Raycaster;
  localRay: THREE.Ray;
  inverseWorld: THREE.Matrix4;
};

type PickSubcellOptions = PickCellOptions & {
  cubeFocusCell: number | null;
  scratchPosition: THREE.Vector3;
  scratchBox: THREE.Box3;
  scratchHit: THREE.Vector3;
};

export function pickInteriorCell(options: PickCellOptions): number {
  const {
    ndc,
    camera,
    group,
    hull,
    level,
    size,
    pickRaycaster,
    localRay,
    inverseWorld,
  } = options;

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

export function pickInteriorSubcell(options: PickSubcellOptions): number {
  const {
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
  } = options;

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
}
