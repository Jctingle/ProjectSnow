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

export function createDevPanel(sim: Sim, onChange: () => void): void {
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
