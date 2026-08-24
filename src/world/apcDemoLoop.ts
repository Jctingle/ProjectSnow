import { Dir, MachineKind } from 'wasm-sim';
import { getApcInterior } from '../entityStore';

// Temporary Stage 1 scaffolding: fills the hull with machines wired into a
// closed loop so one product visits every cell. Delete once real placement
// exists.

type Cell = { x: number; z: number };

/**
 * Comb-shaped Hamiltonian cycle over a w x d grid: one row along z = 0, teeth
 * snaking back through the remaining rows, then a return spine down x = 0.
 * Requires d to be even so the final tooth ends adjacent to the spine.
 */
function combRing(w: number, d: number): Cell[] {
  const ring: Cell[] = [];
  for (let x = 0; x < w; x += 1) ring.push({ x, z: 0 });
  for (let z = 1; z < d; z += 1) {
    if (z % 2 === 1) {
      for (let x = w - 1; x >= 1; x -= 1) ring.push({ x, z });
    } else {
      for (let x = 1; x < w; x += 1) ring.push({ x, z });
    }
  }
  for (let z = d - 1; z >= 1; z -= 1) ring.push({ x: 0, z });
  return ring;
}

function levelRing(w: number, d: number): Cell[] {
  if (w < 2 || d < 2) return [];
  if (d % 2 === 0) return combRing(w, d);
  if (w % 2 === 0) return combRing(d, w).map((cell) => ({ x: cell.z, z: cell.x }));
  // Odd cell count admits no cycle covering every cell, so one row stays bare.
  return d >= 3 ? combRing(w, d - 1) : [];
}

function directionTo(from: Cell, to: Cell): Dir | null {
  if (to.x === from.x + 1) return Dir.PosX;
  if (to.x === from.x - 1) return Dir.NegX;
  if (to.z === from.z + 1) return Dir.PosZ;
  if (to.z === from.z - 1) return Dir.NegZ;
  return null;
}

export function seedApcDemoLoop(): void {
  const interior = getApcInterior();
  // Rebuilt wholesale: the ring's shape changes with the hull, so surviving
  // machines would keep output faces belonging to the previous layout.
  interior.clear_machines();

  const ring = levelRing(interior.hull_w(), interior.hull_d());
  if (ring.length < 2) return;

  for (let y = 0; y < interior.hull_h(); y += 1) {
    for (let i = 0; i < ring.length; i += 1) {
      const from = ring[i];
      const direction = directionTo(from, ring[(i + 1) % ring.length]);
      const cell = interior.cell_index(from.x, y, from.z);
      if (direction === null) interior.add_machine_without_output(cell, MachineKind.Plain);
      else interior.add_machine(cell, MachineKind.Plain, direction);
    }
    interior.place_product_at_cell(interior.cell_index(ring[0].x, y, ring[0].z));
  }
}
