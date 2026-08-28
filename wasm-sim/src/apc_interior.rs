//! WASM-facing wrapper binding a [`Lattice`] to a [`MachineGrid`] for the APC.
//!
//! The APC-specific knowledge lives here so `lattice` stays generic and can
//! back generated structures later. Methods reachable from JS validate and
//! return status rather than asserting: a panic across the WASM boundary traps
//! and takes the page down with it.

use wasm_bindgen::prelude::*;

#[cfg(test)]
mod tests;

use crate::lattice::{Dims, Dir, Lattice, CELL_INTERIOR, CELL_OUTSIDE};
use crate::machines::{MachineGrid, MachineKind, FULL_CUBE_FOOTPRINT, NO_OUTPUT, PRODUCT_DEFAULT};
use crate::subgrid::Subgrid;

/// Growth is additive from a fixed corner so a cell index never changes
/// meaning. Recentering on expansion would invalidate stored machine cells,
/// saved blobs, and live JS views all at once.
const HULL_ORIGIN: (usize, usize, usize) = (0, 0, 0);

#[wasm_bindgen]
pub struct ApcInterior {
    lattice: Lattice,
    machines: MachineGrid,
    subgrid: Subgrid,
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

        let mut interior = ApcInterior {
            lattice,
            machines,
            subgrid,
            hull_w: 0,
            hull_h: 0,
            hull_d: 0,
        };
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

    // --- lattice views -----------------------------------------------------

    pub fn cell_kind_ptr(&self) -> *const u8 {
        self.lattice.cell_kind_slice().as_ptr()
    }

    pub fn face_x_len(&self) -> usize {
        self.lattice.face_x_slice().len()
    }

    pub fn face_y_len(&self) -> usize {
        self.lattice.face_y_slice().len()
    }

    pub fn face_z_len(&self) -> usize {
        self.lattice.face_z_slice().len()
    }

    pub fn face_x_ptr(&self) -> *const u8 {
        self.lattice.face_x_slice().as_ptr()
    }

    pub fn face_y_ptr(&self) -> *const u8 {
        self.lattice.face_y_slice().as_ptr()
    }

    pub fn face_z_ptr(&self) -> *const u8 {
        self.lattice.face_z_slice().as_ptr()
    }

    // --- machine views -----------------------------------------------------

    /// `false` when the cell is out of range or already occupied.
    pub fn add_machine(&mut self, cell: usize, kind: MachineKind, output_face: Dir) -> bool {
        self.insert_machine(cell, kind, output_face.index() as u8)
    }

    /// Separate entry point so no "none" sentinel has to cross the boundary.
    pub fn add_machine_without_output(&mut self, cell: usize, kind: MachineKind) -> bool {
        self.insert_machine(cell, kind, NO_OUTPUT)
    }

    pub fn machine_count(&self) -> usize {
        self.machines.machine_count()
    }

    pub fn machine_cells_ptr(&self) -> *const u32 {
        self.machines.cells_ptr()
    }

    pub fn machine_ids_ptr(&self) -> *const u32 {
        self.machines.ids_ptr()
    }

    pub fn machine_parent_cells_ptr(&self) -> *const u32 {
        self.machines.parent_cells_ptr()
    }

    pub fn machine_footprints_ptr(&self) -> *const u8 {
        self.machines.footprints_ptr()
    }

    pub fn machine_kinds_ptr(&self) -> *const u8 {
        self.machines.kinds_ptr()
    }

    pub fn machine_output_faces_ptr(&self) -> *const u8 {
        self.machines.output_faces_ptr()
    }

    pub fn machine_holding_ptr(&self) -> *const u8 {
        self.machines.holding_ptr()
    }

    pub fn subgrid_occupant_kinds_len(&self) -> usize {
        self.subgrid.occupant_kinds_slice().len()
    }

    pub fn subgrid_occupant_kinds_ptr(&self) -> *const u8 {
        self.subgrid.occupant_kinds_slice().as_ptr()
    }

    pub fn subgrid_occupant_ids_len(&self) -> usize {
        self.subgrid.occupant_ids_slice().len()
    }

    pub fn subgrid_occupant_ids_ptr(&self) -> *const u32 {
        self.subgrid.occupant_ids_slice().as_ptr()
    }

    pub fn set_transfer_interval(&mut self, interval: u32) {
        self.machines.set_transfer_interval(interval.max(1));
    }

    /// Removes every machine so a layout can be rebuilt from scratch.
    pub fn clear_machines(&mut self) {
        self.machines.retain(|_| false);
        self.subgrid = Subgrid::new(self.lattice.cell_count());
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

    fn rebuild_subgrid_from_machines(&mut self) {
        self.subgrid = Subgrid::new(self.lattice.cell_count());
        for slot in 0..self.machines.machine_count() {
            let cell = self.machines.cell_of(slot);
            let footprint = self.machines.footprint_of(slot);
            let machine_id = self.machines.id_of(slot);
            let _ = self.subgrid.reserve_machine(cell, footprint, machine_id);
        }
    }
}
