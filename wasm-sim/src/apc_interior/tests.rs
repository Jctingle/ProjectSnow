use super::*;
use crate::lattice::CELL_OUTSIDE;
use crate::subgrid::OCCUPANT_MACHINE;
use std::slice;

const ENVELOPE: (usize, usize, usize) = (15, 10, 20);
const DEFAULT_HULL: (usize, usize, usize) = (2, 1, 3);

fn interior() -> ApcInterior {
    ApcInterior::new(
        ENVELOPE.0,
        ENVELOPE.1,
        ENVELOPE.2,
        DEFAULT_HULL.0,
        DEFAULT_HULL.1,
        DEFAULT_HULL.2,
        1,
    )
}

fn interior_cell_count(interior: &ApcInterior) -> usize {
    interior
        .lattice
        .cell_kind_slice()
        .iter()
        .filter(|&&kind| kind == CELL_INTERIOR)
        .count()
}

#[test]
fn construction_allocates_the_envelope_and_seeds_the_default_hull() {
    let interior = interior();

    assert_eq!(interior.cell_count(), 15 * 10 * 20);
    assert_eq!(interior.envelope_w(), 15);
    assert_eq!(interior.envelope_h(), 10);
    assert_eq!(interior.envelope_d(), 20);
    assert_eq!((interior.hull_w(), interior.hull_h(), interior.hull_d()), DEFAULT_HULL);
    assert_eq!(interior_cell_count(&interior), 2 * 1 * 3);
}

#[test]
fn the_hull_anchors_at_the_envelope_origin() {
    let interior = interior();
    assert_eq!(
        (
            interior.hull_origin_x(),
            interior.hull_origin_y(),
            interior.hull_origin_z()
        ),
        (0, 0, 0)
    );
    assert!(interior.is_cell_in_hull(0, 0, 0));
    assert!(interior.is_cell_in_hull(1, 0, 2));
    assert!(!interior.is_cell_in_hull(2, 0, 0));
}

#[test]
fn expansion_is_additive_and_never_shrinks() {
    let mut interior = interior();

    interior.set_hull_extent(4, 2, 5);
    assert_eq!((interior.hull_w(), interior.hull_h(), interior.hull_d()), (4, 2, 5));
    assert_eq!(interior_cell_count(&interior), 4 * 2 * 5);

    // A smaller request leaves every axis untouched.
    interior.set_hull_extent(1, 1, 1);
    assert_eq!((interior.hull_w(), interior.hull_h(), interior.hull_d()), (4, 2, 5));
    assert_eq!(interior_cell_count(&interior), 4 * 2 * 5);
}

#[test]
fn expansion_clamps_to_the_envelope_instead_of_trapping() {
    let mut interior = interior();
    interior.set_hull_extent(999, 999, 999);

    assert_eq!(
        (interior.hull_w(), interior.hull_h(), interior.hull_d()),
        ENVELOPE
    );
    assert_eq!(interior_cell_count(&interior), 15 * 10 * 20);
}

/// The property the fixed envelope exists to provide: a cell index means the
/// same thing before and after the hull grows.
#[test]
fn growth_preserves_existing_cell_indices_and_machines() {
    let mut interior = interior();
    let cell = interior.cell_index(1, 0, 2);
    assert!(interior.add_machine_without_output(cell, MachineKind::Plain));
    assert!(interior.place_product_at_cell(cell));

    interior.set_hull_extent(9, 6, 12);

    assert_eq!(interior.cell_index(1, 0, 2), cell);
    assert_eq!(interior.machine_count(), 1);
    assert_eq!(interior.machines.holding_at_cell(cell), crate::machines::PRODUCT_DEFAULT);
}

#[test]
fn reset_shrinks_the_hull_and_clears_orphaned_cells() {
    let mut interior = interior();
    interior.set_hull_extent(9, 6, 12);
    assert_eq!(interior_cell_count(&interior), 9 * 6 * 12);

    interior.reset_hull_extent(DEFAULT_HULL.0, DEFAULT_HULL.1, DEFAULT_HULL.2);

    assert_eq!(
        (interior.hull_w(), interior.hull_h(), interior.hull_d()),
        DEFAULT_HULL
    );
    assert_eq!(interior_cell_count(&interior), 2 * 1 * 3);
    let orphan = interior.cell_index(5, 3, 7);
    assert_eq!(interior.lattice.cell_kind(orphan), CELL_OUTSIDE);
}

