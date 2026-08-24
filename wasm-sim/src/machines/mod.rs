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

const NO_MACHINE: u16 = u16::MAX;

pub struct MachineGrid {
    /// Kept sorted so behaviour cannot depend on the order machines were added.
    cells: Vec<u32>,
    kinds: Vec<u8>,
    output_faces: Vec<u8>,
    holding: Vec<u8>,

    cell_to_machine: Vec<u16>,
    incoming: Vec<u8>,
    outgoing: Vec<bool>,

    tick_counter: u32,
    transfer_interval: u32,
}

impl MachineGrid {
    pub fn new(cell_count: usize, transfer_interval: u32) -> Self {
        assert!(transfer_interval > 0, "transfer interval must be non-zero");
        Self {
            cells: Vec::new(),
            kinds: Vec::new(),
            output_faces: Vec::new(),
            holding: Vec::new(),
            cell_to_machine: vec![NO_MACHINE; cell_count],
            incoming: Vec::new(),
            outgoing: Vec::new(),
            tick_counter: 0,
            transfer_interval,
        }
    }

    pub fn add_machine(&mut self, cell: usize, kind: u8, output_face: u8) {
        assert!(cell < self.cell_to_machine.len(), "cell outside lattice");
        assert!(
            self.cell_to_machine[cell] == NO_MACHINE,
            "cell already holds a machine"
        );
        assert!(self.cells.len() < NO_MACHINE as usize, "machine capacity");

        let position = self.cells.partition_point(|&c| c < cell as u32);
        self.cells.insert(position, cell as u32);
        self.kinds.insert(position, kind);
        self.output_faces.insert(position, output_face);
        self.holding.insert(position, NO_PRODUCT);
        self.incoming.push(NO_PRODUCT);
        self.outgoing.push(false);
        self.reindex();
    }

    fn reindex(&mut self) {
        self.cell_to_machine.fill(NO_MACHINE);
        for slot in 0..self.cells.len() {
            self.cell_to_machine[self.cells[slot] as usize] = slot as u16;
        }
    }

    /// Drops machines whose cell no longer qualifies. Reallocates, so any JS
    /// view over these arrays must re-read the pointer afterwards.
    pub fn retain<F: Fn(usize) -> bool>(&mut self, keep: F) {
        let mut cells = Vec::with_capacity(self.cells.len());
        let mut kinds = Vec::with_capacity(self.kinds.len());
        let mut output_faces = Vec::with_capacity(self.output_faces.len());
        let mut holding = Vec::with_capacity(self.holding.len());

        for slot in 0..self.cells.len() {
            if keep(self.cells[slot] as usize) {
                cells.push(self.cells[slot]);
                kinds.push(self.kinds[slot]);
                output_faces.push(self.output_faces[slot]);
                holding.push(self.holding[slot]);
            }
        }

        self.cells = cells;
        self.kinds = kinds;
        self.output_faces = output_faces;
        self.holding = holding;
        self.incoming.truncate(self.cells.len());
        self.outgoing.truncate(self.cells.len());
        self.reindex();
    }

    pub fn machine_count(&self) -> usize {
        self.cells.len()
    }

    pub fn cell_of(&self, slot: usize) -> usize {
        self.cells[slot] as usize
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
        match self.cell_to_machine[cell] {
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
        &self.cells
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
        self.cells.as_ptr()
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
        for sender in 0..self.cells.len() {
            let holding = self.holding[sender];
            if holding == NO_PRODUCT {
                continue;
            }
            let Some(dir) = Dir::from_index(self.output_faces[sender] as usize) else {
                continue;
            };
            let Some(destination) = lattice.neighbor(self.cells[sender] as usize, dir) else {
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
        for slot in 0..self.cells.len() {
            if self.outgoing[slot] {
                self.holding[slot] = NO_PRODUCT;
            }
        }
        for slot in 0..self.cells.len() {
            if self.incoming[slot] != NO_PRODUCT {
                self.holding[slot] = self.incoming[slot];
            }
        }
    }
}
