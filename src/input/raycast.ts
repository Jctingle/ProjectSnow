import * as THREE from 'three';

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

export function getRaycastPoint(
  event: MouseEvent,
  camera: THREE.Camera,
  renderer: THREE.WebGLRenderer,
  ground: THREE.Mesh,       // pass the actual terrain mesh in
): THREE.Vector3 | null {
  const canvas = renderer.domElement;
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;

  ndc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  ndc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObject(ground, false);
  return hits.length > 0 ? hits[0].point.clone() : null;
}