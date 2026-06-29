// ─── Imports ─────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { spawnUnit } from './entityStore';
import { instancedUnits, syncInstancedMesh } from './render/instancedUnits';
import { initSim, tick } from './sim/tick';
import { generate_heightmap } from 'wasm-sim';

await initSim();

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

const segments = 32;
const groundGeometry = new THREE.PlaneGeometry(20, 20, segments, segments);
const groundMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff });
const ground = new THREE.Mesh(groundGeometry, groundMaterial);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

const gridSize = segments + 1; // PlaneGeometry has segments+1 vertices per side
const heightmap = new Float32Array(gridSize * gridSize);
generate_heightmap(heightmap, gridSize, gridSize, 0, 0, 0.15);

const posAttr = groundGeometry.attributes.position;
for (let i = 0; i < posAttr.count; i++) {
  posAttr.setZ(i, heightmap[i] * 0.5); // 0.5 = height multiplier, tune to taste
}
posAttr.needsUpdate = true;
groundGeometry.computeVertexNormals();

// ─── Units ───────────────────────────────────────────────────────────────────

scene.add(instancedUnits);

// Spawn a few test units along the X axis
spawnUnit(-2, 0, 0);
spawnUnit(0, 0, 0);
spawnUnit(2, 0, 0);

// ─── Render Loop ─────────────────────────────────────────────────────────────

const SIM_RATE = 1 / 45; // 15 ticks per second
let lastTime = performance.now();
let accumulator = 0;

function animate() {
  requestAnimationFrame(animate);

  const now = performance.now();
  let frameTime = (now - lastTime) / 1000; // seconds
  lastTime = now;

  // avoid spiral-of-death if a frame takes way too long (e.g. tab was backgrounded)
  frameTime = Math.min(frameTime, 0.25);

  accumulator += frameTime;

  while (accumulator >= SIM_RATE) {
    tick(SIM_RATE); // pass fixed delta, not variable frame time
    accumulator -= SIM_RATE;
  }

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