import * as THREE from 'three';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import {
  TILT_SHIFT_BLUR_STRENGTH,
  TILT_SHIFT_FOCUS_CENTER,
  TILT_SHIFT_FOCUS_WIDTH,
} from '../sim/config';

export type TiltShiftSettings = {
  focusCenter: number;
  focusWidth: number;
  blurStrength: number;
};

type TiltShiftUniforms = {
  tDiffuse: { value: THREE.Texture | null };
  uResolution: { value: THREE.Vector2 };
  uFocusCenter: { value: number };
  uFocusWidth: { value: number };
  uBlurStrength: { value: number };
};

const vertexShader = `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = `
  uniform sampler2D tDiffuse;
  uniform vec2 uResolution;
  uniform float uFocusCenter;
  uniform float uFocusWidth;
  uniform float uBlurStrength;

  varying vec2 vUv;

  vec4 sampleBlur(vec2 uv, float radiusPx) {
    vec2 texel = 1.0 / uResolution;
    vec2 r = texel * radiusPx;

    vec4 color = texture2D(tDiffuse, uv) * 0.227027;
    color += texture2D(tDiffuse, uv + vec2( 1.0,  0.0) * r) * 0.120216;
    color += texture2D(tDiffuse, uv + vec2(-1.0,  0.0) * r) * 0.120216;
    color += texture2D(tDiffuse, uv + vec2( 0.0,  1.0) * r) * 0.120216;
    color += texture2D(tDiffuse, uv + vec2( 0.0, -1.0) * r) * 0.120216;
    color += texture2D(tDiffuse, uv + vec2( 0.7071,  0.7071) * r) * 0.048486;
    color += texture2D(tDiffuse, uv + vec2(-0.7071,  0.7071) * r) * 0.048486;
    color += texture2D(tDiffuse, uv + vec2( 0.7071, -0.7071) * r) * 0.048486;
    color += texture2D(tDiffuse, uv + vec2(-0.7071, -0.7071) * r) * 0.048486;
    return color;
  }

  void main() {
    float halfWidth = max(uFocusWidth * 0.5, 0.0001);
    float distFromCenter = abs(vUv.y - uFocusCenter);
    float blurMix = smoothstep(halfWidth, 0.5, distFromCenter);
    float radiusPx = uBlurStrength * blurMix;

    vec4 sharp = texture2D(tDiffuse, vUv);
    vec4 blurred = sampleBlur(vUv, radiusPx);
    gl_FragColor = mix(sharp, blurred, blurMix);
  }
`;

export type TiltShiftController = {
  pass: ShaderPass;
  setSettings(next: Partial<TiltShiftSettings>): void;
  setResolution(width: number, height: number): void;
  getLiveUniforms(): TiltShiftSettings;
};

export function createTiltShiftPass(width: number, height: number): TiltShiftController {
  const settings: TiltShiftSettings = {
    focusCenter: TILT_SHIFT_FOCUS_CENTER,
    focusWidth: TILT_SHIFT_FOCUS_WIDTH,
    blurStrength: TILT_SHIFT_BLUR_STRENGTH,
  };

  const uniforms: TiltShiftUniforms = {
    tDiffuse: { value: null },
    uResolution: { value: new THREE.Vector2(width, height) },
    uFocusCenter: { value: settings.focusCenter },
    uFocusWidth: { value: settings.focusWidth },
    uBlurStrength: { value: settings.blurStrength },
  };

  const pass = new ShaderPass({
    uniforms,
    vertexShader,
    fragmentShader,
  });

  type LiveTiltUniforms = {
    uFocusCenter: { value: number };
    uFocusWidth: { value: number };
    uBlurStrength: { value: number };
    uResolution: { value: THREE.Vector2 };
  };
  const liveUniforms = pass.uniforms as unknown as LiveTiltUniforms;

  return {
    pass,
    setSettings(next: Partial<TiltShiftSettings>): void {
      Object.assign(settings, next);
      liveUniforms.uFocusCenter.value = settings.focusCenter;
      liveUniforms.uFocusWidth.value = settings.focusWidth;
      liveUniforms.uBlurStrength.value = settings.blurStrength;
    },
    setResolution(nextWidth: number, nextHeight: number): void {
      liveUniforms.uResolution.value.set(nextWidth, nextHeight);
    },
    getLiveUniforms(): TiltShiftSettings {
      return {
        focusCenter: liveUniforms.uFocusCenter.value,
        focusWidth: liveUniforms.uFocusWidth.value,
        blurStrength: liveUniforms.uBlurStrength.value,
      };
    },
  };
}