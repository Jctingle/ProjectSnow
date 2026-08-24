use super::*;
use crate::lattice::{Dims, Dir, Lattice, CELL_INTERIOR};

const ENVELOPE: Dims = Dims {
    w: 15,
    h: 10,
    d: 20,
};
const DEFAULT_HULL: Dims = Dims { w: 2, h: 1, d: 3 };
const HULL_ORIGIN: (usize, usize, usize) = (0, 0, 0);

fn hull_lattice() -> Lattice {
    let mut lattice = Lattice::new(ENVELOPE);
    lattice.fill_box(
        HULL_ORIGIN,
        (DEFAULT_HULL.w, DEFAULT_HULL.h, DEFAULT_HULL.d),
        CELL_INTERIOR,
    );
    lattice
}

/// The three cells running along Z through the default 2x1x3 hull.
fn chain_cells(lattice: &Lattice) -> [usize; 3] {
    let (ox, oy, oz) = HULL_ORIGIN;
    [
        lattice.cell_index(ox, oy, oz),
        lattice.cell_index(ox, oy, oz + 1),
        lattice.cell_index(ox, oy, oz + 2),
    ]
}

fn plain_chain(lattice: &Lattice) -> MachineGrid {
    let cells = chain_cells(lattice);
    let mut grid = MachineGrid::new(lattice.cell_count(), 1);
    grid.add_machine(cells[0], MACHINE_PLAIN, Dir::PosZ.index() as u8);
    grid.add_machine(cells[1], MACHINE_PLAIN, Dir::PosZ.index() as u8);
    grid.add_machine(cells[2], MACHINE_PLAIN, NO_OUTPUT);
    grid
}

#[test]
fn product_advances_exactly_one_cell_per_step() {
    let lattice = hull_lattice();
    let cells = chain_cells(&lattice);
    let mut grid = plain_chain(&lattice);

    grid.set_holding(grid.slot_at_cell(cells[0]).unwrap(), PRODUCT_DEFAULT);
    assert_eq!(grid.holding_at_cell(cells[0]), PRODUCT_DEFAULT);

    grid.step(&lattice);
    assert_eq!(grid.holding_at_cell(cells[0]), NO_PRODUCT);
    assert_eq!(grid.holding_at_cell(cells[1]), PRODUCT_DEFAULT);
    assert_eq!(grid.holding_at_cell(cells[2]), NO_PRODUCT);

    grid.step(&lattice);
    assert_eq!(grid.holding_at_cell(cells[1]), NO_PRODUCT);
    assert_eq!(grid.holding_at_cell(cells[2]), PRODUCT_DEFAULT);
}

/// Guards the bug double buffering exists to prevent: without it a product
/// would cross the whole chain in a single step when visited in chain order.
#[test]
fn a_product_cannot_cross_two_cells_in_one_step() {
    let lattice = hull_lattice();
    let cells = chain_cells(&lattice);
    let mut grid = plain_chain(&lattice);

    grid.set_holding(grid.slot_at_cell(cells[0]).unwrap(), PRODUCT_DEFAULT);
    grid.step(&lattice);

    assert_eq!(grid.holding_at_cell(cells[2]), NO_PRODUCT);
}

#[test]
fn behaviour_is_independent_of_insertion_order() {
    let lattice = hull_lattice();
    let cells = chain_cells(&lattice);

    let mut forward = MachineGrid::new(lattice.cell_count(), 1);
    forward.add_machine(cells[0], MACHINE_PLAIN, Dir::PosZ.index() as u8);
    forward.add_machine(cells[1], MACHINE_PLAIN, Dir::PosZ.index() as u8);
    forward.add_machine(cells[2], MACHINE_PLAIN, NO_OUTPUT);

    let mut reversed = MachineGrid::new(lattice.cell_count(), 1);
    reversed.add_machine(cells[2], MACHINE_PLAIN, NO_OUTPUT);
    reversed.add_machine(cells[1], MACHINE_PLAIN, Dir::PosZ.index() as u8);
    reversed.add_machine(cells[0], MACHINE_PLAIN, Dir::PosZ.index() as u8);

    forward.set_holding(forward.slot_at_cell(cells[0]).unwrap(), PRODUCT_DEFAULT);
    reversed.set_holding(reversed.slot_at_cell(cells[0]).unwrap(), PRODUCT_DEFAULT);

    for _ in 0..6 {
        forward.step(&lattice);
        reversed.step(&lattice);
        for cell in cells {
            assert_eq!(forward.holding_at_cell(cell), reversed.holding_at_cell(cell));
        }
    }
}

