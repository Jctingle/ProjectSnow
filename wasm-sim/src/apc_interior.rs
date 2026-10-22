//! WASM-facing wrapper binding a [`Lattice`] to a [`MachineGrid`] for the APC.
//!
//! The APC-specific knowledge lives here so `lattice` stays generic and can
//! back generated structures later. Methods reachable from JS validate and
//! return status rather than asserting: a panic across the WASM boundary traps
//! and takes the page down with it.

use wasm_bindgen::prelude::*;

mod movement;
mod snapshot;
#[cfg(test)]
mod tests;
mod units;
mod views;

pub use movement::{InteriorMoveAction, InteriorMoveResult};
pub use units::{InteriorLifecycleResult, InteriorUnitMode, UnitSpecialization};

use crate::lattice::{Dims, Dir, Lattice, CELL_INTERIOR, CELL_OUTSIDE};
use crate::machines::{
    footprints_can_join, MachineGrid, MachineKind, FULL_CUBE_FOOTPRINT, NO_OUTPUT, PRODUCT_DEFAULT,
};
use crate::subgrid::{Subgrid, SUBCELLS_PER_CELL};
use units::{InteriorUnitDomain, EMPTY_UNIT_CELL, EMPTY_UNIT_SLOT_ID, EMPTY_UNIT_SUBCELL};

/// Growth is additive from a fixed corner so a cell index never changes
/// meaning. Recentering on expansion would invalidate stored machine cells,
/// saved blobs, and live JS views all at once.
const HULL_ORIGIN: (usize, usize, usize) = (0, 0, 0);

#[wasm_bindgen]
pub struct ApcInterior {
    lattice: Lattice,
    machines: MachineGrid,
    subgrid: Subgrid,
    units: InteriorUnitDomain,
    unit_rng_state: u32,
    wander_decision_tick: u32,
    hull_w: usize,
    hull_h: usize,
    hull_d: usize,
}

#[wasm_bindgen]
impl ApcInterior {
    #[wasm_bindgen(constructor)]
    pub fn new(
        envelope_w: usize,
        envelope_h: usize,
        envelope_d: usize,
        hull_w: usize,
        hull_h: usize,
        hull_d: usize,
        transfer_interval: u32,
    ) -> ApcInterior {
        let envelope = Dims::new(envelope_w, envelope_h, envelope_d);
        let lattice = Lattice::new(envelope);
        let machines = MachineGrid::new(lattice.cell_count(), transfer_interval.max(1));
        let subgrid = Subgrid::new(lattice.cell_count());
        let units = InteriorUnitDomain::new(lattice.cell_count());

        let mut interior = ApcInterior {
            lattice,
            machines,
            subgrid,
            units,
            unit_rng_state: 0x9E37_79B9,
            wander_decision_tick: 0,
            hull_w: 0,
            hull_h: 0,
            hull_d: 0,
        };
        interior.unit_rng_state = interior.default_unit_rng_seed(transfer_interval);
        interior.set_hull_extent(hull_w, hull_h, hull_d);
        interior
    }

    pub fn tick(&mut self) {
        self.machines.tick(&self.lattice);
    }

    pub fn step(&mut self) {
        self.machines.step(&self.lattice);
    }

    // --- envelope and hull -------------------------------------------------

    pub fn envelope_w(&self) -> usize {
        self.lattice.dims().w
    }

    pub fn envelope_h(&self) -> usize {
        self.lattice.dims().h
    }

    pub fn envelope_d(&self) -> usize {
        self.lattice.dims().d
    }

    pub fn hull_w(&self) -> usize {
        self.hull_w
    }

    pub fn hull_h(&self) -> usize {
        self.hull_h
    }

    pub fn hull_d(&self) -> usize {
        self.hull_d
    }

    pub fn hull_origin_x(&self) -> usize {
        HULL_ORIGIN.0
    }

    pub fn hull_origin_y(&self) -> usize {
        HULL_ORIGIN.1
    }

    pub fn hull_origin_z(&self) -> usize {
        HULL_ORIGIN.2
    }

