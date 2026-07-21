import * as THREE from 'three';
import {
  BLIZZARD_ALPHA_EXPONENT,
  BLIZZARD_CLEAR_RADIUS,
  BLIZZARD_FEATHER_WIDTH,
  BLIZZARD_HAZE_START_RATIO,
  GROUND_SIZE,
} from '../sim/config';

const BLIZZARD_MASK_HEIGHT_EPSILON = 0.05;
const BLIZZARD_MASK_SIZE = GROUND_SIZE * 4;

export type BlizzardMaskSettings = {
  clearRadius: number;
  featherWidth: number;
  hazeStartRatio: number;
  alphaExponent: number;
};

const DEFAULT_SETTINGS: BlizzardMaskSettings = {
  clearRadius: BLIZZARD_CLEAR_RADIUS,
  featherWidth: BLIZZARD_FEATHER_WIDTH,
  hazeStartRatio: BLIZZARD_HAZE_START_RATIO,
  alphaExponent: BLIZZARD_ALPHA_EXPONENT,
};

type BlizzardMaskUniforms = {
  uCenter: { value: THREE.Vector2 };
  uClearRadius: { value: number };
  uFeatherWidth: { value: number };
  uHazeStartRatio: { value: number };
  uAlphaExponent: { value: number };
  uColor: { value: THREE.Color };
};

const vertexShader = `
  varying vec2 vLocalXZ;

  void main() {
    vLocalXZ = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = `
  uniform vec2 uCenter;
  uniform float uClearRadius;
  uniform float uFeatherWidth;
  uniform float uHazeStartRatio;
  uniform float uAlphaExponent;
  uniform vec3 uColor;

  varying vec2 vLocalXZ;

  void main() {
    float feather = max(uFeatherWidth, 0.0001);
    float hazeStartRatio = clamp(uHazeStartRatio, 0.0, 1.0);
    float hazeStart = uClearRadius * hazeStartRatio;
    float dist = distance(vLocalXZ, uCenter);
    float alphaBase = smoothstep(hazeStart, uClearRadius + feather, dist);
    float alpha = pow(alphaBase, max(uAlphaExponent, 0.0001));
    gl_FragColor = vec4(uColor, alpha);
  }
`;

export type BlizzardMaskController = {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  setSettings(next: Partial<BlizzardMaskSettings>): void;
  update(centerX: number, centerY: number, centerZ: number): void;
};

export function createBlizzardMask(): BlizzardMaskController {
  const geometry = new THREE.PlaneGeometry(BLIZZARD_MASK_SIZE, BLIZZARD_MASK_SIZE, 1, 1);
  const settings: BlizzardMaskSettings = { ...DEFAULT_SETTINGS };
  const uniforms: BlizzardMaskUniforms = {
    uCenter: { value: new THREE.Vector2(0, 0) },
    uClearRadius: { value: settings.clearRadius },
    uFeatherWidth: { value: settings.featherWidth },
    uHazeStartRatio: { value: settings.hazeStartRatio },
    uAlphaExponent: { value: settings.alphaExponent },
    uColor: { value: new THREE.Color(0xffffff) },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = 10;
  mesh.frustumCulled = false;

  return {
    mesh,
    setSettings(next: Partial<BlizzardMaskSettings>): void {
      Object.assign(settings, next);
      uniforms.uClearRadius.value = settings.clearRadius;
      uniforms.uFeatherWidth.value = settings.featherWidth;
      uniforms.uHazeStartRatio.value = settings.hazeStartRatio;
      uniforms.uAlphaExponent.value = settings.alphaExponent;
    },
    update(centerX: number, centerY: number, centerZ: number): void {
      mesh.position.x = centerX;
      mesh.position.y = centerY + BLIZZARD_MASK_HEIGHT_EPSILON;
      mesh.position.z = centerZ;
      uniforms.uCenter.value.set(0, 0);
    },
  };
}