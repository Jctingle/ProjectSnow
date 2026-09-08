import type { Sim } from 'wasm-sim';
import {
  getWorldNodeCategories,
  getWorldNodeCount,
  getWorldNodeFlags,
  getWorldNodeSubtypes,
  getWorldNodeX,
  getWorldNodeZ,
} from '../../entityStore';

const STRUCTURE_CATEGORY = 1;
const SETTLEMENT_PERCHED_SUBTYPE = 3;
const SETTLEMENT_EMBEDDED_SUBTYPE = 4;

export type GenerationUiController = {
  setSettlementProfilesVisible(visible: boolean): void;
  update(): void;
};

type GenerationUiOptions = {
  sim: Sim;
};

function unitFloatFromFlags(flags: number, shift: number): number {
  return ((flags >>> shift) & 0xff) / 255;
}

function settlementSubtypeLabel(subtype: number): string {
  if (subtype === SETTLEMENT_PERCHED_SUBTYPE) return 'PERCHED';
  if (subtype === SETTLEMENT_EMBEDDED_SUBTYPE) return 'EMBEDDED';
  return 'BALANCED';
}

export function createGenerationUiController(options: GenerationUiOptions): GenerationUiController {
  const { sim } = options;

  const panel = document.createElement('div');
  panel.style.cssText =
    'position:fixed; left:12px; bottom:12px; z-index:14; min-width:320px; max-width:420px; padding:10px 12px; border:1px solid rgba(255,255,255,0.2); border-radius:14px; background:rgba(10,18,28,0.62); color:#f4f7ff; font-family:monospace; font-size:12px; line-height:1.45; backdrop-filter:blur(4px); pointer-events:none; display:none;';
  document.body.appendChild(panel);

  let visible = false;
  let lastSignature = '';

  const render = (): void => {
    if (!visible) {
      panel.style.display = 'none';
      return;
    }

    const count = getWorldNodeCount();
    const categories = getWorldNodeCategories();
    const subtypes = getWorldNodeSubtypes();
    const flags = getWorldNodeFlags();
    const x = getWorldNodeX();
    const z = getWorldNodeZ();
    const lines: string[] = [];

    for (let index = 0; index < count; index += 1) {
      if ((categories[index] ?? 0) !== STRUCTURE_CATEGORY) continue;
      const subtype = subtypes[index] ?? 0;
      const packedFlags = flags[index] ?? 0;
      const floatWell = unitFloatFromFlags(packedFlags, 0);
      const relief = unitFloatFromFlags(packedFlags, 8);
      const attachment = unitFloatFromFlags(packedFlags, 16);
      lines.push(
        `${settlementSubtypeLabel(subtype)}  x ${x[index].toFixed(1)}  z ${z[index].toFixed(1)}  fw ${floatWell.toFixed(2)}  at ${attachment.toFixed(2)}  rf ${relief.toFixed(2)}`,
      );
    }

    const header = `GENERATION / shard ${sim.current_shard_row()},${sim.current_shard_col()}`;
    const body = lines.length > 0 ? lines.join('\n') : 'No settlements in current shard.';
    const nextSignature = `${header}\n${body}`;
    if (nextSignature === lastSignature) {
      panel.style.display = 'block';
      return;
    }

    lastSignature = nextSignature;
    panel.textContent = nextSignature;
    panel.style.display = 'block';
  };

  return {
    setSettlementProfilesVisible(nextVisible: boolean): void {
      visible = nextVisible;
      if (!visible) {
        panel.style.display = 'none';
        return;
      }
      render();
    },
    update(): void {
      render();
    },
  };
}