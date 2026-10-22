//! Interior unit roster storage and the boarding/exit lifecycle.

use wasm_bindgen::prelude::*;

use super::ApcInterior;
use crate::lattice::CELL_INTERIOR;
use crate::subgrid::OCCUPANT_UNIT;

pub(super) const FLOOR_SUBCELLS_PER_CELL: usize = 4;
pub(super) const EMPTY_UNIT_SLOT_ID: u32 = u32::MAX;
pub(super) const EMPTY_MACHINE_ASSIGNMENT: u32 = u32::MAX;
pub(super) const EMPTY_EQUIPMENT_ITEM_ID: u32 = u32::MAX;
pub(super) const EMPTY_UNIT_CELL: u32 = u32::MAX;
pub(super) const EMPTY_UNIT_SUBCELL: u8 = u8::MAX;
pub(super) const UNIT_SCHEMA_VERSION_V1: u16 = 1;
pub(super) const EQUIPMENT_SLOT_COUNT: usize = 4;

#[wasm_bindgen]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum InteriorUnitMode {
    BoardedIdle = 0,
    AssignedMachine = 1,
    Exiting = 2,
    Deployed = 3,
    Returning = 4,
    Boarding = 5,
    Incapacitated = 6,
}

#[wasm_bindgen]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum UnitSpecialization {
    Generalist = 0,
    Assault = 1,
    Medic = 2,
    Engineer = 3,
    Pilot = 4,
    Scout = 5,
}

#[wasm_bindgen]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum InteriorLifecycleResult {
    Ok = 0,
    NoSuchUnit = 1,
    InvalidTransition = 2,
    MissingPlacement = 3,
    InvalidBoardingDestination = 4,
    OccupiedBoardingDestination = 5,
}

pub(super) struct InteriorUnitDomain {
    // Identity and schema versioning for migration-safe save blobs.
    pub(super) schema_versions: Vec<u16>,
    pub(super) unit_ids: Vec<u32>,

    // Runtime location in APC lattice/subgrid space.
    pub(super) cells: Vec<u32>,
    pub(super) subcells: Vec<u8>,
    pub(super) modes: Vec<u8>,
    pub(super) specializations: Vec<u8>,

    // Core gameplay stats.
    pub(super) health_current: Vec<u16>,
    pub(super) health_max: Vec<u16>,
    pub(super) combat_skill: Vec<u16>,
    pub(super) machine_operation_skill: Vec<u16>,
    pub(super) vehicle_operation_skill: Vec<u16>,
    pub(super) heat_capacity: Vec<u16>,
    pub(super) heat_regen_per_tick: Vec<u16>,
    pub(super) upgrade_points: Vec<u16>,

    // Machine interaction anchors (used by assignment/operation systems).
    pub(super) assigned_machine_id: Vec<u32>,

    // Future equipment/inventory systems.
    pub(super) equipment_slots: Vec<u32>,
    pub(super) inventory_capacity: Vec<u16>,
    pub(super) inventory_load: Vec<u16>,

    pub(super) count: usize,
    pub(super) capacity: usize,
    pub(super) next_unit_id: u32,
}

impl InteriorUnitDomain {
    pub(super) fn new(cell_count: usize) -> Self {
        let capacity = cell_count * FLOOR_SUBCELLS_PER_CELL;
        let mut domain = Self {
            schema_versions: vec![0; capacity],
            unit_ids: vec![EMPTY_UNIT_SLOT_ID; capacity],
            cells: vec![EMPTY_UNIT_CELL; capacity],
            subcells: vec![EMPTY_UNIT_SUBCELL; capacity],
            modes: vec![InteriorUnitMode::BoardedIdle as u8; capacity],
            specializations: vec![UnitSpecialization::Generalist as u8; capacity],
            health_current: vec![0; capacity],
            health_max: vec![0; capacity],
            combat_skill: vec![0; capacity],
            machine_operation_skill: vec![0; capacity],
            vehicle_operation_skill: vec![0; capacity],
            heat_capacity: vec![0; capacity],
            heat_regen_per_tick: vec![0; capacity],
            upgrade_points: vec![0; capacity],
            assigned_machine_id: vec![EMPTY_MACHINE_ASSIGNMENT; capacity],
            equipment_slots: vec![EMPTY_EQUIPMENT_ITEM_ID; capacity * EQUIPMENT_SLOT_COUNT],
            inventory_capacity: vec![0; capacity],
            inventory_load: vec![0; capacity],
            count: 0,
            capacity,
            next_unit_id: 0,
        };
        domain.clear();
        domain
    }

