//! Versioned JSON save/load of the full interior state.

use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

use super::units::{
    InteriorUnitDomain, InteriorUnitMode, UnitSpecialization, EMPTY_MACHINE_ASSIGNMENT,
    EMPTY_UNIT_CELL, EMPTY_UNIT_SUBCELL, EQUIPMENT_SLOT_COUNT,
};
use super::{ApcInterior, HULL_ORIGIN};
use crate::lattice::{CELL_INTERIOR, CELL_OUTSIDE};
use crate::machines::MachineGrid;
use crate::subgrid::Subgrid;

const INTERIOR_SNAPSHOT_FORMAT_VERSION: u32 = 1;
const INTERIOR_SNAPSHOT_CONTENT_VERSION: u32 = 1;
const MAX_SNAPSHOT_MACHINES: usize = 4096;

#[derive(Serialize, Deserialize)]
struct InteriorSnapshotEnvelope {
    format_version: u32,
    content_version: u32,
    payload: InteriorSnapshotPayload,
}

#[derive(Serialize, Deserialize)]
struct InteriorSnapshotPayload {
    envelope_w: usize,
    envelope_h: usize,
    envelope_d: usize,
    hull_w: usize,
    hull_h: usize,
    hull_d: usize,
    transfer_interval: u32,
    transfer_tick_counter: u32,
    next_machine_id: u32,
    machines: Vec<InteriorMachineRecord>,
    next_unit_id: u32,
    unit_rng_state: u32,
    wander_decision_tick: u32,
    units: Vec<InteriorUnitRecord>,
}

#[derive(Serialize, Deserialize)]
struct InteriorMachineRecord {
    id: u32,
    parent_cell: u32,
    footprint: u8,
    kind: u8,
    output_face: u8,
    holding: u8,
}

#[derive(Serialize, Deserialize)]
struct InteriorUnitRecord {
    schema_version: u16,
    id: u32,
    cell: u32,
    subcell: u8,
    mode: u8,
    specialization: u8,
    health_current: u16,
    health_max: u16,
    combat_skill: u16,
    machine_operation_skill: u16,
    vehicle_operation_skill: u16,
    heat_capacity: u16,
    heat_regen_per_tick: u16,
    upgrade_points: u16,
    assigned_machine_id: u32,
    equipment_slots: [u32; EQUIPMENT_SLOT_COUNT],
    inventory_capacity: u16,
    inventory_load: u16,
}

#[wasm_bindgen]
impl ApcInterior {
    pub fn export_snapshot_json(&self) -> String {
        let mut machines = Vec::with_capacity(self.machines.machine_count());
        for slot in 0..self.machines.machine_count() {
            machines.push(InteriorMachineRecord {
                id: self.machines.id_of(slot),
                parent_cell: self.machines.cell_of(slot) as u32,
                footprint: self.machines.footprint_of(slot),
                kind: self.machines.kind_of(slot),
                output_face: self.machines.output_face_of(slot),
                holding: self.machines.holding_of(slot),
            });
        }

        let mut units = Vec::with_capacity(self.units.count());
        for slot in 0..self.units.count() {
            let equipment_base = slot * EQUIPMENT_SLOT_COUNT;
            units.push(InteriorUnitRecord {
                schema_version: self.units.schema_versions[slot],
                id: self.units.unit_ids[slot],
                cell: self.units.cells[slot],
                subcell: self.units.subcells[slot],
                mode: self.units.modes[slot],
                specialization: self.units.specializations[slot],
                health_current: self.units.health_current[slot],
                health_max: self.units.health_max[slot],
                combat_skill: self.units.combat_skill[slot],
                machine_operation_skill: self.units.machine_operation_skill[slot],
                vehicle_operation_skill: self.units.vehicle_operation_skill[slot],
                heat_capacity: self.units.heat_capacity[slot],
                heat_regen_per_tick: self.units.heat_regen_per_tick[slot],
                upgrade_points: self.units.upgrade_points[slot],
                assigned_machine_id: self.units.assigned_machine_id[slot],
                equipment_slots: [
                    self.units.equipment_slots[equipment_base],
                    self.units.equipment_slots[equipment_base + 1],
                    self.units.equipment_slots[equipment_base + 2],
                    self.units.equipment_slots[equipment_base + 3],
                ],
                inventory_capacity: self.units.inventory_capacity[slot],
                inventory_load: self.units.inventory_load[slot],
            });
        }

        let dims = self.lattice.dims();
        let payload = InteriorSnapshotPayload {
            envelope_w: dims.w,
            envelope_h: dims.h,
            envelope_d: dims.d,
            hull_w: self.hull_w,
            hull_h: self.hull_h,
            hull_d: self.hull_d,
            transfer_interval: self.machines.transfer_interval(),
            transfer_tick_counter: self.machines.tick_counter(),
            next_machine_id: self.machines.next_machine_id(),
            machines,
            next_unit_id: self.units.next_unit_id,
            unit_rng_state: self.unit_rng_state,
            wander_decision_tick: self.wander_decision_tick,
            units,
        };

        let envelope = InteriorSnapshotEnvelope {
            format_version: INTERIOR_SNAPSHOT_FORMAT_VERSION,
            content_version: INTERIOR_SNAPSHOT_CONTENT_VERSION,
            payload,
        };

        serde_json::to_string(&envelope).unwrap_or_else(|_| String::from(""))
    }