#[test]
fn reset_keeps_machines_inside_the_new_hull_and_drops_the_rest() {
    let mut interior = interior();
    interior.set_hull_extent(9, 6, 12);

    let kept = interior.cell_index(0, 0, 1);
    let dropped = interior.cell_index(5, 3, 7);
    assert!(interior.add_machine_without_output(kept, MachineKind::Plain));
    assert!(interior.add_machine_without_output(dropped, MachineKind::Plain));
    assert_eq!(interior.machine_count(), 2);

    interior.reset_hull_extent(DEFAULT_HULL.0, DEFAULT_HULL.1, DEFAULT_HULL.2);

    assert_eq!(interior.machine_count(), 1);
    assert!(interior.machines.slot_at_cell(kept).is_some());
    assert!(interior.machines.slot_at_cell(dropped).is_none());
}

#[test]
fn reset_rebuilds_subgrid_so_dropped_cells_are_unoccupied() {
    let mut interior = interior();
    interior.set_hull_extent(9, 6, 12);

    let kept = interior.cell_index(0, 0, 1);
    let dropped = interior.cell_index(5, 3, 7);
    assert!(interior.add_machine_without_output(kept, MachineKind::Plain));
    assert!(interior.add_machine_without_output(dropped, MachineKind::Plain));

    interior.reset_hull_extent(DEFAULT_HULL.0, DEFAULT_HULL.1, DEFAULT_HULL.2);

    let kept_occupant = interior.subgrid.occupant(kept, 0);
    assert!(matches!(kept_occupant, Some((OCCUPANT_MACHINE, _))));
    assert_eq!(interior.subgrid.occupant(dropped, 0), None);
}

#[test]
fn a_reset_hull_can_grow_again_afterwards() {
    let mut interior = interior();
    interior.set_hull_extent(9, 6, 12);
    interior.reset_hull_extent(DEFAULT_HULL.0, DEFAULT_HULL.1, DEFAULT_HULL.2);
    interior.set_hull_extent(4, 2, 5);

    assert_eq!((interior.hull_w(), interior.hull_h(), interior.hull_d()), (4, 2, 5));
    assert_eq!(interior_cell_count(&interior), 4 * 2 * 5);
}

#[test]
fn clearing_machines_also_clears_subgrid_occupancy() {
    let mut interior = interior();
    let cell = interior.cell_index(0, 0, 0);
    assert!(interior.add_machine_without_output(cell, MachineKind::Plain));
    assert!(matches!(
        interior.subgrid.occupant(cell, 0),
        Some((OCCUPANT_MACHINE, _))
    ));

    interior.clear_machines();

    assert_eq!(interior.machine_count(), 0);
    assert_eq!(interior.subgrid.occupant(cell, 0), None);
}

#[test]
fn cell_index_returns_a_sentinel_outside_the_envelope() {
    let interior = interior();
    assert_eq!(interior.cell_index(15, 0, 0), usize::MAX);
    assert_eq!(interior.cell_index(0, 10, 0), usize::MAX);
    assert_eq!(interior.cell_index(0, 0, 20), usize::MAX);
    assert_ne!(interior.cell_index(14, 9, 19), usize::MAX);
}

#[test]
fn add_machine_reports_failure_rather_than_trapping() {
    let mut interior = interior();
    let cell = interior.cell_index(0, 0, 0);

    assert!(interior.add_machine(cell, MachineKind::Plain, Dir::PosZ));
    assert!(!interior.add_machine(cell, MachineKind::Plain, Dir::PosZ));
    assert!(!interior.add_machine(usize::MAX, MachineKind::Plain, Dir::PosZ));
    assert_eq!(interior.machine_count(), 1);
}

#[test]
fn placing_a_product_reports_failure_for_a_cell_without_a_machine() {
    let mut interior = interior();
    let empty = interior.cell_index(1, 0, 1);

    assert!(!interior.place_product_at_cell(empty));
    assert!(!interior.place_product_at_cell(usize::MAX));
}