    pub(super) fn capacity(&self) -> usize {
        self.capacity
    }

    pub(super) fn count(&self) -> usize {
        self.count
    }

    pub(super) fn register_profile(&mut self, specialization: UnitSpecialization) -> i32 {
        if self.count >= self.capacity {
            return -1;
        }
        let slot = self.count;
        self.count += 1;

        let unit_id = self.next_unit_id;
        self.next_unit_id = self
            .next_unit_id
            .checked_add(1)
            .unwrap_or(self.next_unit_id);

        self.schema_versions[slot] = UNIT_SCHEMA_VERSION_V1;
        self.unit_ids[slot] = unit_id;
        self.cells[slot] = EMPTY_UNIT_CELL;
        self.subcells[slot] = EMPTY_UNIT_SUBCELL;
        self.modes[slot] = InteriorUnitMode::BoardedIdle as u8;
        self.specializations[slot] = specialization as u8;

        self.health_current[slot] = 100;
        self.health_max[slot] = 100;
        self.combat_skill[slot] = 50;
        self.machine_operation_skill[slot] = 50;
        self.vehicle_operation_skill[slot] = 50;
        self.heat_capacity[slot] = 100;
        self.heat_regen_per_tick[slot] = 2;
        self.upgrade_points[slot] = 0;

        self.assigned_machine_id[slot] = EMPTY_MACHINE_ASSIGNMENT;
        self.inventory_capacity[slot] = 8;
        self.inventory_load[slot] = 0;
        let equipment_base = slot * EQUIPMENT_SLOT_COUNT;
        for i in 0..EQUIPMENT_SLOT_COUNT {
            self.equipment_slots[equipment_base + i] = EMPTY_EQUIPMENT_ITEM_ID;
        }

        unit_id as i32
    }

    pub(super) fn clear(&mut self) {
        self.schema_versions.fill(0);
        self.unit_ids.fill(EMPTY_UNIT_SLOT_ID);
        self.cells.fill(EMPTY_UNIT_CELL);
        self.subcells.fill(EMPTY_UNIT_SUBCELL);
        self.modes.fill(InteriorUnitMode::BoardedIdle as u8);
        self.specializations
            .fill(UnitSpecialization::Generalist as u8);
        self.health_current.fill(0);
        self.health_max.fill(0);
        self.combat_skill.fill(0);
        self.machine_operation_skill.fill(0);
        self.vehicle_operation_skill.fill(0);
        self.heat_capacity.fill(0);
        self.heat_regen_per_tick.fill(0);
        self.upgrade_points.fill(0);
        self.assigned_machine_id.fill(EMPTY_MACHINE_ASSIGNMENT);
        self.equipment_slots.fill(EMPTY_EQUIPMENT_ITEM_ID);
        self.inventory_capacity.fill(0);
        self.inventory_load.fill(0);
        self.count = 0;
        self.next_unit_id = 0;
    }
}

#[wasm_bindgen]
impl ApcInterior {
    pub fn interior_unit_capacity(&self) -> usize {
        self.units.capacity()
    }

    pub fn interior_unit_count(&self) -> usize {
        self.units.count()
    }

    pub fn register_interior_unit_profile(&mut self, specialization: UnitSpecialization) -> i32 {
        self.units.register_profile(specialization)
    }

    pub fn clear_interior_unit_profiles(&mut self) {
        self.units.clear();
        self.rebuild_subgrid_from_machines();
    }

