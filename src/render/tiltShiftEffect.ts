import type { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { TILT_SHIFT_ENABLED } from '../sim/config';
import { createTiltShiftPass, type TiltShiftSettings } from './tiltShiftPass';

export type TiltShiftEffectController = {
  setEnabled(enabled: boolean): void;
  isEnabled(): boolean;
  isPassAttached(): boolean;
  setSettings(next: Partial<TiltShiftSettings>): void;
  setResolution(width: number, height: number): void;
  getLiveUniforms(): TiltShiftSettings;
};

let tiltShiftEnabled = TILT_SHIFT_ENABLED;

export function getTiltShiftEnabled(): boolean {
  return tiltShiftEnabled;
}

export function setTiltShiftEnabled(enabled: boolean): void {
  tiltShiftEnabled = enabled;
}

export function createTiltShiftEffect(
  composer: EffectComposer,
  width: number,
  height: number,
): TiltShiftEffectController {
  const tiltShift = createTiltShiftPass(width, height);
  let passAttached = false;

  function attachPass(): void {
    if (passAttached) return;
    composer.addPass(tiltShift.pass);
    passAttached = true;
    tiltShift.pass.enabled = true;
  }

  function detachPass(): void {
    if (!passAttached) return;
    composer.removePass(tiltShift.pass);
    passAttached = false;
    tiltShift.pass.enabled = false;
  }

  function syncEnabledState(): void {
    if (tiltShiftEnabled) {
      attachPass();
    } else {
      detachPass();
    }
  }

  syncEnabledState();

  return {
    setEnabled(enabled: boolean): void {
      setTiltShiftEnabled(enabled);
      syncEnabledState();
    },
    isEnabled(): boolean {
      return tiltShiftEnabled;
    },
    isPassAttached(): boolean {
      return passAttached;
    },
    setSettings(next: Partial<TiltShiftSettings>): void {
      tiltShift.setSettings(next);
    },
    setResolution(nextWidth: number, nextHeight: number): void {
      tiltShift.setResolution(nextWidth, nextHeight);
    },
    getLiveUniforms(): TiltShiftSettings {
      return tiltShift.getLiveUniforms();
    },
  };
}