#[test]
fn a_zero_transfer_interval_is_coerced_rather_than_trapping() {
    let mut interior = ApcInterior::new(4, 2, 4, 1, 1, 3, 0);
    let source = interior.cell_index(0, 0, 0);
    let target = interior.cell_index(0, 0, 1);
    interior.add_machine(source, MachineKind::Plain, Dir::PosZ);
    interior.add_machine_without_output(target, MachineKind::Plain);
    interior.place_product_at_cell(source);

    interior.tick();
    assert_eq!(
        interior.machines.holding_at_cell(target),
        crate::machines::PRODUCT_DEFAULT
    );

    interior.set_transfer_interval(0);
}

#[test]
fn ticking_advances_a_chain_one_cell_at_a_time() {
    let mut interior = interior();
    let cells = [
        interior.cell_index(0, 0, 0),
        interior.cell_index(0, 0, 1),
        interior.cell_index(0, 0, 2),
    ];
    interior.add_machine(cells[0], MachineKind::Plain, Dir::PosZ);
    interior.add_machine(cells[1], MachineKind::Plain, Dir::PosZ);
    interior.add_machine_without_output(cells[2], MachineKind::Plain);
    interior.place_product_at_cell(cells[0]);

    interior.step();
    assert_ne!(interior.machines.holding_at_cell(cells[1]), 0);
    assert_eq!(interior.machines.holding_at_cell(cells[2]), 0);

    interior.step();
    assert_ne!(interior.machines.holding_at_cell(cells[2]), 0);
    assert_eq!(interior.machines.holding_at_cell(cells[0]), 0);
    assert_eq!(interior.machines.holding_at_cell(cells[1]), 0);
}

#[test]
fn a_fresh_envelope_outside_the_hull_stays_outside() {
    let interior = interior();
    let far = interior.cell_index(14, 9, 19);
    assert_eq!(interior.lattice.cell_kind(far), CELL_OUTSIDE);
}

#[test]
fn interior_unit_domain_capacity_tracks_floor_subcells() {
    let interior = interior();
    assert_eq!(interior.interior_unit_count(), 0);
    assert_eq!(interior.interior_unit_capacity(), interior.cell_count() * 4);
    assert_eq!(
        interior.interior_unit_ids_len(),
        interior.interior_unit_capacity()
    );
    assert_eq!(
        interior.interior_unit_equipment_slots_len(),
        interior.interior_unit_capacity() * 4
    );
}

#[test]
fn registering_profiles_assigns_stable_ids_and_defaults() {
    let mut interior = interior();

    assert_eq!(
        interior.register_interior_unit_profile(UnitSpecialization::Pilot),
        0
    );
    assert_eq!(
        interior.register_interior_unit_profile(UnitSpecialization::Medic),
        1
    );
    assert_eq!(interior.interior_unit_count(), 2);

    let ids = unsafe {
        slice::from_raw_parts(
            interior.interior_unit_ids_ptr(),
            interior.interior_unit_ids_len(),
        )
    };
    let modes = unsafe {
        slice::from_raw_parts(
            interior.interior_unit_modes_ptr(),
            interior.interior_unit_modes_len(),
        )
    };
    let specializations = unsafe {
        slice::from_raw_parts(
            interior.interior_unit_specializations_ptr(),
            interior.interior_unit_specializations_len(),
        )
    };
    let hp = unsafe {
        slice::from_raw_parts(
            interior.interior_unit_health_current_ptr(),
            interior.interior_unit_health_current_len(),
        )
    };
    let heat = unsafe {
        slice::from_raw_parts(
            interior.interior_unit_heat_capacity_ptr(),
            interior.interior_unit_heat_capacity_len(),
        )
    };
    let vehicle = unsafe {
        slice::from_raw_parts(
            interior.interior_unit_vehicle_operation_skill_ptr(),
            interior.interior_unit_vehicle_operation_skill_len(),
        )
    };
    let machine = unsafe {
        slice::from_raw_parts(
            interior.interior_unit_machine_operation_skill_ptr(),
            interior.interior_unit_machine_operation_skill_len(),
        )
    };
    let upgrades = unsafe {
        slice::from_raw_parts(
            interior.interior_unit_upgrade_points_ptr(),
            interior.interior_unit_upgrade_points_len(),
        )
    };

    assert_eq!(ids[0], 0);
    assert_eq!(ids[1], 1);
    assert_eq!(modes[0], InteriorUnitMode::BoardedIdle as u8);
    assert_eq!(modes[1], InteriorUnitMode::BoardedIdle as u8);
    assert_eq!(specializations[0], UnitSpecialization::Pilot as u8);
    assert_eq!(specializations[1], UnitSpecialization::Medic as u8);

    assert_eq!(hp[0], 100);
    assert_eq!(hp[1], 100);
    assert_eq!(heat[0], 100);
    assert_eq!(heat[1], 100);
    assert_eq!(vehicle[0], 50);
    assert_eq!(vehicle[1], 50);
    assert_eq!(machine[0], 50);
    assert_eq!(machine[1], 50);
    assert_eq!(upgrades[0], 0);
    assert_eq!(upgrades[1], 0);
}

