import * as THREE from 'three';
import './style.css';
import { getSim } from './entityStore';
import { initCameraControls } from './input/camera';
import { initInputRouter } from './input/index';
import { instancedUnits, syncInstancedMesh } from './render/instancedUnits';
import { initSim, tick } from './sim/tick';
import { createApcMesh, syncApcMesh } from './world/apc';
import { createTerrainMesh } from './world/terrain';
import { spawnInitialUnits } from './world/units';

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

await initSim(); // initSim already builds the cached heightmap
const sim = getSim();

initCameraControls(camera, renderer.domElement);

// APC starts parked where it is
sim.set_apc_target(sim.apc_x(), sim.apc_z());

// terrain
const ground = createTerrainMesh(sim);
scene.add(ground);

const updateInputRouter = initInputRouter(camera, renderer, ground, scene);

// APC
const apcMesh = createApcMesh();
scene.add(apcMesh);

// units
scene.add(instancedUnits);
spawnInitialUnits();

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

  syncApcMesh(apcMesh, sim);
  updateInputRouter();

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