    pub fn place_interior_unit(&mut self, unit_id: u32, cell: usize, local: u8) -> bool {
        if !Self::is_floor_local(local) || cell >= self.lattice.cell_count() {
            return false;
        }
        if self.lattice.cell_kind(cell) != CELL_INTERIOR {
            return false;
        }

        let Some(slot) = self.unit_slot_by_id(unit_id) else {
            return false;
        };

        let current_cell = self.units.cells[slot];
        let current_local = self.units.subcells[slot];
        if current_cell != EMPTY_UNIT_CELL && current_local != EMPTY_UNIT_SUBCELL {
            let from_cell = current_cell as usize;
            let from_local = current_local as usize;
            if from_cell == cell && from_local == local as usize {
                return true;
            }
            if !self
                .subgrid
                .relocate_unit(from_cell, from_local, cell, local as usize, unit_id)
            {
                return false;
            }
        } else if !self.subgrid.reserve_unit(cell, local as usize, unit_id) {
            return false;
        }

        self.units.cells[slot] = cell as u32;
        self.units.subcells[slot] = local;
        true
    }

    pub fn clear_interior_unit_placement(&mut self, unit_id: u32) -> bool {
        let Some(slot) = self.unit_slot_by_id(unit_id) else {
            return false;
        };
        if self.units.cells[slot] == EMPTY_UNIT_CELL {
            return true;
        }
        self.subgrid.release(OCCUPANT_UNIT, unit_id);
        self.units.cells[slot] = EMPTY_UNIT_CELL;
        self.units.subcells[slot] = EMPTY_UNIT_SUBCELL;
        true
    }

    pub fn set_interior_unit_mode(&mut self, unit_id: u32, mode: InteriorUnitMode) -> bool {
        let Some(slot) = self.unit_slot_by_id(unit_id) else {
            return false;
        };
        self.units.modes[slot] = mode as u8;
        true
    }

    pub fn begin_interior_unit_exit(&mut self, unit_id: u32) -> InteriorLifecycleResult {
        let Some(slot) = self.unit_slot_by_id(unit_id) else {
            return InteriorLifecycleResult::NoSuchUnit;
        };
        let current = self.units.modes[slot];
        if current != InteriorUnitMode::BoardedIdle as u8
            && current != InteriorUnitMode::AssignedMachine as u8
        {
            return InteriorLifecycleResult::InvalidTransition;
        }
        if !self.slot_has_valid_placement(slot) {
            return InteriorLifecycleResult::MissingPlacement;
        }
        self.units.modes[slot] = InteriorUnitMode::Exiting as u8;
        InteriorLifecycleResult::Ok
    }

    pub fn mark_interior_unit_deployed(&mut self, unit_id: u32) -> InteriorLifecycleResult {
        let Some(slot) = self.unit_slot_by_id(unit_id) else {
            return InteriorLifecycleResult::NoSuchUnit;
        };
        if self.units.modes[slot] != InteriorUnitMode::Exiting as u8 {
            return InteriorLifecycleResult::InvalidTransition;
        }

        let _ = self.clear_interior_unit_placement(unit_id);
        self.units.modes[slot] = InteriorUnitMode::Deployed as u8;
        InteriorLifecycleResult::Ok
    }

    pub fn begin_interior_unit_return(&mut self, unit_id: u32) -> InteriorLifecycleResult {
        let Some(slot) = self.unit_slot_by_id(unit_id) else {
            return InteriorLifecycleResult::NoSuchUnit;
        };
        if self.units.modes[slot] != InteriorUnitMode::Deployed as u8 {
            return InteriorLifecycleResult::InvalidTransition;
        }
        self.units.modes[slot] = InteriorUnitMode::Returning as u8;
        InteriorLifecycleResult::Ok
    }

