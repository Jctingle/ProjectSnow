import type { Sim } from 'wasm-sim';
import {
  APC_SPEED_DEFAULT,
  BLIZZARD_ALPHA_EXPONENT,
  BLIZZARD_CLEAR_RADIUS,
  BLIZZARD_FEATHER_WIDTH,
  BLIZZARD_HAZE_START_RATIO,
  HEIGHT_MULT,
  CRAG_STRENGTH,
  CRAG_FREQ,
  SWEEP_SCALE,
  SWEEP_AMP,
  SLOPE_CLIFF_THRESHOLD_DEG,
  SLOPE_PASSABLE_MAX_DEG,
  setDebugInputLogging,
  setSlopeThresholds,
  TILT_SHIFT_BLUR_STRENGTH,
  TILT_SHIFT_ENABLED,
  TILT_SHIFT_FOCUS_CENTER,
  TILT_SHIFT_FOCUS_WIDTH,
  TIER_HEIGHT_SCALE,
} from '../sim/config';
import type { BlizzardMaskSettings } from '../render/blizzardMask';
import type { TiltShiftSettings } from '../render/tiltShiftPass';

interface FieldConfig {
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
  set: (sim: Sim, value: number) => void;
}

interface LocalFieldConfig {
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
  set: (value: number) => void;
}

interface TiltShiftFieldConfig {
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
}

const FIELDS: FieldConfig[] = [
  { label: 'HEIGHT_MULT', min: 0.5, max: 3.0, step: 0.01, default: HEIGHT_MULT, set: (sim, v) => sim.set_height_mult(v) },
  { label: 'CRAG_STRENGTH', min: 0.0, max: 1.0, step: 0.01, default: CRAG_STRENGTH, set: (sim, v) => sim.set_crag_strength(v) },
  { label: 'CRAG_FREQ', min: 1.0, max: 6.0, step: 0.05, default: CRAG_FREQ, set: (sim, v) => sim.set_crag_freq(v) },
  { label: 'SWEEP_SCALE', min: 0.005, max: 0.05, step: 0.0005, default: SWEEP_SCALE, set: (sim, v) => sim.set_sweep_scale(v) },
  { label: 'SWEEP_AMP', min: 0.0, max: 3.0, step: 0.01, default: SWEEP_AMP, set: (sim, v) => sim.set_sweep_amp(v) },
  { label: 'TIER_HEIGHT_SCALE', min: 0.1, max: 1.5, step: 0.01, default: TIER_HEIGHT_SCALE, set: (sim, v) => sim.set_tier_height_scale(v) },
];

const BLIZZARD_DEFAULTS: BlizzardMaskSettings = {
  clearRadius: BLIZZARD_CLEAR_RADIUS,
  featherWidth: BLIZZARD_FEATHER_WIDTH,
  hazeStartRatio: BLIZZARD_HAZE_START_RATIO,
  alphaExponent: BLIZZARD_ALPHA_EXPONENT,
};

const TILT_SHIFT_DEFAULTS: TiltShiftSettings = {
  focusCenter: TILT_SHIFT_FOCUS_CENTER,
  focusWidth: TILT_SHIFT_FOCUS_WIDTH,
  blurStrength: TILT_SHIFT_BLUR_STRENGTH,
};

let recallCheckboxRef: HTMLInputElement | null = null;
let onRecallToggleRef: ((recallActive: boolean) => void) | null = null;
let deployedCountSpanRef: HTMLSpanElement | null = null;
let recallActiveState = false;

function setRecallActive(recallActive: boolean): void {
  recallActiveState = recallActive;
  if (recallCheckboxRef) {
    recallCheckboxRef.checked = recallActive;
  }
  onRecallToggleRef?.(recallActive);
}

export function toggleRecallUnits(): void {
  setRecallActive(!recallActiveState);
}

export function updateDeployedCount(n: number): void {
  if (!deployedCountSpanRef) return;
  deployedCountSpanRef.textContent = String(n);
}

