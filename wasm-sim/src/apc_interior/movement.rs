//! Interior unit spawning, deterministic wander, and subcell movement.

use wasm_bindgen::prelude::*;

use super::units::{
    InteriorUnitMode, UnitSpecialization, EMPTY_EQUIPMENT_ITEM_ID, EMPTY_MACHINE_ASSIGNMENT,
    EMPTY_UNIT_CELL, EMPTY_UNIT_SLOT_ID, EMPTY_UNIT_SUBCELL, EQUIPMENT_SLOT_COUNT,
    FLOOR_SUBCELLS_PER_CELL,
};
use super::ApcInterior;
use crate::lattice::{Dir, CELL_INTERIOR};
use crate::subgrid::{OCCUPANT_MACHINE, OCCUPANT_UNIT};

const INTERIOR_WANDER_DECISION_INTERVAL_TICKS: u32 = 50;

#[wasm_bindgen]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum InteriorMoveAction {
    Stay = 0,
    NegX = 1,
    PosX = 2,
    NegZ = 3,
    PosZ = 4,
}

#[wasm_bindgen]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum InteriorMoveResult {
    Ok = 0,
    BlockedNoUnitAtSource = 1,
    BlockedInvalidSourceSubcell = 2,
    BlockedInvalidTargetSubcell = 3,
    BlockedOutOfBounds = 4,
    BlockedTopology = 5,
    BlockedByMachine = 6,
    BlockedByUnit = 7,
    BlockedMode = 8,
}

#[wasm_bindgen]
impl ApcInterior {
    pub fn set_interior_unit_rng_seed(&mut self, seed: u32) {
        self.unit_rng_state = if seed == 0 { 1 } else { seed };
    }

    pub fn spawn_random_interior_unit(&mut self, specialization: UnitSpecialization) -> i32 {
        let Some((cell, local)) = self.pick_random_free_floor_slot() else {
            return -1;
        };

        let unit_id = self.units.register_profile(specialization);
        if unit_id < 0 {
            return -1;
        }

        if !self.place_interior_unit(unit_id as u32, cell, local) {
            // Capacity/profile creation succeeded but placement failed due to a
            // race with occupancy changes in this same tick; roll back profile.
            self.units.count = self.units.count.saturating_sub(1);
            let slot = self.units.count;
            self.units.schema_versions[slot] = 0;
            self.units.unit_ids[slot] = EMPTY_UNIT_SLOT_ID;
            self.units.cells[slot] = EMPTY_UNIT_CELL;
            self.units.subcells[slot] = EMPTY_UNIT_SUBCELL;
            self.units.modes[slot] = InteriorUnitMode::BoardedIdle as u8;
            self.units.specializations[slot] = UnitSpecialization::Generalist as u8;
            self.units.health_current[slot] = 0;
            self.units.health_max[slot] = 0;
            self.units.combat_skill[slot] = 0;
            self.units.machine_operation_skill[slot] = 0;
            self.units.vehicle_operation_skill[slot] = 0;
            self.units.heat_capacity[slot] = 0;
            self.units.heat_regen_per_tick[slot] = 0;
            self.units.upgrade_points[slot] = 0;
            self.units.assigned_machine_id[slot] = EMPTY_MACHINE_ASSIGNMENT;
            self.units.inventory_capacity[slot] = 0;
            self.units.inventory_load[slot] = 0;
            let equipment_base = slot * EQUIPMENT_SLOT_COUNT;
            for i in 0..EQUIPMENT_SLOT_COUNT {
                self.units.equipment_slots[equipment_base + i] = EMPTY_EQUIPMENT_ITEM_ID;
            }
            return -1;
        }

        unit_id
    }

    pub fn step_interior_unit_wander(&mut self) {
        self.wander_decision_tick = self.wander_decision_tick.wrapping_add(1);
        if self.wander_decision_tick % INTERIOR_WANDER_DECISION_INTERVAL_TICKS != 0 {
            return;
        }

        for slot in 0..self.units.count() {
            let source_cell = self.units.cells[slot];
            let source_local = self.units.subcells[slot];
            if source_cell == EMPTY_UNIT_CELL || source_local == EMPTY_UNIT_SUBCELL {
                continue;
            }
            if !Self::can_move_interior(self.units.modes[slot]) {
                continue;
            }

            let action = self.random_move_action();
            let _ = self.try_move_slot(slot, source_cell as usize, source_local, action);
        }
    }

