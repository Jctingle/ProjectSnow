import * as THREE from 'three';
import { getSim } from '../entityStore';
import { DEBUG_INPUT_LOGGING, MAX_RAW_TERRAIN_HEIGHT } from '../sim/config';

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

function logRaycast(stage: string, payloadFactory: () => Record<string, unknown>): void {
  if (!DEBUG_INPUT_LOGGING) return;
  console.debug('[diag:right-click:raycast]', stage, payloadFactory());
}

export function getGroundClickPoint(
  event: MouseEvent,
  camera: THREE.Camera,
  renderer: THREE.WebGLRenderer,
): THREE.Vector3 | null {
  const canvas = renderer.domElement;
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    logRaycast('reject:zero-canvas-rect', () => ({
      clickScreen: { x: event.clientX, y: event.clientY },
      rect: { width: rect.width, height: rect.height },
      worldPoint: null,
    }));
    return null;
  }

  ndc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  ndc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(ndc, camera);

  const origin = raycaster.ray.origin;
  const dir = raycaster.ray.direction;
  if (Math.abs(dir.y) < 1e-8) {
    logRaycast('reject:parallel-ray', () => ({
      clickScreen: { x: event.clientX, y: event.clientY },
      ndc: { x: ndc.x, y: ndc.y },
      rayOrigin: { x: origin.x, y: origin.y, z: origin.z },
      rayDir: { x: dir.x, y: dir.y, z: dir.z },
      worldPoint: null,
    }));
    return null;
  }

  const sim = getSim();

  const heightAt = (t: number) => {
    const x = origin.x + dir.x * t;
    const z = origin.z + dir.z * t;
    return sim.sample_height(x, z) * sim.height_mult();
  };

  const f = (t: number) => (origin.y + dir.y * t) - heightAt(t);

  const HIGH = MAX_RAW_TERRAIN_HEIGHT * sim.height_mult();
  const LOW = -HIGH;
  let t0 = (HIGH - origin.y) / dir.y;
  let t1 = (LOW - origin.y) / dir.y;
  if (t0 > t1) [t0, t1] = [t1, t0];

  const STEPS = 40;
  const dt = (t1 - t0) / STEPS;
  let prevT = t0;
  let prevF = f(t0);
  let a: number | null = null;
  let b: number | null = null;

  for (let i = 1; i <= STEPS; i++) {
    const t = t0 + dt * i;
    const value = f(t);
    if ((prevF < 0 && value > 0) || (prevF > 0 && value < 0)) {
      a = prevT;
      b = t;
      break;
    }
    prevT = t;
    prevF = value;
  }

  if (a === null || b === null) {
    logRaycast('reject:no-sign-change-in-height-bracket', () => ({
      clickScreen: { x: event.clientX, y: event.clientY },
      ndc: { x: ndc.x, y: ndc.y },
      rayOrigin: { x: origin.x, y: origin.y, z: origin.z },
      rayDir: { x: dir.x, y: dir.y, z: dir.z },
      tRange: { t0, t1 },
      worldPoint: null,
    }));
    return null;
  }

  let left = a;
  let right = b;
  let fa = f(left);
  for (let i = 0; i < 20; i++) {
    const mid: number = (left + right) / 2;
    const fm = f(mid);
    if (Math.sign(fm) === Math.sign(fa)) {
      left = mid;
      fa = fm;
    } else {
      right = mid;
    }
  }

  const tFinal: number = (left + right) / 2;
  const x = origin.x + dir.x * tFinal;
  const z = origin.z + dir.z * tFinal;
  const point = new THREE.Vector3(x, heightAt(tFinal), z);
  logRaycast('accept:intersection', () => ({
    clickScreen: { x: event.clientX, y: event.clientY },
    ndc: { x: ndc.x, y: ndc.y },
    rayOrigin: { x: origin.x, y: origin.y, z: origin.z },
    rayDir: { x: dir.x, y: dir.y, z: dir.z },
    tFinal,
    worldPoint: { x: point.x, y: point.y, z: point.z },
  }));
  return point;
}