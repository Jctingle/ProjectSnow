use crate::apc_interior::ApcInterior;
use crate::lattice::Dir;
use crate::machines::MachineKind;

#[test]
fn probe_demo_chain_sequence() {
    let mut interior = ApcInterior::new(15, 10, 20, 2, 1, 3, 1);
    let cells = [
        interior.cell_index(0, 0, 0),
        interior.cell_index(0, 0, 1),
        interior.cell_index(0, 0, 2),
    ];
    interior.add_machine(cells[0], MachineKind::Source, Dir::PosZ);
    interior.add_machine(cells[1], MachineKind::Plain, Dir::PosZ);
    interior.add_machine_without_output(cells[2], MachineKind::Sink);

    for step in 0..8 {
        interior.step();
        let row: Vec<u8> = cells
            .iter()
            .map(|&c| interior.debug_holding_at_cell(c))
            .collect();
        println!("step {step}: source={} plain={} sink={}", row[0], row[1], row[2]);
    }
}