    /// Clamped to the envelope and monotonic: expansion is additive, so a
    /// smaller request on any axis leaves that axis untouched.
    pub fn set_hull_extent(&mut self, w: usize, h: usize, d: usize) {
        let dims = self.lattice.dims();
        let next_w = w.clamp(self.hull_w, dims.w).max(1);
        let next_h = h.clamp(self.hull_h, dims.h).max(1);
        let next_d = d.clamp(self.hull_d, dims.d).max(1);

        if next_w == self.hull_w && next_h == self.hull_h && next_d == self.hull_d {
            return;
        }

        self.hull_w = next_w;
        self.hull_h = next_h;
        self.hull_d = next_d;
        self.lattice
            .fill_box(HULL_ORIGIN, (next_w, next_h, next_d), CELL_INTERIOR);
    }

    /// Testing escape hatch: unlike `set_hull_extent` this may shrink, so it
    /// rebuilds the cell kinds and drops machines left outside the new hull.
    pub fn reset_hull_extent(&mut self, w: usize, h: usize, d: usize) {
        let dims = self.lattice.dims();
        let next_w = w.clamp(1, dims.w);
        let next_h = h.clamp(1, dims.h);
        let next_d = d.clamp(1, dims.d);

        self.hull_w = next_w;
        self.hull_h = next_h;
        self.hull_d = next_d;

        self.lattice.fill_all(CELL_OUTSIDE);
        self.lattice
            .fill_box(HULL_ORIGIN, (next_w, next_h, next_d), CELL_INTERIOR);

        let level = dims.w * dims.d;
        self.machines.retain(|cell| {
            let y = cell / level;
            let remainder = cell % level;
            remainder % dims.w < next_w && y < next_h && remainder / dims.w < next_d
        });
        self.rebuild_subgrid_from_machines();
    }

    // --- indexing ----------------------------------------------------------
    pub fn cell_count(&self) -> usize {
        self.lattice.cell_count()
    }

    /// Returns `usize::MAX` when the coordinate is outside the envelope, so JS
    /// gets a checkable sentinel instead of a trap.
    pub fn cell_index(&self, x: usize, y: usize, z: usize) -> usize {
        let dims = self.lattice.dims();
        if x >= dims.w || y >= dims.h || z >= dims.d {
            return usize::MAX;
        }
        self.lattice.cell_index(x, y, z)
    }

    pub fn is_cell_in_hull(&self, x: usize, y: usize, z: usize) -> bool {
        x < self.hull_w && y < self.hull_h && z < self.hull_d
    }

    // --- machine placement -------------------------------------------------

    /// `false` when the cell is out of range or already occupied.
    pub fn add_machine(&mut self, cell: usize, kind: MachineKind, output_face: Dir) -> bool {
        self.insert_machine(cell, kind, output_face.index() as u8)
    }

    /// Separate entry point so no "none" sentinel has to cross the boundary.
    pub fn add_machine_without_output(&mut self, cell: usize, kind: MachineKind) -> bool {
        self.insert_machine(cell, kind, NO_OUTPUT)
    }

    /// Places a one-subcell machine, then folds it into any same-kind machine
    /// in the same cell it can legally join with. Returns the surviving
    /// machine id, or `-1` when the subcell is unavailable.
    pub fn place_machine_at_subcell(&mut self, cell: usize, local: u8, kind: MachineKind) -> i32 {
        if !self.is_subcell_free(cell, local) {
            return -1;
        }

        let footprint = 1u8 << local;
        let machine_id = self.machines.next_machine_id();
        if !self.subgrid.reserve_machine(cell, footprint, machine_id) {
            return -1;
        }
        let placed = self
            .machines
            .add_machine_with_footprint(cell, footprint, kind as u8, NO_OUTPUT);

        self.join_machines_at(cell, placed) as i32
    }

