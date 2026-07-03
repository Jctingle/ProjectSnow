import { spawnUnit } from '../entityStore';
import { UNIT_COUNT, UNIT_SPACING } from '../sim/config';

export function spawnInitialUnits(): void {
  const cols = Math.ceil(Math.sqrt(UNIT_COUNT));
  const rows = Math.ceil(UNIT_COUNT / cols);

  for (let i = 0; i < UNIT_COUNT; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = (col - (cols - 1) / 2) * UNIT_SPACING;
    const z = (row - (rows - 1) / 2) * UNIT_SPACING;
    spawnUnit(x, z);
  }
}
