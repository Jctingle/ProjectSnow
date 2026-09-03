import {
  getApcInterior,
  getInteriorUnitIds,
  getInteriorUnitModes,
  getInteriorUnitSpecializations,
  InteriorUnitMode,
  UnitSpecialization,
} from '../entityStore';
import { registerWindowToggle } from './windowToggleBar';

type UnitRosterPanelController = {
  sync(): void;
};

type UnitSnapshot = {
  id: number;
  specialization: number;
  mode: number;
};

const MODE_LABELS: Record<number, string> = {
  [InteriorUnitMode.BoardedIdle]: 'Idle',
  [InteriorUnitMode.AssignedMachine]: 'Assigned',
  [InteriorUnitMode.Exiting]: 'Exiting',
  [InteriorUnitMode.Deployed]: 'Deployed',
  [InteriorUnitMode.Returning]: 'Returning',
  [InteriorUnitMode.Boarding]: 'Boarding',
  [InteriorUnitMode.Incapacitated]: 'Incapacitated',
};

const SPECIALIZATION_LABELS: Record<number, string> = {
  [UnitSpecialization.Generalist]: 'Generalist',
  [UnitSpecialization.Assault]: 'Assault',
  [UnitSpecialization.Medic]: 'Medic',
  [UnitSpecialization.Engineer]: 'Engineer',
  [UnitSpecialization.Pilot]: 'Pilot',
  [UnitSpecialization.Scout]: 'Scout',
};

function specializationLabel(code: number): string {
  return SPECIALIZATION_LABELS[code] ?? 'Unknown';
}

function modeLabel(code: number): string {
  return MODE_LABELS[code] ?? 'Unknown';
}

function sameSnapshots(a: UnitSnapshot[], b: UnitSnapshot[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i];
    const right = b[i];
    if (!left || !right) return false;
    if (left.id !== right.id) return false;
    if (left.specialization !== right.specialization) return false;
    if (left.mode !== right.mode) return false;
  }
  return true;
}

export function createUnitRosterPanel(): UnitRosterPanelController {
  const panel = document.createElement('div');
  panel.style.cssText =
    'position:fixed; left:12px; bottom:12px; z-index:10; width:min(360px, calc(100vw - 24px)); max-height:36vh; overflow:auto; display:flex; flex-direction:column; gap:6px; background:rgba(10,14,24,0.78); border:1px solid rgba(255,255,255,0.2); border-radius:6px; padding:8px; color:#e7edf8; font-family:monospace; font-size:12px; backdrop-filter: blur(2px);';

  const header = document.createElement('div');
  header.style.cssText =
    'display:flex; justify-content:space-between; align-items:center; gap:8px; font-weight:700; letter-spacing:0.03em;';
  const title = document.createElement('span');
  title.textContent = 'Active Units';
  const count = document.createElement('span');
  count.textContent = '0';
  header.appendChild(title);
  header.appendChild(count);

  const list = document.createElement('div');
  list.style.cssText = 'display:grid; grid-template-columns:repeat(auto-fill, minmax(150px, 1fr)); gap:6px;';

  panel.appendChild(header);
  panel.appendChild(list);

  document.body.appendChild(panel);
  registerWindowToggle({
    id: 'units-panel',
    label: 'Units',
    defaultVisible: true,
    onVisibleChange: (visible) => {
      panel.style.display = visible ? 'flex' : 'none';
    },
  });

  let lastSnapshot: UnitSnapshot[] = [];

  const render = (units: UnitSnapshot[]): void => {
    list.replaceChildren();
    count.textContent = String(units.length);
    for (const unit of units) {
      const box = document.createElement('div');
      box.style.cssText =
        'display:flex; flex-direction:column; gap:3px; min-height:56px; border:1px solid rgba(255,255,255,0.18); border-radius:4px; padding:6px; background:rgba(255,255,255,0.05);';

      const name = document.createElement('span');
      name.style.cssText = 'font-weight:700; color:#ffffff;';
      name.textContent = `${specializationLabel(unit.specialization)} ${unit.id}`;

      const mode = document.createElement('span');
      mode.style.cssText = 'opacity:0.9;';
      mode.textContent = `Mode: ${modeLabel(unit.mode)}`;

      const resources = document.createElement('span');
      resources.style.cssText = 'opacity:0.75;';
      resources.textContent = 'Resources: pending';

      box.appendChild(name);
      box.appendChild(mode);
      box.appendChild(resources);
      list.appendChild(box);
    }
  };

  const sync = (): void => {
    const interior = getApcInterior();
    const unitCount = interior.interior_unit_count();
    const ids = getInteriorUnitIds();
    const specializations = getInteriorUnitSpecializations();
    const modes = getInteriorUnitModes();

    const next: UnitSnapshot[] = [];
    for (let i = 0; i < unitCount; i += 1) {
      next.push({
        id: ids[i] ?? 0,
        specialization: specializations[i] ?? 0,
        mode: modes[i] ?? 0,
      });
    }

    if (sameSnapshots(lastSnapshot, next)) return;
    lastSnapshot = next;
    render(next);
  };

  sync();

  return { sync };
}