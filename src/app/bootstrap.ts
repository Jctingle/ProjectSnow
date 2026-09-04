import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { getSim } from '../entityStore';
import { initCameraControls, updateCameraFollow } from '../input/camera';
import { createTiltShiftEffect } from '../render/tiltShiftEffect';
import { GROUND_SIZE } from '../sim/config';
import { initSim } from '../sim/tick';

export type AppBootstrap = {
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  renderer: THREE.WebGLRenderer;
  composer: EffectComposer;
  tiltShift: ReturnType<typeof createTiltShiftEffect>;
  sim: ReturnType<typeof getSim>;
};

export async function bootstrapApp(): Promise<AppBootstrap> {
  const scene = new THREE.Scene();
  const aspect = window.innerWidth / window.innerHeight;
  const viewSize = 10;
  const depthRange = GROUND_SIZE * 4;
  const camera = new THREE.OrthographicCamera(
    (-viewSize * aspect) / 2,
    (viewSize * aspect) / 2,
    viewSize / 2,
    -viewSize / 2,
    -depthRange,
    depthRange,
  );

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const tiltShift = createTiltShiftEffect(composer, window.innerWidth, window.innerHeight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 2);
  dirLight.intensity = 1.5;
  dirLight.position.set(2, 2, 2);
  scene.add(dirLight);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x888888, 0.6));

  await initSim();
  const sim = getSim();

  initCameraControls(camera, renderer.domElement);
  updateCameraFollow(camera, sim.apc_x(), sim.apc_y(), sim.apc_z());
  sim.set_apc_target(sim.apc_x(), sim.apc_z());

  return {
    scene,
    camera,
    renderer,
    composer,
    tiltShift,
    sim,
  };
}