    pub fn try_move_interior_unit(
        &mut self,
        unit_id: u32,
        action: InteriorMoveAction,
    ) -> InteriorMoveResult {
        let Some(slot) = self.unit_slot_by_id(unit_id) else {
            return InteriorMoveResult::BlockedNoUnitAtSource;
        };
        let source_cell = self.units.cells[slot];
        let source_local = self.units.subcells[slot];
        if source_cell == EMPTY_UNIT_CELL || source_local == EMPTY_UNIT_SUBCELL {
            return InteriorMoveResult::BlockedNoUnitAtSource;
        }
        self.try_move_slot(slot, source_cell as usize, source_local, action)
    }

    pub fn try_move_interior_unit_from(
        &mut self,
        unit_id: u32,
        source_cell: usize,
        source_local: u8,
        action: InteriorMoveAction,
    ) -> InteriorMoveResult {
        let Some(slot) = self.unit_slot_by_id(unit_id) else {
            return InteriorMoveResult::BlockedNoUnitAtSource;
        };
        if !Self::is_floor_local(source_local) {
            return InteriorMoveResult::BlockedInvalidSourceSubcell;
        }
        if self.units.cells[slot] != source_cell as u32 || self.units.subcells[slot] != source_local {
            return InteriorMoveResult::BlockedNoUnitAtSource;
        }
        self.try_move_slot(slot, source_cell, source_local, action)
    }

    /// Packed result used by tests/debug tooling.
    /// bits 0..31 = target cell (u32::MAX on failure)
    /// bits 32..39 = target local (u8::MAX on failure)
    /// bits 40..47 = InteriorMoveResult code
    pub fn resolve_interior_unit_target(
        &self,
        source_cell: usize,
        source_local: u8,
        action: InteriorMoveAction,
    ) -> u64 {
        let result = self.resolve_target(source_cell, source_local, action);
        match result {
            Ok((target_cell, target_local)) => {
                (target_cell as u64) | ((target_local as u64) << 32) | ((InteriorMoveResult::Ok as u64) << 40)
            }
            Err(code) => {
                (u32::MAX as u64) | ((u8::MAX as u64) << 32) | ((code as u64) << 40)
            }
        }
    }
}

impl ApcInterior {
    pub(super) fn default_unit_rng_seed(&self, transfer_interval: u32) -> u32 {
        let mut seed = self.envelope_w() as u32;
        seed ^= (self.envelope_h() as u32).wrapping_mul(0x9E37_79B1);
        seed ^= (self.envelope_d() as u32).wrapping_mul(0x85EB_CA77);
        seed ^= transfer_interval.max(1).wrapping_mul(0xC2B2_AE3D);
        if seed == 0 { 1 } else { seed }
    }

    fn next_unit_rng(&mut self) -> u32 {
        let mut s = self.unit_rng_state;
        s ^= s << 13;
        s ^= s >> 17;
        s ^= s << 5;
        self.unit_rng_state = if s == 0 { 1 } else { s };
        self.unit_rng_state
    }

    fn random_move_action(&mut self) -> InteriorMoveAction {
        match self.next_unit_rng() % 5 {
            0 => InteriorMoveAction::Stay,
            1 => InteriorMoveAction::NegX,
            2 => InteriorMoveAction::PosX,
            3 => InteriorMoveAction::NegZ,
            _ => InteriorMoveAction::PosZ,
        }
    }

    fn pick_random_free_floor_slot(&mut self) -> Option<(usize, u8)> {
        let mut free_count = 0usize;
        for y in 0..self.hull_h {
            for z in 0..self.hull_d {
                for x in 0..self.hull_w {
                    let cell = self.lattice.cell_index(x, y, z);
                    if self.lattice.cell_kind(cell) != CELL_INTERIOR {
                        continue;
                    }
                    for local in 0..FLOOR_SUBCELLS_PER_CELL {
                        if self.subgrid.occupant(cell, local).is_none() {
                            free_count += 1;
                        }
                    }
                }
            }
        }

        if free_count == 0 {
            return None;
        }

        let mut choice = (self.next_unit_rng() as usize) % free_count;
        for y in 0..self.hull_h {
            for z in 0..self.hull_d {
                for x in 0..self.hull_w {
                    let cell = self.lattice.cell_index(x, y, z);
                    if self.lattice.cell_kind(cell) != CELL_INTERIOR {
                        continue;
                    }
                    for local in 0..FLOOR_SUBCELLS_PER_CELL {
                        if self.subgrid.occupant(cell, local).is_some() {
                            continue;
                        }
                        if choice == 0 {
                            return Some((cell, local as u8));
                        }
                        choice -= 1;
                    }
                }
            }
        }

        None
    }