export function createDevPanel(
  sim: Sim,
  onChange: () => void,
  onSlopeDebugToggle?: (checked: boolean) => void,
  onRecallToggle?: (recallActive: boolean) => void,
  onCameraFollowToggle?: (followActive: boolean) => void,
  onBlizzardSettingsChange?: (settings: BlizzardMaskSettings) => void,
  onTiltShiftToggle?: (enabled: boolean) => void,
  onTiltShiftSettingsChange?: (settings: Partial<TiltShiftSettings>) => void,
  onDebugConsoleToggle?: (enabled: boolean) => void,
): void {
  onRecallToggleRef = onRecallToggle ?? null;
  const blizzardSettings: BlizzardMaskSettings = { ...BLIZZARD_DEFAULTS };
  const slopeSettings = {
    passableMaxDeg: SLOPE_PASSABLE_MAX_DEG,
    cliffThresholdDeg: SLOPE_CLIFF_THRESHOLD_DEG,
  };

  const panel = document.createElement('div');
  panel.style.cssText =
    'position:fixed; top:124px; right:12px; z-index:10; display:flex; flex-direction:column; gap:6px; font-family:monospace; font-size:12px;';

  const masterRow = document.createElement('div');
  masterRow.style.cssText =
    'position:fixed; top:90px; right:12px; z-index:10; display:flex; align-items:center; gap:8px; background:rgba(120,30,30,0.8); padding:6px 8px; border-radius:4px; color:#fff; font-family:monospace; font-size:12px;';
  const masterCheckbox = document.createElement('input');
  masterCheckbox.type = 'checkbox';
  const masterLabel = document.createElement('label');
  masterLabel.textContent = 'Hide debug UI';
  masterRow.appendChild(masterCheckbox);
  masterRow.appendChild(masterLabel);
  masterCheckbox.addEventListener('change', () => {
    panel.style.display = masterCheckbox.checked ? 'none' : 'flex';
  });
  document.body.appendChild(masterRow);

  let rebuildScheduled = false;
  function scheduleRebuild(): void {
    if (rebuildScheduled) return;
    rebuildScheduled = true;
    requestAnimationFrame(() => {
      rebuildScheduled = false;
      onChange();
    });
  }

  const slopeRow = document.createElement('div');
  slopeRow.style.cssText =
    'display:flex; align-items:center; gap:8px; background:rgba(0,0,0,0.5); padding:6px 8px; border-radius:4px; color:#fff;';
  const slopeCheckbox = document.createElement('input');
  slopeCheckbox.type = 'checkbox';
  const slopeLabel = document.createElement('label');
  slopeLabel.textContent = 'Show slope debug';
  slopeRow.appendChild(slopeCheckbox);
  slopeRow.appendChild(slopeLabel);

  const recallCheckbox = document.createElement('input');
  recallCheckbox.type = 'checkbox';
  recallCheckbox.checked = recallActiveState;
  const recallLabel = document.createElement('label');
  recallLabel.textContent = 'Recall units';
  slopeRow.appendChild(recallCheckbox);
  slopeRow.appendChild(recallLabel);

  const cameraFollowCheckbox = document.createElement('input');
  cameraFollowCheckbox.type = 'checkbox';
  cameraFollowCheckbox.checked = true;
  const cameraFollowLabel = document.createElement('label');
  cameraFollowLabel.textContent = 'Camera follows APC';
  slopeRow.appendChild(cameraFollowCheckbox);
  slopeRow.appendChild(cameraFollowLabel);

  panel.appendChild(slopeRow);

  recallCheckboxRef = recallCheckbox;

  const tiltShiftEnabledRow = document.createElement('div');
  tiltShiftEnabledRow.style.cssText =
    'display:flex; align-items:center; gap:8px; background:rgba(0,0,0,0.5); padding:6px 8px; border-radius:4px; color:#fff;';
  const tiltShiftEnabledCheckbox = document.createElement('input');
  tiltShiftEnabledCheckbox.type = 'checkbox';
  tiltShiftEnabledCheckbox.checked = TILT_SHIFT_ENABLED;
  const tiltShiftEnabledLabel = document.createElement('label');
  tiltShiftEnabledLabel.textContent = 'Tilt-shift enabled';
  tiltShiftEnabledRow.appendChild(tiltShiftEnabledCheckbox);
  tiltShiftEnabledRow.appendChild(tiltShiftEnabledLabel);
  panel.appendChild(tiltShiftEnabledRow);

  const debugConsoleRow = document.createElement('div');
  debugConsoleRow.style.cssText =
    'display:flex; align-items:center; gap:8px; background:rgba(0,0,0,0.5); padding:6px 8px; border-radius:4px; color:#fff;';
  const debugConsoleCheckbox = document.createElement('input');
  debugConsoleCheckbox.type = 'checkbox';
  const debugConsoleLabel = document.createElement('label');
  debugConsoleLabel.textContent = 'Debug console output';
  debugConsoleRow.appendChild(debugConsoleCheckbox);
  debugConsoleRow.appendChild(debugConsoleLabel);
  panel.appendChild(debugConsoleRow);

  const tabRow = document.createElement('div');
  tabRow.style.cssText = 'display:flex; gap:4px;';
  const tabContent = document.createElement('div');
  tabContent.style.cssText = 'display:flex; flex-direction:column; gap:6px;';

  const tabPanels = new Map<string, HTMLDivElement>();
  let activeTab = 'terrain';
  const showTab = (name: string): void => {
    activeTab = name;
    for (const [tabName, content] of tabPanels) {
      content.style.display = tabName === activeTab ? 'flex' : 'none';
    }
    for (const button of tabRow.querySelectorAll('button')) {
      const selected = button.dataset.tab === activeTab;
      button.setAttribute('aria-selected', String(selected));
      button.style.background = selected ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.5)';
    }
  };
  const createTab = (name: string, label: string): HTMLDivElement => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.tab = name;
    button.textContent = label;
    button.setAttribute('aria-selected', 'false');
    button.style.cssText =
      'border:0; border-radius:4px; padding:6px 8px; color:#fff; cursor:pointer; font:inherit;';
    button.addEventListener('click', () => showTab(name));
    tabRow.appendChild(button);
    const content = document.createElement('div');
    content.style.cssText = 'display:none; flex-direction:column; gap:6px;';
    tabPanels.set(name, content);
    tabContent.appendChild(content);
    return content;
  };
  const terrainPanel = createTab('terrain', 'Terrain');
  const blizzardPanel = createTab('blizzard', 'Blizzard');
  const slopeThresholdPanel = createTab('slope', 'Slope');
  const tiltShiftPanel = createTab('tilt-shift', 'Tilt-shift');
  const testingPanel = createTab('testing', 'TESTING');
  panel.appendChild(tabRow);
  panel.appendChild(tabContent);
  showTab(activeTab);

  const deployedRow = document.createElement('div');
  deployedRow.style.cssText =
    'display:flex; align-items:center; justify-content:space-between; gap:8px; background:rgba(0,0,0,0.5); padding:6px 8px; border-radius:4px; color:#fff;';
  const deployedLabel = document.createElement('span');
  deployedLabel.textContent = 'Deployed units';
  const deployedValue = document.createElement('span');
  deployedValue.textContent = '0';
  deployedRow.appendChild(deployedLabel);
  deployedRow.appendChild(deployedValue);
  panel.appendChild(deployedRow);
  deployedCountSpanRef = deployedValue;

  slopeCheckbox.addEventListener('change', () => {
    onSlopeDebugToggle?.(slopeCheckbox.checked);
  });

  recallCheckbox.addEventListener('change', () => {
    setRecallActive(recallCheckbox.checked);
  });

  cameraFollowCheckbox.addEventListener('change', () => {
    onCameraFollowToggle?.(cameraFollowCheckbox.checked);
  });

  tiltShiftEnabledCheckbox.addEventListener('change', () => {
    onTiltShiftToggle?.(tiltShiftEnabledCheckbox.checked);
  });

  debugConsoleCheckbox.addEventListener('change', () => {
    setDebugInputLogging(debugConsoleCheckbox.checked);
    onDebugConsoleToggle?.(debugConsoleCheckbox.checked);
  });

  function createSliderRow(
    field: {
      label: string;
      min: number;
      max: number;
      step: number;
      default: number;
      onInput: (value: number) => void;
    },
    parent: HTMLElement,
  ): { slider: HTMLInputElement; valueSpan: HTMLSpanElement } {
    const row = document.createElement('div');
    row.style.cssText =
      'display:flex; flex-direction:column; gap:2px; background:rgba(0,0,0,0.5); padding:6px 8px; border-radius:4px; color:#fff;';

    const labelRow = document.createElement('div');
    labelRow.style.cssText = 'display:flex; justify-content:space-between; gap:8px;';
    const nameSpan = document.createElement('span');
    nameSpan.textContent = field.label;
    const valueSpan = document.createElement('span');
    valueSpan.textContent = field.default.toFixed(4);
    labelRow.appendChild(nameSpan);
    labelRow.appendChild(valueSpan);

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = String(field.min);
    slider.max = String(field.max);
    slider.step = String(field.step);
    slider.value = String(field.default);
    slider.style.cssText = 'width:220px;';

    slider.addEventListener('input', () => {
      const value = parseFloat(slider.value);
      field.onInput(value);
      valueSpan.textContent = parseFloat(slider.value).toFixed(4);
    });

    row.appendChild(labelRow);
    row.appendChild(slider);
    parent.appendChild(row);

    return { slider, valueSpan };
  }

  for (const field of FIELDS) {
    createSliderRow(
      {
        ...field,
        onInput: (value: number) => {
          field.set(sim, value);
          scheduleRebuild();
        },
      },
      terrainPanel,
    );
  }

  createSliderRow(
    {
      label: 'APC_SPEED',
      min: 0.01,
      max: 1.0,
      step: 0.01,
      default: APC_SPEED_DEFAULT,
      onInput: (value: number) => {
        sim.set_apc_speed(value);
      },
    },
    testingPanel,
  );

  const blizzardFields: LocalFieldConfig[] = [
    {
      label: 'BLIZZARD_CLEAR_RADIUS',
      min: 5,
      max: 100,
      step: 1,
      default: BLIZZARD_DEFAULTS.clearRadius,
      set: (value) => {
        blizzardSettings.clearRadius = value;
      },
    },
    {
      label: 'BLIZZARD_FEATHER_WIDTH',
      min: 5,
      max: 80,
      step: 1,
      default: BLIZZARD_DEFAULTS.featherWidth,
      set: (value) => {
        blizzardSettings.featherWidth = value;
      },
    },
    {
      label: 'BLIZZARD_HAZE_START_RATIO',
      min: 0,
      max: 1,
      step: 0.01,
      default: BLIZZARD_DEFAULTS.hazeStartRatio,
      set: (value) => {
        blizzardSettings.hazeStartRatio = value;
      },
    },
    {
      label: 'BLIZZARD_ALPHA_EXPONENT',
      min: 0.5,
      max: 4,
      step: 0.05,
      default: BLIZZARD_DEFAULTS.alphaExponent,
      set: (value) => {
        blizzardSettings.alphaExponent = value;
      },
    },
  ];

  for (const field of blizzardFields) {
    createSliderRow(
      {
        ...field,
        onInput: (value: number) => {
          field.set(value);
          onBlizzardSettingsChange?.(blizzardSettings);
        },
      },
      blizzardPanel,
    );
  }

  let passableSlider: HTMLInputElement | null = null;
  let cliffSlider: HTMLInputElement | null = null;

  const passableRow = createSliderRow(
    {
      label: 'SLOPE_PASSABLE_MAX_DEG',
      min: 0,
      max: 90,
      step: 1,
      default: slopeSettings.passableMaxDeg,
      onInput: (value: number) => {
        if (value >= slopeSettings.cliffThresholdDeg) {
          if (passableSlider) passableSlider.value = String(slopeSettings.passableMaxDeg);
          return;
        }
        slopeSettings.passableMaxDeg = value;
        setSlopeThresholds(slopeSettings.passableMaxDeg, slopeSettings.cliffThresholdDeg);
      },
    },
    slopeThresholdPanel,
  );
  passableSlider = passableRow.slider;

  const cliffRow = createSliderRow(
    {
      label: 'SLOPE_CLIFF_THRESHOLD_DEG',
      min: 0,
      max: 90,
      step: 1,
      default: slopeSettings.cliffThresholdDeg,
      onInput: (value: number) => {
        if (value <= slopeSettings.passableMaxDeg) {
          if (cliffSlider) cliffSlider.value = String(slopeSettings.cliffThresholdDeg);
          return;
        }
        slopeSettings.cliffThresholdDeg = value;
        setSlopeThresholds(slopeSettings.passableMaxDeg, slopeSettings.cliffThresholdDeg);
      },
    },
    slopeThresholdPanel,
  );
  cliffSlider = cliffRow.slider;

  const tiltShiftFields: TiltShiftFieldConfig[] = [
    {
      label: 'TILT_SHIFT_FOCUS_CENTER',
      min: 0,
      max: 1,
      step: 0.01,
      default: TILT_SHIFT_DEFAULTS.focusCenter,
    },
    {
      label: 'TILT_SHIFT_FOCUS_WIDTH',
      min: 0.05,
      max: 0.8,
      step: 0.01,
      default: TILT_SHIFT_DEFAULTS.focusWidth,
    },
    {
      label: 'TILT_SHIFT_BLUR_STRENGTH',
      min: 0,
      max: 20,
      step: 0.25,
      default: TILT_SHIFT_DEFAULTS.blurStrength,
    },
  ];

  const tiltShiftPatchFactories: Array<(value: number) => Partial<TiltShiftSettings>> = [
    (value) => ({ focusCenter: value }),
    (value) => ({ focusWidth: value }),
    (value) => ({ blurStrength: value }),
  ];

  for (const [index, field] of tiltShiftFields.entries()) {
    createSliderRow(
      {
        ...field,
        onInput: (value: number) => {
          const toPatch = tiltShiftPatchFactories[index];
          if (!toPatch) return;
          onTiltShiftSettingsChange?.(toPatch(value));
        },
      },
      tiltShiftPanel,
    );
  }

  document.body.appendChild(panel);
}