    pub fn begin_interior_unit_boarding(&mut self, unit_id: u32) -> InteriorLifecycleResult {
        let Some(slot) = self.unit_slot_by_id(unit_id) else {
            return InteriorLifecycleResult::NoSuchUnit;
        };
        if self.units.modes[slot] != InteriorUnitMode::Returning as u8 {
            return InteriorLifecycleResult::InvalidTransition;
        }
        self.units.modes[slot] = InteriorUnitMode::Boarding as u8;
        InteriorLifecycleResult::Ok
    }

    pub fn complete_interior_unit_boarding(
        &mut self,
        unit_id: u32,
        cell: usize,
        local: u8,
    ) -> InteriorLifecycleResult {
        let Some(slot) = self.unit_slot_by_id(unit_id) else {
            return InteriorLifecycleResult::NoSuchUnit;
        };
        if self.units.modes[slot] != InteriorUnitMode::Boarding as u8 {
            return InteriorLifecycleResult::InvalidTransition;
        }
        if !Self::is_floor_local(local)
            || cell >= self.lattice.cell_count()
            || self.lattice.cell_kind(cell) != CELL_INTERIOR
        {
            return InteriorLifecycleResult::InvalidBoardingDestination;
        }
        if self.subgrid.occupant(cell, local as usize).is_some() {
            return InteriorLifecycleResult::OccupiedBoardingDestination;
        }
        if !self.place_interior_unit(unit_id, cell, local) {
            return InteriorLifecycleResult::OccupiedBoardingDestination;
        }

        self.units.modes[slot] = InteriorUnitMode::BoardedIdle as u8;
        InteriorLifecycleResult::Ok
    }

    pub fn set_interior_unit_machine_assignment(
        &mut self,
        unit_id: u32,
        machine_id: u32,
    ) -> InteriorLifecycleResult {
        let Some(slot) = self.unit_slot_by_id(unit_id) else {
            return InteriorLifecycleResult::NoSuchUnit;
        };
        if self.units.modes[slot] != InteriorUnitMode::BoardedIdle as u8
            && self.units.modes[slot] != InteriorUnitMode::AssignedMachine as u8
        {
            return InteriorLifecycleResult::InvalidTransition;
        }
        self.units.assigned_machine_id[slot] = machine_id;
        self.units.modes[slot] = InteriorUnitMode::AssignedMachine as u8;
        InteriorLifecycleResult::Ok
    }

    pub fn clear_interior_unit_machine_assignment(
        &mut self,
        unit_id: u32,
    ) -> InteriorLifecycleResult {
        let Some(slot) = self.unit_slot_by_id(unit_id) else {
            return InteriorLifecycleResult::NoSuchUnit;
        };
        if self.units.modes[slot] != InteriorUnitMode::AssignedMachine as u8 {
            return InteriorLifecycleResult::InvalidTransition;
        }
        self.units.assigned_machine_id[slot] = EMPTY_MACHINE_ASSIGNMENT;
        self.units.modes[slot] = InteriorUnitMode::BoardedIdle as u8;
        InteriorLifecycleResult::Ok
    }
}

impl ApcInterior {
    pub(super) fn is_floor_local(local: u8) -> bool {
        local < FLOOR_SUBCELLS_PER_CELL as u8
    }

    pub(super) fn unit_slot_by_id(&self, unit_id: u32) -> Option<usize> {
        (0..self.units.count()).find(|&slot| self.units.unit_ids[slot] == unit_id)
    }

    pub(super) fn slot_has_valid_placement(&self, slot: usize) -> bool {
        let unit_id = self.units.unit_ids[slot];
        let cell = self.units.cells[slot];
        let local = self.units.subcells[slot];
        if unit_id == EMPTY_UNIT_SLOT_ID || cell == EMPTY_UNIT_CELL || local == EMPTY_UNIT_SUBCELL {
            return false;
        }
        if !Self::is_floor_local(local) {
            return false;
        }
        let cell = cell as usize;
        matches!(
            self.subgrid.occupant(cell, local as usize),
            Some((OCCUPANT_UNIT, id)) if id == unit_id
        )
    }
}