#[test]
fn clearing_profiles_resets_domain_back_to_empty() {
    let mut interior = interior();
    assert_eq!(
        interior.register_interior_unit_profile(UnitSpecialization::Engineer),
        0
    );
    assert_eq!(interior.interior_unit_count(), 1);

    interior.clear_interior_unit_profiles();

    assert_eq!(interior.interior_unit_count(), 0);
    let ids = unsafe {
        slice::from_raw_parts(
            interior.interior_unit_ids_ptr(),
            interior.interior_unit_ids_len(),
        )
    };
    assert_eq!(ids[0], u32::MAX);
    assert_eq!(
        interior.register_interior_unit_profile(UnitSpecialization::Generalist),
        0
    );
}

fn unit_at(interior: &ApcInterior, unit_id: u32) -> Option<(usize, u8)> {
    let ids = unsafe {
        slice::from_raw_parts(
            interior.interior_unit_ids_ptr(),
            interior.interior_unit_ids_len(),
        )
    };
    let cells = unsafe {
        slice::from_raw_parts(
            interior.interior_unit_cells_ptr(),
            interior.interior_unit_cells_len(),
        )
    };
    let locals = unsafe {
        slice::from_raw_parts(
            interior.interior_unit_subcells_ptr(),
            interior.interior_unit_subcells_len(),
        )
    };

    for i in 0..interior.interior_unit_count() {
        if ids[i] == unit_id {
            if cells[i] == u32::MAX || locals[i] == u8::MAX {
                return None;
            }
            return Some((cells[i] as usize, locals[i]));
        }
    }
    None
}

#[test]
fn move_within_same_cell_floor_subgrid_succeeds() {
    let mut interior = interior();
    let unit_id = interior.register_interior_unit_profile(UnitSpecialization::Generalist) as u32;
    let cell = interior.cell_index(0, 0, 0);
    assert!(interior.place_interior_unit(unit_id, cell, 0));

    let result = interior.try_move_interior_unit(unit_id, InteriorMoveAction::PosX);
    assert_eq!(result as u8, InteriorMoveResult::Ok as u8);
    assert_eq!(unit_at(&interior, unit_id), Some((cell, 1)));
}

#[test]
fn move_crosses_into_adjacent_cell_when_local_step_overflows() {
    let mut interior = interior();
    interior.set_hull_extent(3, 1, 3);
    let unit_id = interior.register_interior_unit_profile(UnitSpecialization::Generalist) as u32;
    let source_cell = interior.cell_index(0, 0, 0);
    let target_cell = interior.cell_index(1, 0, 0);
    assert!(interior.place_interior_unit(unit_id, source_cell, 1));

    let result = interior.try_move_interior_unit(unit_id, InteriorMoveAction::PosX);
    assert_eq!(result as u8, InteriorMoveResult::Ok as u8);
    assert_eq!(unit_at(&interior, unit_id), Some((target_cell, 0)));
}