    /// Lets JS preview a placement without a speculative mutation.
    pub fn is_subcell_free(&self, cell: usize, local: u8) -> bool {
        (local as usize) < SUBCELLS_PER_CELL
            && cell < self.lattice.cell_count()
            && self.lattice.cell_kind(cell) == CELL_INTERIOR
            && self.subgrid.occupant(cell, local as usize).is_none()
    }

    pub fn set_transfer_interval(&mut self, interval: u32) {
        self.machines.set_transfer_interval(interval.max(1));
    }

    /// Removes every machine so a layout can be rebuilt from scratch.
    pub fn clear_machines(&mut self) {
        self.machines.retain(|_| false);
        self.rebuild_subgrid_from_machines();
    }

    /// Keeps the product identifier from having to cross the boundary.
    pub fn place_product_at_cell(&mut self, cell: usize) -> bool {
        if cell >= self.lattice.cell_count() {
            return false;
        }
        match self.machines.slot_at_cell(cell) {
            Some(slot) => {
                self.machines.set_holding(slot, PRODUCT_DEFAULT);
                true
            }
            None => false,
        }
    }
}

impl ApcInterior {
    fn insert_machine(&mut self, cell: usize, kind: MachineKind, output_face: u8) -> bool {
        if cell >= self.lattice.cell_count() {
            return false;
        }
        let machine_id = self.machines.next_machine_id();
        if !self
            .subgrid
            .reserve_machine(cell, FULL_CUBE_FOOTPRINT, machine_id)
        {
            return false;
        }
        self.machines
            .add_machine_with_footprint(cell, FULL_CUBE_FOOTPRINT, kind as u8, output_face);
        true
    }

    /// Merges repeatedly rather than once: a 1+1 join can immediately qualify
    /// for a 2+2 join, and so on up to the full cube.
    fn join_machines_at(&mut self, cell: usize, machine_id: u32) -> u32 {
        let mut current = machine_id;
        loop {
            let Some(slot) = self.machines.slot_by_id(current) else {
                return current;
            };
            let footprint = self.machines.footprint_of(slot);
            let kind = self.machines.kind_of(slot);
            let output_face = self.machines.output_face_of(slot);

            let partner = self.machines.slots_in_cell(cell).into_iter().find(|&other| {
                other != slot
                    && self.machines.kind_of(other) == kind
                    && footprints_can_join(footprint, self.machines.footprint_of(other))
            });
            let Some(partner_slot) = partner else {
                return current;
            };

            let merged = footprint | self.machines.footprint_of(partner_slot);
            // Drop the higher slot first so the lower index stays valid.
            self.machines.remove_slot(slot.max(partner_slot));
            self.machines.remove_slot(slot.min(partner_slot));
            current = self
                .machines
                .add_machine_with_footprint(cell, merged, kind, output_face);
            self.rebuild_subgrid_from_machines();
        }
    }

    fn rebuild_subgrid_from_machines(&mut self) {
        self.subgrid = Subgrid::new(self.lattice.cell_count());
        for slot in 0..self.machines.machine_count() {
            let cell = self.machines.cell_of(slot);
            let footprint = self.machines.footprint_of(slot);
            let machine_id = self.machines.id_of(slot);
            let _ = self.subgrid.reserve_machine(cell, footprint, machine_id);
        }

        for slot in 0..self.units.count() {
            let unit_id = self.units.unit_ids[slot];
            let cell = self.units.cells[slot];
            let local = self.units.subcells[slot];
            if unit_id == EMPTY_UNIT_SLOT_ID || cell == EMPTY_UNIT_CELL || local == EMPTY_UNIT_SUBCELL {
                continue;
            }
            if !Self::is_floor_local(local) {
                self.units.cells[slot] = EMPTY_UNIT_CELL;
                self.units.subcells[slot] = EMPTY_UNIT_SUBCELL;
                continue;
            }
            let placed = self
                .subgrid
                .reserve_unit(cell as usize, local as usize, unit_id);
            if !placed {
                self.units.cells[slot] = EMPTY_UNIT_CELL;
                self.units.subcells[slot] = EMPTY_UNIT_SUBCELL;
            }
        }
    }
}
