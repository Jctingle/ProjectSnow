use super::*;
use crate::lattice::CELL_OUTSIDE;

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
fn a_reset_hull_can_grow_again_afterwards() {
    let mut interior = interior();
    interior.set_hull_extent(9, 6, 12);
    interior.reset_hull_extent(DEFAULT_HULL.0, DEFAULT_HULL.1, DEFAULT_HULL.2);
    interior.set_hull_extent(4, 2, 5);

    assert_eq!((interior.hull_w(), interior.hull_h(), interior.hull_d()), (4, 2, 5));
    assert_eq!(interior_cell_count(&interior), 4 * 2 * 5);
}

#[test]
fn cell_index_returns_a_sentinel_outside_the_envelope() {    let interior = interior();
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
