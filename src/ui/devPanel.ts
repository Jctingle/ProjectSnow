import type { Sim } from 'wasm-sim';
import {
  HEIGHT_MULT,
  CRAG_STRENGTH,
  CRAG_FREQ,
  SWEEP_SCALE,
  SWEEP_AMP,
  TIER_HEIGHT_SCALE,
} from '../sim/config';

interface FieldConfig {
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
  set: (sim: Sim, value: number) => void;
}

const FIELDS: FieldConfig[] = [
  { label: 'HEIGHT_MULT', min: 0.5, max: 3.0, step: 0.01, default: HEIGHT_MULT, set: (sim, v) => sim.set_height_mult(v) },
  { label: 'CRAG_STRENGTH', min: 0.0, max: 1.0, step: 0.01, default: CRAG_STRENGTH, set: (sim, v) => sim.set_crag_strength(v) },
  { label: 'CRAG_FREQ', min: 1.0, max: 6.0, step: 0.05, default: CRAG_FREQ, set: (sim, v) => sim.set_crag_freq(v) },
  { label: 'SWEEP_SCALE', min: 0.005, max: 0.05, step: 0.0005, default: SWEEP_SCALE, set: (sim, v) => sim.set_sweep_scale(v) },
  { label: 'SWEEP_AMP', min: 0.0, max: 3.0, step: 0.01, default: SWEEP_AMP, set: (sim, v) => sim.set_sweep_amp(v) },
  { label: 'TIER_HEIGHT_SCALE', min: 0.1, max: 1.5, step: 0.01, default: TIER_HEIGHT_SCALE, set: (sim, v) => sim.set_tier_height_scale(v) },
];

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
  onRecallToggle?: (recallActive: boolean) => void
): void {
  onRecallToggleRef = onRecallToggle ?? null;

  const panel = document.createElement('div');
  panel.style.cssText =
    'position:fixed; top:90px; right:12px; z-index:10; display:flex; flex-direction:column; gap:6px; font-family:monospace; font-size:12px;';

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

  panel.appendChild(slopeRow);

  recallCheckboxRef = recallCheckbox;

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

  for (const field of FIELDS) {
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
      field.set(sim, value);
      valueSpan.textContent = value.toFixed(4);
      scheduleRebuild();
    });

    row.appendChild(labelRow);
    row.appendChild(slider);
    panel.appendChild(row);
  }

  document.body.appendChild(panel);
}
