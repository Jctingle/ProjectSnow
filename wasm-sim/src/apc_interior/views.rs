//! Raw pointer/length accessors that let JS read lattice, machine, subgrid,
//! and unit storage directly out of WASM memory without copying.

use wasm_bindgen::prelude::*;

use super::ApcInterior;

#[wasm_bindgen]
impl ApcInterior {
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

    // --- interior unit views ----------------------------------------------

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
}
