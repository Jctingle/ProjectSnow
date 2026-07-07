import * as THREE from 'three';
import { getSim } from '../entityStore';

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

export function getGroundClickPoint(
  event: MouseEvent,
  camera: THREE.Camera,
  renderer: THREE.WebGLRenderer,
): THREE.Vector3 | null {
  const canvas = renderer.domElement;
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;

  ndc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  ndc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(ndc, camera);

  const origin = raycaster.ray.origin;
  const dir = raycaster.ray.direction;
  if (Math.abs(dir.y) < 1e-8) return null;

  const sim = getSim();

  const heightAt = (t: number) => {
    const x = origin.x + dir.x * t;
    const z = origin.z + dir.z * t;
    return sim.sample_height(x, z) * sim.height_mult();
  };

  const f = (t: number) => (origin.y + dir.y * t) - heightAt(t);

  const HIGH = 40;
  const LOW = -40;
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

  if (a === null || b === null) return null;

  let fa = f(a);
  for (let i = 0; i < 20; i++) {
    const mid = (a + b) / 2;
    const fm = f(mid);
    if (Math.sign(fm) === Math.sign(fa)) {
      a = mid;
      fa = fm;
    } else {
      b = mid;
    }
  }

  const tFinal = (a + b) / 2;
  const x = origin.x + dir.x * tFinal;
  const z = origin.z + dir.z * tFinal;
  return new THREE.Vector3(x, heightAt(tFinal), z);
}