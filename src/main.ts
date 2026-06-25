// ─── Imports ─────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { spawnUnit } from './entityStore';
import { instancedUnits, syncInstancedMesh } from './render/instancedUnits';

// ─── Scene ───────────────────────────────────────────────────────────────────

const scene = new THREE.Scene();

// ─── Camera ──────────────────────────────────────────────────────────────────

// viewSize controls zoom level — smaller values zoom in, larger zoom out
const viewSize = 10;
const aspect = window.innerWidth / window.innerHeight;

const camera = new THREE.OrthographicCamera(
  (-viewSize * aspect) / 2, // left
  (viewSize * aspect) / 2,  // right
  viewSize / 2,              // top
  -viewSize / 2,             // bottom
  0.1,                       // near
  1000                       // far
);

// Equal offset on all three axes gives the classic isometric angle
camera.position.set(10, 10, 10);
camera.lookAt(0, 0, 0);

// ─── Renderer ────────────────────────────────────────────────────────────────

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// ─── Lighting ────────────────────────────────────────────────────────────────

const light = new THREE.DirectionalLight(0xffffff, 2);
light.position.set(2, 2, 2);
scene.add(light);

// ─── Ground ──────────────────────────────────────────────────────────────────

const groundGeometry = new THREE.PlaneGeometry(20, 20, 32, 32);
const groundMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff });
const ground = new THREE.Mesh(groundGeometry, groundMaterial);
ground.rotation.x = -Math.PI / 2; // rotate flat onto the XZ plane
scene.add(ground);

// ─── Units ───────────────────────────────────────────────────────────────────

scene.add(instancedUnits);

// Spawn a few test units along the X axis
spawnUnit(-2, 0, 0);
spawnUnit(0, 0, 0);
spawnUnit(2, 0, 0);

// ─── Render Loop ─────────────────────────────────────────────────────────────

function animate() {
  requestAnimationFrame(animate);
  syncInstancedMesh();
  renderer.render(scene, camera);
}

animate();

// ─── Resize Handler ──────────────────────────────────────────────────────────

// Orthographic cameras need their frustum bounds recalculated on resize
window.addEventListener('resize', () => {
  const aspect = window.innerWidth / window.innerHeight;
  camera.left   = (-viewSize * aspect) / 2;
  camera.right  = (viewSize * aspect) / 2;
  camera.top    = viewSize / 2;
  camera.bottom = -viewSize / 2;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});