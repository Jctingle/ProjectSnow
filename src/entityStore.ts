export const MAX_UNITS = 256;

export const positions  = new Float32Array(MAX_UNITS * 3);
export const hp         = new Uint16Array(MAX_UNITS);
export const states     = new Uint8Array(MAX_UNITS);
export const programId  = new Uint16Array(MAX_UNITS);
export const targetX    = new Float32Array(MAX_UNITS);
export const targetZ    = new Float32Array(MAX_UNITS);

export const SEEK_APC    = 0;
export const SEEK_RANDOM = 1;

export let activeCount = 0;

export const apc = { x: 0, y: 0, z: 0 };

export function spawnUnit(x: number, y: number, z: number): number {
  const id = activeCount;
  positions[id * 3]     = x;
  positions[id * 3 + 1] = y;
  positions[id * 3 + 2] = z;
  hp[id]       = 100;
  states[id]   = SEEK_APC;
  targetX[id]  = 0;
  targetZ[id]  = 0;
  activeCount++;
  return id;
}