const MAX_UNITS = 256;

export const positions = new Float32Array(MAX_UNITS * 3); // x, y, z per unit
export const hp = new Uint16Array(MAX_UNITS);
export const state = new Uint8Array(MAX_UNITS); // flags: alive, moving, etc.
export const programId = new Uint16Array(MAX_UNITS);

export const apc = {
  x: 0,
  z: 0,
  y: 0, // terrain-following height
};

export let activeCount = 0;

export function spawnUnit(x: number, y: number, z: number): number {
  const id = activeCount;
  positions[id * 3] = x;
  positions[id * 3 + 1] = y;
  positions[id * 3 + 2] = z;
  hp[id] = 100;
  state[id] = 1; // alive
  programId[id] = 0;
  activeCount++;
  return id;
}