#[test]
fn a_full_receiver_blocks_its_sender() {
    let lattice = hull_lattice();
    let cells = chain_cells(&lattice);
    let mut grid = plain_chain(&lattice);

    grid.set_holding(grid.slot_at_cell(cells[1]).unwrap(), PRODUCT_DEFAULT);
    grid.set_holding(grid.slot_at_cell(cells[2]).unwrap(), PRODUCT_DEFAULT);
    grid.step(&lattice);

    assert_eq!(grid.holding_at_cell(cells[1]), PRODUCT_DEFAULT);
    assert_eq!(grid.holding_at_cell(cells[2]), PRODUCT_DEFAULT);
}

#[test]
fn a_packed_chain_drains_from_the_front() {
    let lattice = hull_lattice();
    let cells = chain_cells(&lattice);
    let mut grid = plain_chain(&lattice);

    for cell in cells {
        grid.set_holding(grid.slot_at_cell(cell).unwrap(), PRODUCT_DEFAULT);
    }
    grid.step(&lattice);

    // Nothing can move: the head has nowhere to go and every slot is occupied.
    for cell in cells {
        assert_eq!(grid.holding_at_cell(cell), PRODUCT_DEFAULT);
    }
}

#[test]
fn two_senders_into_one_receiver_resolve_deterministically() {
    let lattice = hull_lattice();
    let (ox, oy, oz) = HULL_ORIGIN;
    let left = lattice.cell_index(ox, oy, oz + 1);
    let right = lattice.cell_index(ox + 1, oy, oz + 1);
    let target = lattice.cell_index(ox, oy, oz + 2);

    let mut grid = MachineGrid::new(lattice.cell_count(), 1);
    grid.add_machine(left, MACHINE_PLAIN, Dir::PosZ.index() as u8);
    grid.add_machine(right, MACHINE_PLAIN, Dir::NegX.index() as u8);
    grid.add_machine(target, MACHINE_PLAIN, NO_OUTPUT);

    grid.set_holding(grid.slot_at_cell(left).unwrap(), PRODUCT_DEFAULT);
    grid.set_holding(grid.slot_at_cell(right).unwrap(), PRODUCT_DEFAULT);
    grid.step(&lattice);

    // `right` targets `left`, which frees up this step, so both land. Nothing
    // is duplicated or destroyed either way.
    let total: usize = [left, right, target]
        .into_iter()
        .filter(|&cell| grid.holding_at_cell(cell) != NO_PRODUCT)
        .count();
    assert_eq!(total, 2, "a product was duplicated or lost");
}

#[test]
fn contested_receiver_admits_exactly_one_product() {
    let lattice = hull_lattice();
    let (ox, oy, oz) = HULL_ORIGIN;
    let target = lattice.cell_index(ox, oy, oz + 1);
    let from_neg_z = lattice.cell_index(ox, oy, oz);
    let from_pos_x = lattice.cell_index(ox + 1, oy, oz + 1);

    let mut grid = MachineGrid::new(lattice.cell_count(), 1);
    grid.add_machine(from_neg_z, MACHINE_PLAIN, Dir::PosZ.index() as u8);
    grid.add_machine(from_pos_x, MACHINE_PLAIN, Dir::NegX.index() as u8);
    grid.add_machine(target, MACHINE_PLAIN, NO_OUTPUT);

    grid.set_holding(grid.slot_at_cell(from_neg_z).unwrap(), PRODUCT_DEFAULT);
    grid.set_holding(grid.slot_at_cell(from_pos_x).unwrap(), PRODUCT_DEFAULT);
    grid.step(&lattice);

    assert_eq!(grid.holding_at_cell(target), PRODUCT_DEFAULT);
    let still_waiting: usize = [from_neg_z, from_pos_x]
        .into_iter()
        .filter(|&cell| grid.holding_at_cell(cell) != NO_PRODUCT)
        .count();
    assert_eq!(still_waiting, 1, "loser should keep its product");
}

#[test]
fn no_output_face_holds_forever() {
    let lattice = hull_lattice();
    let cells = chain_cells(&lattice);
    let mut grid = plain_chain(&lattice);

    grid.set_holding(grid.slot_at_cell(cells[2]).unwrap(), PRODUCT_DEFAULT);
    for _ in 0..10 {
        grid.step(&lattice);
    }
    assert_eq!(grid.holding_at_cell(cells[2]), PRODUCT_DEFAULT);
}

#[test]
fn output_into_an_empty_cell_keeps_the_product() {
    let lattice = hull_lattice();
    let cells = chain_cells(&lattice);

    let mut grid = MachineGrid::new(lattice.cell_count(), 1);
    grid.add_machine(cells[0], MACHINE_PLAIN, Dir::PosZ.index() as u8);

    grid.set_holding(grid.slot_at_cell(cells[0]).unwrap(), PRODUCT_DEFAULT);
    grid.step(&lattice);

    assert_eq!(grid.holding_at_cell(cells[0]), PRODUCT_DEFAULT);
}

