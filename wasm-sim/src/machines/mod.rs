//! Adjacency-only machine transfer over a [`Lattice`].
//!
//! Machines interact with the single neighbour behind their chosen output face
//! and nothing else: no conduits, no networks, no pathing. Depends on the
//! lattice; the lattice never depends on this.
//!
//! Stored as parallel arrays rather than a vector of structs so each field can
//! be handed to JS as a zero-copy view, matching the shape of `units.rs`.

// Remove once the WASM getters consume the full surface.
#![allow(dead_code)]

#[cfg(test)]
mod tests;

use crate::lattice::{Dir, Lattice};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum MachineKind {
    Plain = 0,
}

// Storage stays `u8` for zero-copy views; the enum is the boundary type.
pub const MACHINE_PLAIN: u8 = MachineKind::Plain as u8;

pub const NO_PRODUCT: u8 = 0;
pub const PRODUCT_DEFAULT: u8 = 1;

/// Stored on a machine rather than on the face it points through, because the
/// choice belongs to the sender, not to the shared wall.
pub const NO_OUTPUT: u8 = 255;
pub const FULL_CUBE_FOOTPRINT: u8 = 0xff;

const NO_MACHINE: u16 = u16::MAX;

pub struct MachineGrid {
    /// Kept sorted so behaviour cannot depend on the order machines were added.
    machine_ids: Vec<u32>,
    parent_cells: Vec<u32>,
    footprints: Vec<u8>,
    kinds: Vec<u8>,
    output_faces: Vec<u8>,
    holding: Vec<u8>,

    primary_slot_by_cell: Vec<u16>,
    incoming: Vec<u8>,
    outgoing: Vec<bool>,
    next_machine_id: u32,

    tick_counter: u32,
    transfer_interval: u32,
}

impl MachineGrid {
    pub fn new(cell_count: usize, transfer_interval: u32) -> Self {
        assert!(transfer_interval > 0, "transfer interval must be non-zero");
        Self {
            machine_ids: Vec::new(),
            parent_cells: Vec::new(),
            footprints: Vec::new(),
            kinds: Vec::new(),
            output_faces: Vec::new(),
            holding: Vec::new(),
            primary_slot_by_cell: vec![NO_MACHINE; cell_count],
            incoming: Vec::new(),
            outgoing: Vec::new(),
            next_machine_id: 0,
            tick_counter: 0,
            transfer_interval,
        }
    }

    pub fn add_machine(&mut self, cell: usize, kind: u8, output_face: u8) -> u32 {
        self.add_machine_with_footprint(cell, FULL_CUBE_FOOTPRINT, kind, output_face)
    }

    pub fn add_machine_with_footprint(
        &mut self,
        parent_cell: usize,
        footprint: u8,
        kind: u8,
        output_face: u8,
    ) -> u32 {
        assert!(parent_cell < self.primary_slot_by_cell.len(), "cell outside lattice");
        assert!(footprint != 0, "machine footprint must be non-zero");
        assert!(self.parent_cells.len() < NO_MACHINE as usize, "machine capacity");

        let id = self.next_machine_id;
        self.next_machine_id = self
            .next_machine_id
            .checked_add(1)
            .expect("machine id space exhausted");

        let mut position = 0;
        while position < self.parent_cells.len() {
            let cell = self.parent_cells[position];
            if cell > parent_cell as u32 {
                break;
            }
            if cell == parent_cell as u32 && self.machine_ids[position] > id {
                break;
            }
            position += 1;
        }
        self.machine_ids.insert(position, id);
        self.parent_cells.insert(position, parent_cell as u32);
        self.footprints.insert(position, footprint);
        self.kinds.insert(position, kind);
        self.output_faces.insert(position, output_face);
        self.holding.insert(position, NO_PRODUCT);
        self.incoming.insert(position, NO_PRODUCT);
        self.outgoing.insert(position, false);
        self.reindex();
        id
    }

    fn reindex(&mut self) {
        self.primary_slot_by_cell.fill(NO_MACHINE);
        for slot in 0..self.parent_cells.len() {
            let cell = self.parent_cells[slot] as usize;
            if self.primary_slot_by_cell[cell] == NO_MACHINE {
                self.primary_slot_by_cell[cell] = slot as u16;
            }
        }
    }

    /// Drops machines whose cell no longer qualifies. Reallocates, so any JS
    /// view over these arrays must re-read the pointer afterwards.
    pub fn retain<F: Fn(usize) -> bool>(&mut self, keep: F) {
        let mut machine_ids = Vec::with_capacity(self.machine_ids.len());
        let mut parent_cells = Vec::with_capacity(self.parent_cells.len());
        let mut footprints = Vec::with_capacity(self.footprints.len());
        let mut kinds = Vec::with_capacity(self.kinds.len());
        let mut output_faces = Vec::with_capacity(self.output_faces.len());
        let mut holding = Vec::with_capacity(self.holding.len());
        let mut incoming = Vec::with_capacity(self.incoming.len());
        let mut outgoing = Vec::with_capacity(self.outgoing.len());

        for slot in 0..self.parent_cells.len() {
            if keep(self.parent_cells[slot] as usize) {
                machine_ids.push(self.machine_ids[slot]);
                parent_cells.push(self.parent_cells[slot]);
                footprints.push(self.footprints[slot]);
                kinds.push(self.kinds[slot]);
                output_faces.push(self.output_faces[slot]);
                holding.push(self.holding[slot]);
                incoming.push(self.incoming[slot]);
                outgoing.push(self.outgoing[slot]);
            }
        }

        self.machine_ids = machine_ids;
        self.parent_cells = parent_cells;
        self.footprints = footprints;
        self.kinds = kinds;
        self.output_faces = output_faces;
        self.holding = holding;
        self.incoming = incoming;
        self.outgoing = outgoing;
        self.reindex();
    }

