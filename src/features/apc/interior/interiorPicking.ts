import * as THREE from 'three';
import { getApcInterior } from '../../../entityStore';
import { cellCentre, cellToCoords, subcellLocalIndex, type InteriorHull } from './interiorMath';

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

/// Resolves the subcell the cursor is aiming at by anchoring on the face the
/// ray enters through: the entry face fixes that axis to the subcell just
/// inside it, and the hit position within the face picks the other two. Reading
/// the entry point as a raw octant would leave the far half of the cube
/// unreachable; orbiting to expose a different face is what makes all eight
/// positions selectable.
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

  const hit = [scratchHit.x, scratchHit.y, scratchHit.z];
  const min = [scratchBox.min.x, scratchBox.min.y, scratchBox.min.z];

  let entryAxis = 0;
  let entrySide = 0;
  let closest = Infinity;
  for (let axis = 0; axis < 3; axis += 1) {
    const fromMin = Math.abs(hit[axis] - min[axis]);
    const fromMax = Math.abs(hit[axis] - (min[axis] + size));
    if (fromMin < closest) {
      closest = fromMin;
      entryAxis = axis;
      entrySide = 0;
    }
    if (fromMax < closest) {
      closest = fromMax;
      entryAxis = axis;
      entrySide = 1;
    }
  }

  const coord = [0, 0, 0];
  for (let axis = 0; axis < 3; axis += 1) {
    coord[axis] =
      axis === entryAxis
        ? entrySide
        : Math.min(Math.max(Math.floor((hit[axis] - min[axis]) / half), 0), 1);
  }

  return subcellLocalIndex(coord[0], coord[1], coord[2]);
}
