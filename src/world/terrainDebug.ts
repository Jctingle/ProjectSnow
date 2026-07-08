import * as THREE from 'three';
import {
  GROUND_SIZE,
  HEIGHTMAP_GRID_SIZE,
} from '../sim/config';

// Gradient B (blue -> cyan -> green -> yellow -> red), driven by percent
// grade (rise/run * 100) rather than raw degrees. Percent grade is the
// standard "how steep" unit (100% = 45 degrees) and spreads this terrain's
// actual slope range far better than degrees/SLOPE_HARD_DEG did - that
// mapping saturated almost the whole mesh red, since most slopes here
// exceed 28 degrees long before they're actually unclimbable.
const GRADE_MAX_PERCENT = 100;

const GRADIENT_B_STOPS: [number, number, number][] = [
  [0, 0, 1], // blue   t=0.00
  [0, 1, 1], // cyan   t=0.25
  [0, 1, 0], // green  t=0.50
  [1, 1, 0], // yellow t=0.75
  [1, 0, 0], // red    t=1.00
];

// Looks up the nearest slopemap grid cell for a given world (x, z), using
// the same normalization generate_heightmap uses on the Rust side (grid_w-1
// divisions over GROUND_SIZE). Deliberately position-based, not raw-index-
// based - see Task 3 note on why index correspondence isn't assumed.
function nearestSlopeAt(slopemap: Float32Array, x: number, z: number): number {
  const gridSize = HEIGHTMAP_GRID_SIZE;
  const fx = (x / GROUND_SIZE + 0.5) * (gridSize - 1);
  const fz = (z / GROUND_SIZE + 0.5) * (gridSize - 1);
  const col = Math.min(Math.max(Math.round(fx), 0), gridSize - 1);
  const row = Math.min(Math.max(Math.round(fz), 0), gridSize - 1);
  return slopemap[row * gridSize + col];
}

function slopeToColor(deg: number): [number, number, number] {
  const gradePercent = Math.tan((deg * Math.PI) / 180) * 100;
  const t = Math.min(Math.max(gradePercent / GRADE_MAX_PERCENT, 0), 1);

  const segments = GRADIENT_B_STOPS.length - 1;
  const scaled = t * segments;
  const i = Math.min(Math.floor(scaled), segments - 1);
  const localT = scaled - i;

  const [r0, g0, b0] = GRADIENT_B_STOPS[i];
  const [r1, g1, b1] = GRADIENT_B_STOPS[i + 1];

  return [
    r0 + (r1 - r0) * localT,
    g0 + (g1 - g0) * localT,
    b0 + (b1 - b0) * localT,
  ];
}

export function applySlopeDebugColors(
  mesh: THREE.Mesh,
  slopemap: Float32Array
): void {
  const geometry = mesh.geometry as THREE.PlaneGeometry;
  const posAttr = geometry.attributes.position;
  const colors = new Float32Array(posAttr.count * 3);

  for (let i = 0; i < posAttr.count; i++) {
    const lx = posAttr.getX(i);
    const ly = posAttr.getY(i);
    // Same world-space convention terrain.ts already uses: worldZ = -ly.
    const deg = nearestSlopeAt(slopemap, lx, -ly);
    const [r, g, b] = slopeToColor(deg);
    colors[i * 3] = r;
    colors[i * 3 + 1] = g;
    colors[i * 3 + 2] = b;
  }

  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const material = mesh.material as THREE.MeshStandardMaterial;
  material.vertexColors = true;
  material.needsUpdate = true;
}

export function clearSlopeDebugColors(mesh: THREE.Mesh): void {
  const geometry = mesh.geometry as THREE.PlaneGeometry;
  geometry.deleteAttribute('color');
  const material = mesh.material as THREE.MeshStandardMaterial;
  material.vertexColors = false;
  material.needsUpdate = true;
}
