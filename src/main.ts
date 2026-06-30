// ─── Imports ─────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { spawnUnit, apc } from './entityStore';
import { instancedUnits, syncInstancedMesh } from './render/instancedUnits';
import { initSim, tick } from './sim/tick';
import { sample_height } from 'wasm-sim';

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

const ambient = new THREE.HemisphereLight(0xffffff, 0x888888, 1.5);
scene.add(ambient);

// ─── Ground ──────────────────────────────────────────────────────────────────

const segments = 32;
const groundGeometry = new THREE.PlaneGeometry(20, 20, segments, segments);
const groundMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff });
const ground = new THREE.Mesh(groundGeometry, groundMaterial);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

const posAttr = groundGeometry.attributes.position;
for (let i = 0; i < posAttr.count; i++) {
  // After rotating the plane by -PI/2 around X, world Z maps to -localY.
  const localX = posAttr.getX(i);
  const localY = posAttr.getY(i);
  posAttr.setZ(i, sample_height(localX, -localY, 0, 0, 0.15) * 3);
}
posAttr.needsUpdate = true;
groundGeometry.computeVertexNormals();

// ─── Units ───────────────────────────────────────────────────────────────────

scene.add(instancedUnits);

// Spawn a few test units along the X axis
spawnUnit(-2, 0, 0);
spawnUnit(0, 0, 0);
spawnUnit(2, 0, 0);

const apcGeometry = new THREE.BoxGeometry(0.6, 0.6, 0.6);
const apcMaterial = new THREE.MeshStandardMaterial({ color: 0xff8844 });
const apcMesh = new THREE.Mesh(apcGeometry, apcMaterial);
const apcHalfHeight = 0.3;
scene.add(apcMesh);

// ─── Render Loop ─────────────────────────────────────────────────────────────

const SIM_RATE = 1 / 45; // 15 ticks per second
let lastTime = performance.now();
let accumulator = 0;
let apcAngle = 0;

function animate() {
  requestAnimationFrame(animate);

  const now = performance.now();
  let frameTime = (now - lastTime) / 1000; // seconds
  lastTime = now;

  // avoid spiral-of-death if a frame takes way too long (e.g. tab was backgrounded)
  frameTime = Math.min(frameTime, 0.25);

  apcAngle += 0.01;
  apc.x = Math.cos(apcAngle) * 5;
  apc.z = Math.sin(apcAngle) * 5;

  accumulator += frameTime;

  while (accumulator >= SIM_RATE) {
    tick(SIM_RATE); // pass fixed delta, not variable frame time
    accumulator -= SIM_RATE;
  }

  apcMesh.position.set(apc.x, apc.y + apcHalfHeight, apc.z);
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