#[test]
fn moving_into_machine_occupied_target_is_blocked() {
    let mut interior = interior();
    interior.set_hull_extent(2, 1, 1);
    let unit_id = interior.register_interior_unit_profile(UnitSpecialization::Generalist) as u32;
    let source_cell = interior.cell_index(0, 0, 0);
    let machine_cell = interior.cell_index(1, 0, 0);
    assert!(interior.place_interior_unit(unit_id, source_cell, 1));
    assert!(interior.add_machine_without_output(machine_cell, MachineKind::Plain));

    let result = interior.try_move_interior_unit(unit_id, InteriorMoveAction::PosX);
    assert_eq!(result as u8, InteriorMoveResult::BlockedByMachine as u8);
    assert_eq!(unit_at(&interior, unit_id), Some((source_cell, 1)));
}

#[test]
fn moving_into_unit_occupied_target_is_blocked() {
    let mut interior = interior();
    let a = interior.register_interior_unit_profile(UnitSpecialization::Generalist) as u32;
    let b = interior.register_interior_unit_profile(UnitSpecialization::Medic) as u32;
    let cell = interior.cell_index(0, 0, 0);
    assert!(interior.place_interior_unit(a, cell, 0));
    assert!(interior.place_interior_unit(b, cell, 1));

    let result = interior.try_move_interior_unit(a, InteriorMoveAction::PosX);
    assert_eq!(result as u8, InteriorMoveResult::BlockedByUnit as u8);
    assert_eq!(unit_at(&interior, a), Some((cell, 0)));
    assert_eq!(unit_at(&interior, b), Some((cell, 1)));
}

#[test]
fn top_layer_source_subcell_is_rejected() {
    let mut interior = interior();
    let unit_id = interior.register_interior_unit_profile(UnitSpecialization::Generalist) as u32;
    let cell = interior.cell_index(0, 0, 0);
    assert!(interior.place_interior_unit(unit_id, cell, 0));

    let result = interior.try_move_interior_unit_from(
        unit_id,
        cell,
        4,
        InteriorMoveAction::Stay,
    );
    assert_eq!(result as u8, InteriorMoveResult::BlockedInvalidSourceSubcell as u8);
    assert_eq!(unit_at(&interior, unit_id), Some((cell, 0)));
}

#[test]
fn out_of_bounds_neighbor_move_is_rejected_without_mutation() {
    let mut interior = interior();
    let unit_id = interior.register_interior_unit_profile(UnitSpecialization::Generalist) as u32;
    let cell = interior.cell_index(0, 0, 0);
    assert!(interior.place_interior_unit(unit_id, cell, 0));

    let result = interior.try_move_interior_unit(unit_id, InteriorMoveAction::NegX);
    assert_eq!(result as u8, InteriorMoveResult::BlockedOutOfBounds as u8);
    assert_eq!(unit_at(&interior, unit_id), Some((cell, 0)));
}

#[test]
fn mode_gate_blocks_interior_movement() {
    let mut interior = interior();
    let unit_id = interior.register_interior_unit_profile(UnitSpecialization::Generalist) as u32;
    let cell = interior.cell_index(0, 0, 0);
    assert!(interior.place_interior_unit(unit_id, cell, 0));

    assert!(interior.set_interior_unit_mode(unit_id, InteriorUnitMode::Deployed));

    let result = interior.try_move_interior_unit(unit_id, InteriorMoveAction::PosX);
    assert_eq!(result as u8, InteriorMoveResult::BlockedMode as u8);
    assert_eq!(unit_at(&interior, unit_id), Some((cell, 0)));
}

#[test]
fn resolve_target_packs_success_payload() {
    let interior = interior();
    let cell = interior.cell_index(0, 0, 0);
    let packed = interior.resolve_interior_unit_target(cell, 0, InteriorMoveAction::PosX);
    let target_cell = (packed & 0xffff_ffff) as u32;
    let target_local = ((packed >> 32) & 0xff) as u8;
    let code = ((packed >> 40) & 0xff) as u8;

    assert_eq!(target_cell as usize, cell);
    assert_eq!(target_local, 1);
    assert_eq!(code, InteriorMoveResult::Ok as u8);
}
