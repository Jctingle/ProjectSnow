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
use crate::subgrid::{Subgrid, OCCUPANT_MACHINE, OCCUPANT_UNIT};

const FLOOR_SUBCELLS_PER_CELL: usize = 4;
const EMPTY_UNIT_SLOT_ID: u32 = u32::MAX;
const EMPTY_MACHINE_ASSIGNMENT: u32 = u32::MAX;
const EMPTY_EQUIPMENT_ITEM_ID: u32 = u32::MAX;
const EMPTY_UNIT_CELL: u32 = u32::MAX;
const EMPTY_UNIT_SUBCELL: u8 = u8::MAX;
const UNIT_SCHEMA_VERSION_V1: u16 = 1;
const EQUIPMENT_SLOT_COUNT: usize = 4;

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

struct InteriorUnitDomain {
    // Identity and schema versioning for migration-safe save blobs.
    schema_versions: Vec<u16>,
    unit_ids: Vec<u32>,

    // Runtime location in APC lattice/subgrid space.
    cells: Vec<u32>,
    subcells: Vec<u8>,
    modes: Vec<u8>,
    specializations: Vec<u8>,

    // Core gameplay stats.
    health_current: Vec<u16>,
    health_max: Vec<u16>,
    combat_skill: Vec<u16>,
    machine_operation_skill: Vec<u16>,
    vehicle_operation_skill: Vec<u16>,
    heat_capacity: Vec<u16>,
    heat_regen_per_tick: Vec<u16>,
    upgrade_points: Vec<u16>,

    // Machine interaction anchors (used by assignment/operation systems).
    assigned_machine_id: Vec<u32>,

    // Future equipment/inventory systems.
    equipment_slots: Vec<u32>,
    inventory_capacity: Vec<u16>,
    inventory_load: Vec<u16>,

    count: usize,
    capacity: usize,
    next_unit_id: u32,
}

impl InteriorUnitDomain {
    fn new(cell_count: usize) -> Self {
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

    fn capacity(&self) -> usize {
        self.capacity
    }

    fn count(&self) -> usize {
        self.count
    }

    fn register_profile(&mut self, specialization: UnitSpecialization) -> i32 {
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

    fn clear(&mut self) {
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

    // --- interior unit domain views ---------------------------------------

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

    pub fn interior_unit_schema_versions_len(&self) -> usize {
        self.units.schema_versions.len()
    }

    pub fn interior_unit_schema_versions_ptr(&self) -> *const u16 {
        self.units.schema_versions.as_ptr()
    }

    pub fn interior_unit_ids_len(&self) -> usize {
        self.units.unit_ids.len()
    }

    pub fn interior_unit_ids_ptr(&self) -> *const u32 {
        self.units.unit_ids.as_ptr()
    }

    pub fn interior_unit_cells_len(&self) -> usize {
        self.units.cells.len()
    }

    pub fn interior_unit_cells_ptr(&self) -> *const u32 {
        self.units.cells.as_ptr()
    }

    pub fn interior_unit_subcells_len(&self) -> usize {
        self.units.subcells.len()
    }

    pub fn interior_unit_subcells_ptr(&self) -> *const u8 {
        self.units.subcells.as_ptr()
    }

    pub fn interior_unit_modes_len(&self) -> usize {
        self.units.modes.len()
    }

    pub fn interior_unit_modes_ptr(&self) -> *const u8 {
        self.units.modes.as_ptr()
    }

    pub fn interior_unit_specializations_len(&self) -> usize {
        self.units.specializations.len()
    }

    pub fn interior_unit_specializations_ptr(&self) -> *const u8 {
        self.units.specializations.as_ptr()
    }

    pub fn interior_unit_health_current_len(&self) -> usize {
        self.units.health_current.len()
    }

    pub fn interior_unit_health_current_ptr(&self) -> *const u16 {
        self.units.health_current.as_ptr()
    }

    pub fn interior_unit_health_max_len(&self) -> usize {
        self.units.health_max.len()
    }

    pub fn interior_unit_health_max_ptr(&self) -> *const u16 {
        self.units.health_max.as_ptr()
    }

    pub fn interior_unit_combat_skill_len(&self) -> usize {
        self.units.combat_skill.len()
    }

    pub fn interior_unit_combat_skill_ptr(&self) -> *const u16 {
        self.units.combat_skill.as_ptr()
    }

    pub fn interior_unit_machine_operation_skill_len(&self) -> usize {
        self.units.machine_operation_skill.len()
    }

    pub fn interior_unit_machine_operation_skill_ptr(&self) -> *const u16 {
        self.units.machine_operation_skill.as_ptr()
    }

    pub fn interior_unit_vehicle_operation_skill_len(&self) -> usize {
        self.units.vehicle_operation_skill.len()
    }

    pub fn interior_unit_vehicle_operation_skill_ptr(&self) -> *const u16 {
        self.units.vehicle_operation_skill.as_ptr()
    }

    pub fn interior_unit_heat_capacity_len(&self) -> usize {
        self.units.heat_capacity.len()
    }

    pub fn interior_unit_heat_capacity_ptr(&self) -> *const u16 {
        self.units.heat_capacity.as_ptr()
    }

    pub fn interior_unit_heat_regen_per_tick_len(&self) -> usize {
        self.units.heat_regen_per_tick.len()
    }

    pub fn interior_unit_heat_regen_per_tick_ptr(&self) -> *const u16 {
        self.units.heat_regen_per_tick.as_ptr()
    }

    pub fn interior_unit_upgrade_points_len(&self) -> usize {
        self.units.upgrade_points.len()
    }

    pub fn interior_unit_upgrade_points_ptr(&self) -> *const u16 {
        self.units.upgrade_points.as_ptr()
    }

    pub fn interior_unit_assigned_machine_ids_len(&self) -> usize {
        self.units.assigned_machine_id.len()
    }

    pub fn interior_unit_assigned_machine_ids_ptr(&self) -> *const u32 {
        self.units.assigned_machine_id.as_ptr()
    }

    pub fn interior_unit_equipment_slots_len(&self) -> usize {
        self.units.equipment_slots.len()
    }

    pub fn interior_unit_equipment_slots_ptr(&self) -> *const u32 {
        self.units.equipment_slots.as_ptr()
    }

    pub fn interior_unit_inventory_capacity_len(&self) -> usize {
        self.units.inventory_capacity.len()
    }

    pub fn interior_unit_inventory_capacity_ptr(&self) -> *const u16 {
        self.units.inventory_capacity.as_ptr()
    }

    pub fn interior_unit_inventory_load_len(&self) -> usize {
        self.units.inventory_load.len()
    }

    pub fn interior_unit_inventory_load_ptr(&self) -> *const u16 {
        self.units.inventory_load.as_ptr()
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

    fn is_floor_local(local: u8) -> bool {
        local < FLOOR_SUBCELLS_PER_CELL as u8
    }

    fn unit_slot_by_id(&self, unit_id: u32) -> Option<usize> {
        (0..self.units.count()).find(|&slot| self.units.unit_ids[slot] == unit_id)
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