#[test]
fn output_across_the_envelope_boundary_keeps_the_product() {
    let lattice = Lattice::new(ENVELOPE);
    let edge = lattice.cell_index(0, 0, 0);

    let mut grid = MachineGrid::new(lattice.cell_count(), 1);
    grid.add_machine(edge, MACHINE_PLAIN, Dir::NegX.index() as u8);
    grid.set_holding(grid.slot_at_cell(edge).unwrap(), PRODUCT_DEFAULT);
    grid.step(&lattice);

    assert_eq!(grid.holding_at_cell(edge), PRODUCT_DEFAULT);
}

#[test]
fn transfer_interval_gates_stepping() {
    let lattice = hull_lattice();
    let cells = chain_cells(&lattice);
    let mut grid = MachineGrid::new(lattice.cell_count(), 30);
    grid.add_machine(cells[0], MACHINE_PLAIN, Dir::PosZ.index() as u8);
    grid.add_machine(cells[1], MACHINE_PLAIN, NO_OUTPUT);

    grid.set_holding(grid.slot_at_cell(cells[0]).unwrap(), PRODUCT_DEFAULT);

    for _ in 0..29 {
        grid.tick(&lattice);
        assert_eq!(grid.holding_at_cell(cells[0]), PRODUCT_DEFAULT);
    }
    grid.tick(&lattice);
    assert_eq!(grid.holding_at_cell(cells[1]), PRODUCT_DEFAULT);
}

#[test]
fn two_identical_runs_produce_identical_state() {
    let lattice = hull_lattice();
    let cells = chain_cells(&lattice);

    let build = || {
        let mut grid = MachineGrid::new(lattice.cell_count(), 1);
        grid.add_machine(cells[0], MACHINE_PLAIN, Dir::PosZ.index() as u8);
        grid.add_machine(cells[1], MACHINE_PLAIN, Dir::PosZ.index() as u8);
        grid.add_machine(cells[2], MACHINE_PLAIN, NO_OUTPUT);
        grid.set_holding(grid.slot_at_cell(cells[0]).unwrap(), PRODUCT_DEFAULT);
        grid
    };

    let mut first = build();
    let mut second = build();
    for _ in 0..250 {
        first.step(&lattice);
        second.step(&lattice);
    }

    assert_eq!(first.holdings(), second.holdings());
    assert_eq!(first.cells(), second.cells());
    assert_eq!(first.kinds(), second.kinds());
    assert_eq!(first.output_faces(), second.output_faces());
}

/// The demo seeds a closed loop, so a single product must return to where it
/// started after exactly one lap and never be duplicated along the way.
#[test]
fn a_closed_loop_returns_the_product_to_its_start() {
    let lattice = hull_lattice();
    let ring = [
        (0usize, 0usize, Dir::PosZ),
        (0, 1, Dir::PosZ),
        (0, 2, Dir::PosX),
        (1, 2, Dir::NegZ),
        (1, 1, Dir::NegZ),
        (1, 0, Dir::NegX),
    ];

    let mut grid = MachineGrid::new(lattice.cell_count(), 1);
    for (x, z, dir) in ring {
        grid.add_machine(lattice.cell_index(x, 0, z), MACHINE_PLAIN, dir.index() as u8);
    }

    let start = lattice.cell_index(0, 0, 0);
    grid.set_holding(grid.slot_at_cell(start).unwrap(), PRODUCT_DEFAULT);

    for step in 1..ring.len() {
        grid.step(&lattice);
        let occupied = grid.holdings().iter().filter(|&&h| h != NO_PRODUCT).count();
        assert_eq!(occupied, 1, "product duplicated or lost at step {step}");
        assert_eq!(grid.holding_at_cell(start), NO_PRODUCT, "returned early");
    }

    grid.step(&lattice);
    assert_eq!(grid.holding_at_cell(start), PRODUCT_DEFAULT, "lap did not close");
}

#[test]
#[should_panic(expected = "cell already holds a machine")]
fn two_machines_cannot_share_a_cell() {
    let lattice = hull_lattice();
    let cells = chain_cells(&lattice);
    let mut grid = MachineGrid::new(lattice.cell_count(), 1);
    grid.add_machine(cells[0], MACHINE_PLAIN, NO_OUTPUT);
    grid.add_machine(cells[0], MACHINE_PLAIN, NO_OUTPUT);
}