    fn can_move_interior(mode: u8) -> bool {
        mode == InteriorUnitMode::BoardedIdle as u8
    }

    fn try_move_slot(
        &mut self,
        slot: usize,
        source_cell: usize,
        source_local: u8,
        action: InteriorMoveAction,
    ) -> InteriorMoveResult {
        if !Self::is_floor_local(source_local) {
            return InteriorMoveResult::BlockedInvalidSourceSubcell;
        }
        if source_cell >= self.lattice.cell_count() {
            return InteriorMoveResult::BlockedOutOfBounds;
        }
        if self.lattice.cell_kind(source_cell) != CELL_INTERIOR {
            return InteriorMoveResult::BlockedTopology;
        }
        if !Self::can_move_interior(self.units.modes[slot]) {
            return InteriorMoveResult::BlockedMode;
        }

        let unit_id = self.units.unit_ids[slot];
        if !matches!(
            self.subgrid.occupant(source_cell, source_local as usize),
            Some((OCCUPANT_UNIT, id)) if id == unit_id
        ) {
            return InteriorMoveResult::BlockedNoUnitAtSource;
        }

        let (target_cell, target_local) = match self.resolve_target(source_cell, source_local, action) {
            Ok(target) => target,
            Err(code) => return code,
        };

        if !Self::is_floor_local(target_local) {
            return InteriorMoveResult::BlockedInvalidTargetSubcell;
        }

        if target_cell == source_cell && target_local == source_local {
            return InteriorMoveResult::Ok;
        }

        match self.subgrid.occupant(target_cell, target_local as usize) {
            Some((OCCUPANT_MACHINE, _)) => return InteriorMoveResult::BlockedByMachine,
            Some((OCCUPANT_UNIT, _)) => return InteriorMoveResult::BlockedByUnit,
            Some(_) => return InteriorMoveResult::BlockedTopology,
            None => {}
        }

        if !self.subgrid.relocate_unit(
            source_cell,
            source_local as usize,
            target_cell,
            target_local as usize,
            unit_id,
        ) {
            return InteriorMoveResult::BlockedTopology;
        }

        self.units.cells[slot] = target_cell as u32;
        self.units.subcells[slot] = target_local;
        InteriorMoveResult::Ok
    }

    fn resolve_target(
        &self,
        source_cell: usize,
        source_local: u8,
        action: InteriorMoveAction,
    ) -> Result<(usize, u8), InteriorMoveResult> {
        if !Self::is_floor_local(source_local) {
            return Err(InteriorMoveResult::BlockedInvalidSourceSubcell);
        }

        if action == InteriorMoveAction::Stay {
            return Ok((source_cell, source_local));
        }

        let sx = (source_local & 1) as i32;
        let sz = ((source_local >> 1) & 1) as i32;
        let (dx, dz, dir) = match action {
            InteriorMoveAction::NegX => (-1, 0, Dir::NegX),
            InteriorMoveAction::PosX => (1, 0, Dir::PosX),
            InteriorMoveAction::NegZ => (0, -1, Dir::NegZ),
            InteriorMoveAction::PosZ => (0, 1, Dir::PosZ),
            InteriorMoveAction::Stay => return Ok((source_cell, source_local)),
        };

        let tx = sx + dx;
        let tz = sz + dz;

        if (0..=1).contains(&tx) && (0..=1).contains(&tz) {
            let local = (tx + 2 * tz) as u8;
            return Ok((source_cell, local));
        }

        let Some(neighbor) = self.lattice.neighbor(source_cell, dir) else {
            return Err(InteriorMoveResult::BlockedOutOfBounds);
        };
        if self.lattice.cell_kind(neighbor) != CELL_INTERIOR {
            return Err(InteriorMoveResult::BlockedTopology);
        }

        let wrapped_x = if tx < 0 {
            1
        } else if tx > 1 {
            0
        } else {
            tx
        };
        let wrapped_z = if tz < 0 {
            1
        } else if tz > 1 {
            0
        } else {
            tz
        };
        let local = (wrapped_x + 2 * wrapped_z) as u8;
        Ok((neighbor, local))
    }
}