    pub fn machine_count(&self) -> usize {
        self.parent_cells.len()
    }

    pub fn next_machine_id(&self) -> u32 {
        self.next_machine_id
    }

    pub fn id_of(&self, slot: usize) -> u32 {
        self.machine_ids[slot]
    }

    pub fn cell_of(&self, slot: usize) -> usize {
        self.parent_cells[slot] as usize
    }

    pub fn footprint_of(&self, slot: usize) -> u8 {
        self.footprints[slot]
    }

    pub fn kind_of(&self, slot: usize) -> u8 {
        self.kinds[slot]
    }

    pub fn output_face_of(&self, slot: usize) -> u8 {
        self.output_faces[slot]
    }

    pub fn holding_of(&self, slot: usize) -> u8 {
        self.holding[slot]
    }

    pub fn slot_at_cell(&self, cell: usize) -> Option<usize> {
        match self.primary_slot_by_cell[cell] {
            NO_MACHINE => None,
            slot => Some(slot as usize),
        }
    }

    pub fn holding_at_cell(&self, cell: usize) -> u8 {
        self.slot_at_cell(cell)
            .map_or(NO_PRODUCT, |slot| self.holding[slot])
    }

    pub fn set_holding(&mut self, slot: usize, product: u8) {
        self.holding[slot] = product;
    }

    pub fn cells(&self) -> &[u32] {
        &self.parent_cells
    }

    pub fn ids(&self) -> &[u32] {
        &self.machine_ids
    }

    pub fn parent_cells(&self) -> &[u32] {
        &self.parent_cells
    }

    pub fn footprints(&self) -> &[u8] {
        &self.footprints
    }

    pub fn kinds(&self) -> &[u8] {
        &self.kinds
    }

    pub fn output_faces(&self) -> &[u8] {
        &self.output_faces
    }

    pub fn holdings(&self) -> &[u8] {
        &self.holding
    }

    pub fn cells_ptr(&self) -> *const u32 {
        self.parent_cells.as_ptr()
    }

    pub fn ids_ptr(&self) -> *const u32 {
        self.machine_ids.as_ptr()
    }

    pub fn parent_cells_ptr(&self) -> *const u32 {
        self.parent_cells.as_ptr()
    }

    pub fn footprints_ptr(&self) -> *const u8 {
        self.footprints.as_ptr()
    }

    pub fn kinds_ptr(&self) -> *const u8 {
        self.kinds.as_ptr()
    }

    pub fn output_faces_ptr(&self) -> *const u8 {
        self.output_faces.as_ptr()
    }

    pub fn holding_ptr(&self) -> *const u8 {
        self.holding.as_ptr()
    }

    /// Counts whole ticks rather than accumulating delta: a float accumulator
    /// would make transfer timing frame-rate dependent.
    pub fn tick(&mut self, lattice: &Lattice) {
        self.tick_counter += 1;
        if self.tick_counter < self.transfer_interval {
            return;
        }
        self.tick_counter = 0;
        self.step(lattice);
    }

    pub fn set_transfer_interval(&mut self, interval: u32) {
        assert!(interval > 0, "transfer interval must be non-zero");
        self.transfer_interval = interval;
        if self.tick_counter >= interval {
            self.tick_counter = 0;
        }
    }

    pub fn step(&mut self, lattice: &Lattice) {
        self.incoming.fill(NO_PRODUCT);
        self.outgoing.fill(false);

        // Every decision below reads pre-step state only, so the result does
        // not depend on the order machines are visited.
        for sender in 0..self.parent_cells.len() {
            let holding = self.holding[sender];
            if holding == NO_PRODUCT {
                continue;
            }
            let Some(dir) = Dir::from_index(self.output_faces[sender] as usize) else {
                continue;
            };
            let Some(destination) = lattice.neighbor(self.parent_cells[sender] as usize, dir) else {
                continue;
            };
            let Some(receiver) = self.slot_at_cell(destination) else {
                continue;
            };
            // Backpressure: a receiver that is full before the step stays full.
            if self.holding[receiver] != NO_PRODUCT {
                continue;
            }
            if self.incoming[receiver] != NO_PRODUCT {
                continue;
            }
            self.incoming[receiver] = holding;
            self.outgoing[sender] = true;
        }

        // Senders clear before receivers fill: a mid-chain machine is both.
        for slot in 0..self.parent_cells.len() {
            if self.outgoing[slot] {
                self.holding[slot] = NO_PRODUCT;
            }
        }
        for slot in 0..self.parent_cells.len() {
            if self.incoming[slot] != NO_PRODUCT {
                self.holding[slot] = self.incoming[slot];
            }
        }
    }
}
