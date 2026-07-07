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

  // Orthographic rays are just parameterized lines through the scene for
  // a top-down click - there's no meaningful "behind the camera" here, so
  // solve the line/plane intersection ourselves instead of using
  // Ray.intersectPlane, which hard-rejects any negative t. That rejection
  // is what caused clicks to silently fail once zoomed out far enough.
  if (Math.abs(dir.y) < 1e-8) return null;

  const sim = getSim();

  // Approximate at y = 0 first...
  let t = -origin.y / dir.y;
  let x = origin.x + dir.x * t;
  let z = origin.z + dir.z * t;

  // ...then refine against the real terrain height a couple of times to
  // remove the parallax offset on sloped ground.
  for (let i = 0; i < 2; i++) {
    const h = sim.sample_height(x, z) * sim.height_mult();
    t = (h - origin.y) / dir.y;
    x = origin.x + dir.x * t;
    z = origin.z + dir.z * t;
  }

  const finalHeight = sim.sample_height(x, z) * sim.height_mult();
  return new THREE.Vector3(x, finalHeight, z);
}