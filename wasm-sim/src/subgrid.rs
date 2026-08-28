//! Dense 2x2x2 occupancy inside each lattice cell.
//!
//! The parent lattice remains the topology layer. This module only owns
//! cube-local placement and the mapping between subcells and face quarters.

// Remove as ApcInterior adopts the placement and view APIs.
#![allow(dead_code)]

use crate::lattice::Dir;

pub const SUBCELLS_PER_CELL: usize = 8;
pub const FACE_SLOTS_PER_FACE: usize = 4;
pub const EMPTY_OCCUPANT: u32 = u32::MAX;
pub const OCCUPANT_NONE: u8 = 0;
pub const OCCUPANT_MACHINE: u8 = 1;
pub const OCCUPANT_UNIT: u8 = 2;

const BOTTOM_SUBCELLS: u8 = 0b0000_1111;

pub struct Subgrid {
    occupant_ids: Vec<u32>,
    occupant_kinds: Vec<u8>,
}

impl Subgrid {
    pub fn new(cell_count: usize) -> Self {
        Self {
            occupant_ids: vec![EMPTY_OCCUPANT; cell_count * SUBCELLS_PER_CELL],
            occupant_kinds: vec![OCCUPANT_NONE; cell_count * SUBCELLS_PER_CELL],
        }
    }

    /// X is innermost, then Z, then Y. Indices 0..4 are always the floor.
    pub fn local_index(x: usize, y: usize, z: usize) -> Option<usize> {
        if x >= 2 || y >= 2 || z >= 2 {
            return None;
        }
        Some(x + 2 * (z + 2 * y))
    }

    pub fn index(&self, cell: usize, local: usize) -> Option<usize> {
        if local >= SUBCELLS_PER_CELL {
            return None;
        }
        let index = cell.checked_mul(SUBCELLS_PER_CELL)?.checked_add(local)?;
        (index < self.occupant_ids.len()).then_some(index)
    }

    /// Resolves one of the four quarters of a cube face to its adjacent
    /// subcell. Slot ordering preserves the two face-local axes across the
    /// corresponding face of a neighbouring cube.
    pub fn face_local_index(dir: Dir, slot: usize) -> Option<usize> {
        if slot >= FACE_SLOTS_PER_FACE {
            return None;
        }
        let low = slot % 2;
        let high = slot / 2;
        let (x, y, z) = match dir {
            Dir::NegX => (0, high, low),
            Dir::PosX => (1, high, low),
            Dir::NegY => (low, 0, high),
            Dir::PosY => (low, 1, high),
            Dir::NegZ => (low, high, 0),
            Dir::PosZ => (low, high, 1),
        };
        Self::local_index(x, y, z)
    }

    /// Reserves every bit in a cube-local footprint as one machine. The
    /// operation is atomic: overlap leaves the complete footprint unchanged.
    pub fn reserve_machine(&mut self, cell: usize, footprint: u8, machine_id: u32) -> bool {
        if footprint == 0 || machine_id == EMPTY_OCCUPANT {
            return false;
        }
        self.reserve(cell, footprint, OCCUPANT_MACHINE, machine_id)
    }

    /// Units occupy exactly one floor subcell and cannot be placed on top of
    /// machines or other units.
    pub fn reserve_unit(&mut self, cell: usize, local: usize, unit_id: u32) -> bool {
        if local >= SUBCELLS_PER_CELL
            || BOTTOM_SUBCELLS & (1 << local) == 0
            || unit_id == EMPTY_OCCUPANT
        {
            return false;
        }
        self.reserve(cell, 1 << local, OCCUPANT_UNIT, unit_id)
    }

    pub fn release(&mut self, kind: u8, occupant_id: u32) {
        for index in 0..self.occupant_ids.len() {
            if self.occupant_kinds[index] == kind && self.occupant_ids[index] == occupant_id {
                self.occupant_kinds[index] = OCCUPANT_NONE;
                self.occupant_ids[index] = EMPTY_OCCUPANT;
            }
        }
    }

    pub fn occupant(&self, cell: usize, local: usize) -> Option<(u8, u32)> {
        let index = self.index(cell, local)?;
        (self.occupant_kinds[index] != OCCUPANT_NONE)
            .then_some((self.occupant_kinds[index], self.occupant_ids[index]))
    }