    /// Returns empty string on success, otherwise a human-readable error.
    pub fn import_snapshot_json(&mut self, snapshot_json: &str) -> String {
        match self.restore_from_snapshot_json(snapshot_json) {
            Ok(()) => String::new(),
            Err(message) => message,
        }
    }
}

impl ApcInterior {
    fn restore_from_snapshot_json(&mut self, snapshot_json: &str) -> Result<(), String> {
        let envelope: InteriorSnapshotEnvelope =
            serde_json::from_str(snapshot_json).map_err(|_| String::from("snapshot decode failed"))?;

        if envelope.format_version != INTERIOR_SNAPSHOT_FORMAT_VERSION {
            return Err(String::from("unsupported interior snapshot format version"));
        }
        if envelope.content_version != INTERIOR_SNAPSHOT_CONTENT_VERSION {
            return Err(String::from("unsupported interior snapshot content version"));
        }

        let payload = envelope.payload;
        let dims = self.lattice.dims();
        if payload.envelope_w != dims.w
            || payload.envelope_h != dims.h
            || payload.envelope_d != dims.d
        {
            return Err(String::from("interior envelope mismatch"));
        }
        if payload.hull_w == 0
            || payload.hull_h == 0
            || payload.hull_d == 0
            || payload.hull_w > dims.w
            || payload.hull_h > dims.h
            || payload.hull_d > dims.d
        {
            return Err(String::from("interior hull dimensions invalid"));
        }
        if payload.machines.len() > MAX_SNAPSHOT_MACHINES {
            return Err(String::from("snapshot machine record count exceeds limit"));
        }

        let machine_ids: Vec<u32> = payload.machines.iter().map(|m| m.id).collect();
        let machine_parent_cells: Vec<u32> = payload.machines.iter().map(|m| m.parent_cell).collect();
        let machine_footprints: Vec<u8> = payload.machines.iter().map(|m| m.footprint).collect();
        let machine_kinds: Vec<u8> = payload.machines.iter().map(|m| m.kind).collect();
        let machine_output_faces: Vec<u8> = payload.machines.iter().map(|m| m.output_face).collect();
        let machine_holding: Vec<u8> = payload.machines.iter().map(|m| m.holding).collect();

        let mut candidate_machines = MachineGrid::new(self.lattice.cell_count(), payload.transfer_interval.max(1));
        candidate_machines
            .restore_records(
                &machine_ids,
                &machine_parent_cells,
                &machine_footprints,
                &machine_kinds,
                &machine_output_faces,
                &machine_holding,
                payload.next_machine_id,
                payload.transfer_interval,
                payload.transfer_tick_counter,
                self.lattice.cell_count(),
            )
            .map_err(String::from)?;

        let mut candidate_subgrid = Subgrid::new(self.lattice.cell_count());
        for slot in 0..candidate_machines.machine_count() {
            let ok = candidate_subgrid.reserve_machine(
                candidate_machines.cell_of(slot),
                candidate_machines.footprint_of(slot),
                candidate_machines.id_of(slot),
            );
            if !ok {
                return Err(String::from("machine footprint occupancy conflict"));
            }
        }

        let mut candidate_units = InteriorUnitDomain::new(self.lattice.cell_count());
        if payload.units.len() > candidate_units.capacity {
            return Err(String::from("unit record count exceeds capacity"));
        }

        for (slot, unit) in payload.units.iter().enumerate() {
            if unit.mode > InteriorUnitMode::Incapacitated as u8 {
                return Err(String::from("unit mode out of range"));
            }
            if unit.specialization > UnitSpecialization::Scout as u8 {
                return Err(String::from("unit specialization out of range"));
            }
            if unit.inventory_load > unit.inventory_capacity {
                return Err(String::from("unit inventory load exceeds capacity"));
            }

            candidate_units.schema_versions[slot] = unit.schema_version;
            candidate_units.unit_ids[slot] = unit.id;
            candidate_units.cells[slot] = unit.cell;
            candidate_units.subcells[slot] = unit.subcell;
            candidate_units.modes[slot] = unit.mode;
            candidate_units.specializations[slot] = unit.specialization;
            candidate_units.health_current[slot] = unit.health_current;
            candidate_units.health_max[slot] = unit.health_max;
            candidate_units.combat_skill[slot] = unit.combat_skill;
            candidate_units.machine_operation_skill[slot] = unit.machine_operation_skill;
            candidate_units.vehicle_operation_skill[slot] = unit.vehicle_operation_skill;
            candidate_units.heat_capacity[slot] = unit.heat_capacity;
            candidate_units.heat_regen_per_tick[slot] = unit.heat_regen_per_tick;
            candidate_units.upgrade_points[slot] = unit.upgrade_points;
            candidate_units.assigned_machine_id[slot] = unit.assigned_machine_id;
            candidate_units.inventory_capacity[slot] = unit.inventory_capacity;
            candidate_units.inventory_load[slot] = unit.inventory_load;

            let equipment_base = slot * EQUIPMENT_SLOT_COUNT;
            candidate_units.equipment_slots[equipment_base..equipment_base + EQUIPMENT_SLOT_COUNT]
                .copy_from_slice(&unit.equipment_slots);
        }
        candidate_units.count = payload.units.len();
        candidate_units.next_unit_id = payload.next_unit_id;

        let mut sorted_unit_ids = payload.units.iter().map(|u| u.id).collect::<Vec<u32>>();
        sorted_unit_ids.sort_unstable();
        sorted_unit_ids.dedup();
        if sorted_unit_ids.len() != payload.units.len() {
            return Err(String::from("duplicate unit id"));
        }
        if let Some(max_unit_id) = payload.units.iter().map(|u| u.id).max() {
            if payload.next_unit_id <= max_unit_id {
                return Err(String::from("next unit id must exceed existing unit ids"));
            }
        }

        let machine_id_set = candidate_machines
            .ids()
            .iter()
            .copied()
            .collect::<std::collections::BTreeSet<u32>>();

        for slot in 0..candidate_units.count {
            let cell = candidate_units.cells[slot];
            let local = candidate_units.subcells[slot];
            if (cell == EMPTY_UNIT_CELL) != (local == EMPTY_UNIT_SUBCELL) {
                return Err(String::from("unit placement sentinel mismatch"));
            }

            let assigned = candidate_units.assigned_machine_id[slot];
            if assigned != EMPTY_MACHINE_ASSIGNMENT && !machine_id_set.contains(&assigned) {
                return Err(String::from("unit assignment references missing machine"));
            }

            if cell == EMPTY_UNIT_CELL {
                continue;
            }

            let cell_usize = cell as usize;
            if cell_usize >= self.lattice.cell_count() {
                return Err(String::from("unit cell out of bounds"));
            }
            if !Self::is_floor_local(local) {
                return Err(String::from("unit subcell out of floor range"));
            }
            if cell_usize % dims.w >= payload.hull_w
                || (cell_usize / (dims.w * dims.d)) >= payload.hull_h
                || ((cell_usize % (dims.w * dims.d)) / dims.w) >= payload.hull_d
            {
                return Err(String::from("unit placed outside restored hull"));
            }
            if !candidate_subgrid.reserve_unit(cell_usize, local as usize, candidate_units.unit_ids[slot]) {
                return Err(String::from("unit occupancy conflict"));
            }
        }

        self.hull_w = payload.hull_w;
        self.hull_h = payload.hull_h;
        self.hull_d = payload.hull_d;
        self.lattice.fill_all(CELL_OUTSIDE);
        self.lattice
            .fill_box(HULL_ORIGIN, (self.hull_w, self.hull_h, self.hull_d), CELL_INTERIOR);
        self.machines = candidate_machines;
        self.subgrid = candidate_subgrid;
        self.units = candidate_units;
        self.unit_rng_state = if payload.unit_rng_state == 0 {
            1
        } else {
            payload.unit_rng_state
        };
        self.wander_decision_tick = payload.wander_decision_tick;

        Ok(())
    }
}
