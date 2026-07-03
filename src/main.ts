import * as THREE from 'three';
import './style.css';
import { spawnUnit, getSim } from './entityStore';
import { initCameraControls } from './input/camera';
import { initInputRouter } from './input/index';
import { instancedUnits, syncInstancedMesh } from './render/instancedUnits';
import { initSim, tick } from './sim/tick';

const scene    = new THREE.Scene();
const aspect   = window.innerWidth / window.innerHeight;
const viewSize = 10;
const camera   = new THREE.OrthographicCamera(
  (-viewSize * aspect) / 2,
  (viewSize * aspect) / 2,
   viewSize / 2,
  -viewSize / 2,
  0.1,
  1000
);
camera.position.set(10, 10, 10);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// lights
const dirLight = new THREE.DirectionalLight(0xffffff, 2);
dirLight.intensity = 1.5;
dirLight.position.set(2, 2, 2);
scene.add(dirLight);
const ambient = new THREE.HemisphereLight(0xffffff, 0x888888, 0.6);
scene.add(ambient);

await initSim(); // initSim already calls generate_heightmap(64, 64)
const sim = getSim();

initCameraControls(camera, renderer.domElement);
initInputRouter(camera, renderer);

// APC starts parked where it is
sim.set_apc_target(sim.apc_x(), sim.apc_z());

// terrain
const segments = 32;
const groundGeometry = new THREE.PlaneGeometry(20, 20, segments, segments);
const groundMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff });
const ground = new THREE.Mesh(groundGeometry, groundMaterial);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

// One-time terrain build: raw simplex via the Sim (exact, matches what the
// cached heightmap approximates for units). Seed/scale live inside the Sim.
const posAttr = groundGeometry.attributes.position;
for (let i = 0; i < posAttr.count; i++) {
  const lx = posAttr.getX(i);
  const ly = posAttr.getY(i);
  const h  = sim.sample_height(lx, -ly);
  posAttr.setZ(i, h * 2.0);
}
posAttr.needsUpdate = true;
groundGeometry.computeVertexNormals();

// APC
const apcMesh = new THREE.Mesh(
  new THREE.BoxGeometry(0.3, 0.3, 0.3),
  new THREE.MeshStandardMaterial({ color: 0xff8844 })
);
scene.add(apcMesh);

// units
scene.add(instancedUnits);
const UNIT_COUNT = 5;
const UNIT_SPACING = 0.35;
const cols = Math.ceil(Math.sqrt(UNIT_COUNT));
const rows = Math.ceil(UNIT_COUNT / cols);

for (let i = 0; i < UNIT_COUNT; i++) {
  const col = i % cols;
  const row = Math.floor(i / cols);
  const x = (col - (cols - 1) / 2) * UNIT_SPACING;
  const z = (row - (rows - 1) / 2) * UNIT_SPACING;
  spawnUnit(x, z); // Sim snaps Y to terrain itself
}

// sim loop
const SIM_RATE = 1 / 60;
let lastTime   = performance.now();
let accumulator = 0;

function animate() {
  requestAnimationFrame(animate);

  const now = performance.now();
  let frameTime = Math.min((now - lastTime) / 1000, 0.25);
  lastTime = now;
  accumulator += frameTime;

  while (accumulator >= SIM_RATE) {
    tick(SIM_RATE);
    accumulator -= SIM_RATE;
  }

  apcMesh.position.set(sim.apc_x(), sim.apc_y() + 0.15, sim.apc_z());

  syncInstancedMesh();
  renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => {
  const aspect = window.innerWidth / window.innerHeight;
  camera.left   = (-viewSize * aspect) / 2;
  camera.right  = ( viewSize * aspect) / 2;
  camera.top    =   viewSize / 2;
  camera.bottom =  -viewSize / 2;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});