    pub fn occupant_kinds_slice(&self) -> &[u8] {
        &self.occupant_kinds
    }

    pub fn occupant_ids_slice(&self) -> &[u32] {
        &self.occupant_ids
    }

    fn reserve(&mut self, cell: usize, footprint: u8, kind: u8, occupant_id: u32) -> bool {
        let Some(start) = self.index(cell, 0) else {
            return false;
        };
        for local in 0..SUBCELLS_PER_CELL {
            if footprint & (1 << local) != 0 && self.occupant_kinds[start + local] != OCCUPANT_NONE
            {
                return false;
            }
        }
        for local in 0..SUBCELLS_PER_CELL {
            if footprint & (1 << local) != 0 {
                self.occupant_kinds[start + local] = kind;
                self.occupant_ids[start + local] = occupant_id;
            }
        }
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_indices_put_the_four_floor_slots_first() {
        assert_eq!(Subgrid::local_index(0, 0, 0), Some(0));
        assert_eq!(Subgrid::local_index(1, 0, 0), Some(1));
        assert_eq!(Subgrid::local_index(0, 0, 1), Some(2));
        assert_eq!(Subgrid::local_index(1, 0, 1), Some(3));
        assert_eq!(Subgrid::local_index(0, 1, 0), Some(4));
        assert_eq!(Subgrid::local_index(2, 0, 0), None);
    }

    #[test]
    fn opposite_faces_preserve_quarter_slot_alignment() {
        for slot in 0..FACE_SLOTS_PER_FACE {
            assert_eq!(
                Subgrid::face_local_index(Dir::NegX, slot).unwrap() + 1,
                Subgrid::face_local_index(Dir::PosX, slot).unwrap()
            );
            assert_eq!(
                Subgrid::face_local_index(Dir::NegY, slot).unwrap() + 4,
                Subgrid::face_local_index(Dir::PosY, slot).unwrap()
            );
            assert_eq!(
                Subgrid::face_local_index(Dir::NegZ, slot).unwrap() + 2,
                Subgrid::face_local_index(Dir::PosZ, slot).unwrap()
            );
        }
    }

    #[test]
    fn machines_can_tetris_without_overlapping() {
        let mut grid = Subgrid::new(1);
        assert!(grid.reserve_machine(0, 0b0011_0011, 10));
        assert!(grid.reserve_machine(0, 0b1100_1100, 11));
        assert_eq!(grid.occupant(0, 0), Some((OCCUPANT_MACHINE, 10)));
        assert_eq!(grid.occupant(0, 7), Some((OCCUPANT_MACHINE, 11)));
    }

    #[test]
    fn an_overlapping_footprint_fails_atomically() {
        let mut grid = Subgrid::new(1);
        assert!(grid.reserve_machine(0, 0b0000_0010, 10));
        assert!(!grid.reserve_machine(0, 0b0000_0111, 11));
        assert_eq!(grid.occupant(0, 0), None);
        assert_eq!(grid.occupant(0, 1), Some((OCCUPANT_MACHINE, 10)));
        assert_eq!(grid.occupant(0, 2), None);
    }

    #[test]
    fn units_are_single_slot_floor_occupants() {
        let mut grid = Subgrid::new(1);
        assert!(grid.reserve_unit(0, 3, 20));
        assert!(!grid.reserve_unit(0, 4, 21));
        assert!(!grid.reserve_unit(0, 3, 21));
        assert_eq!(grid.occupant(0, 3), Some((OCCUPANT_UNIT, 20)));
    }

    #[test]
    fn releasing_one_occupant_preserves_the_others() {
        let mut grid = Subgrid::new(1);
        assert!(grid.reserve_machine(0, 0b0000_0011, 10));
        assert!(grid.reserve_unit(0, 2, 20));

        grid.release(OCCUPANT_MACHINE, 10);

        assert_eq!(grid.occupant(0, 0), None);
        assert_eq!(grid.occupant(0, 1), None);
        assert_eq!(grid.occupant(0, 2), Some((OCCUPANT_UNIT, 20)));
    }
}
