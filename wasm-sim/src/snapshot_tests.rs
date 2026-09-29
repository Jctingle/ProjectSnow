use serde_json::Value;

use crate::apc_interior::ApcInterior;
use crate::machines::MachineKind;
use crate::Sim;

fn sim_new_for_snapshot_tests() -> Sim {
    let mut sim = Sim::new(
        123456789,
        17.0,
        -31.0,
        0.09,
        2.22,
        72.0,
        0.45,
        1.0,
        0.039,
        2.72,
        0.22,
        0.14,
        67.5,
    );
    sim.generate_heightmap(73, 73, 144.0, 144.0);
    sim.generate_access_hillmap();
    sim.generate_slopemap();
    sim
}

fn interior_new_for_snapshot_tests() -> ApcInterior {
    ApcInterior::new(12, 8, 12, 6, 3, 6, 20)
}

#[test]
fn sim_snapshot_round_trip_matches_payload() {
    let mut sim = sim_new_for_snapshot_tests();
    sim.set_apc_target(20.0, 9.0);
    sim.tick(1.0 / 60.0);
    let _ = sim.backfill_neighbor(0, 1);
    let _ = sim.backfill_neighbor(1, 0);

    let snapshot = sim.export_snapshot_json();
    assert!(!snapshot.is_empty(), "sim snapshot export should not be empty");

    let mut candidate = sim_new_for_snapshot_tests();
    let error = candidate.import_snapshot_json(&snapshot);
    assert!(error.is_empty(), "sim snapshot import failed: {error}");

    let round_trip = candidate.export_snapshot_json();
    let original_json: Value = serde_json::from_str(&snapshot).expect("original snapshot JSON");
    let round_trip_json: Value =
        serde_json::from_str(&round_trip).expect("round-trip snapshot JSON");
    assert_eq!(original_json, round_trip_json, "sim snapshot should round-trip exactly");
}

#[test]
fn sim_snapshot_rejects_invalid_format_version() {
    let sim = sim_new_for_snapshot_tests();
    let snapshot = sim.export_snapshot_json();
    let mut json: Value = serde_json::from_str(&snapshot).expect("snapshot JSON");
    json["format_version"] = Value::from(999u64);
    let corrupted = serde_json::to_string(&json).expect("encode corrupted JSON");

    let mut candidate = sim_new_for_snapshot_tests();
    let error = candidate.import_snapshot_json(&corrupted);
    assert!(
        !error.is_empty(),
        "invalid format version should return a non-empty error"
    );
}

#[test]
fn interior_snapshot_round_trip_matches_payload() {
    let mut interior = interior_new_for_snapshot_tests();
    let cell = interior.cell_index(1, 0, 1);
    assert!(cell != usize::MAX, "test setup cell should be valid");
    let machine_id = interior.place_machine_at_subcell(cell, 0, MachineKind::Alpha);
    assert!(machine_id >= 0, "machine placement should succeed");
    assert!(interior.place_product_at_cell(cell), "machine product placement should succeed");

    let unit_id = interior.spawn_random_interior_unit(crate::apc_interior::UnitSpecialization::Engineer);
    assert!(unit_id >= 0, "unit spawn should succeed");

    let snapshot = interior.export_snapshot_json();
    assert!(!snapshot.is_empty(), "interior snapshot export should not be empty");

    let mut candidate = interior_new_for_snapshot_tests();
    let error = candidate.import_snapshot_json(&snapshot);
    assert!(error.is_empty(), "interior snapshot import failed: {error}");

    let round_trip = candidate.export_snapshot_json();
    let original_json: Value = serde_json::from_str(&snapshot).expect("original snapshot JSON");
    let round_trip_json: Value =
        serde_json::from_str(&round_trip).expect("round-trip snapshot JSON");
    assert_eq!(
        original_json, round_trip_json,
        "interior snapshot should round-trip exactly"
    );
}
