use super::*;
use crate::rng::cell_seed;
use crate::shard_ring::{slot_index, NEIGHBOR_OFFSETS};
use std::collections::BTreeMap;
use std::collections::BTreeSet;

const TEST_HEIGHTMAP_W: usize = 145;
const TEST_HEIGHTMAP_H: usize = 145;
const TEST_HEIGHTMAP_LEN: usize = TEST_HEIGHTMAP_W * TEST_HEIGHTMAP_H;

fn build_sim(max_units: usize) -> Sim {
    let mut sim = Sim::new(
        max_units, 4242, 17.0, 29.0, 0.028, 5.2, 72.0, 72.0, 1.2, 2.1, 0.011, 0.2, 0.95, 2026,
    );
    sim.generate_heightmap(TEST_HEIGHTMAP_W, TEST_HEIGHTMAP_H, 144.0, 144.0);
    sim.generate_slopemap();
    sim
}

fn tick_until<F: Fn(&Sim) -> bool>(sim: &mut Sim, max_ticks: usize, pred: F) -> bool {
    for _ in 0..max_ticks {
        sim.tick(1.0 / 60.0);
        if pred(sim) {
            return true;
        }
    }
    false
}

fn first_unit_xz(sim: &Sim) -> (f32, f32) {
    let len = sim.count() * 3;
    let data = unsafe { std::slice::from_raw_parts(sim.positions_ptr(), len) };
    (data[0], data[2])
}

fn all_neighbors_ready(sim: &Sim) -> bool {
    NEIGHBOR_OFFSETS
        .iter()
        .all(|&(dr, dc)| sim.neighbor_ready(dr, dc))
}

fn heightmap_bits(ptr: *const f32, indices: [usize; 3]) -> [u32; 3] {
    assert!(!ptr.is_null(), "heightmap pointer should not be null");
    let data = unsafe { std::slice::from_raw_parts(ptr, TEST_HEIGHTMAP_LEN) };
    [
        data[indices[0]].to_bits(),
        data[indices[1]].to_bits(),
        data[indices[2]].to_bits(),
    ]
}

fn assert_neighbor_coords(sim: &Sim, dr: i32, dc: i32, row: i32, col: i32) {
    let index = slot_index(dr, dc).expect("expected valid neighbor offset");
    let shard = sim.neighbors[index]
        .as_ref()
        .expect("expected populated neighbor slot");
    assert_eq!(shard.row, row);
    assert_eq!(shard.col, col);
}

fn ring_seed_set(sim: &Sim) -> BTreeMap<(i32, i32), u32> {
    const LAYER_TERRAIN_SEEDS: u32 = 0;
    let mut out = BTreeMap::new();
    for &(dr, dc) in &NEIGHBOR_OFFSETS {
        let index = slot_index(dr, dc).expect("expected valid ring offset");
        let shard = sim.neighbors[index]
            .as_ref()
            .expect("expected populated ring slot");
        out.insert(
            (dr, dc),
            cell_seed(sim.world_seed, shard.row, shard.col, LAYER_TERRAIN_SEEDS),
        );
    }
    out
}

fn count_live_ring_shards(sim: &Sim) -> usize {
    1 + sim.neighbors.iter().filter(|slot| slot.is_some()).count()
}

fn collect_live_heightmap_ptrs(sim: &Sim) -> BTreeSet<usize> {
    let mut ptrs = BTreeSet::new();
    ptrs.insert(sim.heightmap_ptr() as usize);
    for &(dr, dc) in &NEIGHBOR_OFFSETS {
        let ptr = sim.neighbor_heightmap_ptr(dr, dc);
        if !ptr.is_null() {
            ptrs.insert(ptr as usize);
        }
    }
    ptrs
}

#[test]
fn crossing_is_gated_by_boarded_units() {
    let mut sim = build_sim(8);
    assert_eq!(sim.spawn_unit(0.3, 0.0), 0);
    assert_eq!(sim.spawn_unit(-0.2, 0.2), 1);

    sim.set_apc_target(999.0, 0.0);
    for _ in 0..2_000 {
        sim.tick(1.0 / 60.0);
        assert!(
            sim.current_shard_col() == 0,
            "crossing should remain gated while units are deployed"
        );
    }

    assert!(
        sim.neighbor_ready(0, 1),
        "east neighbor should still backfill while units are deployed"
    );

    sim.set_unit_recall(true);
    let boarded = tick_until(&mut sim, 10_000, |s| s.deployed_unit_count() == 0);
    assert!(boarded, "units never fully boarded under recall");

    let crossed = tick_until(&mut sim, 500, |s| s.current_shard_col() == 1);
    assert!(crossed, "crossing never proceeded after all units were boarded");
}

#[test]
fn crossing_rebases_apc_and_units_into_new_shard_frame() {
    let mut sim = build_sim(8);
    assert_eq!(sim.spawn_unit(0.3, 0.0), 0);
    sim.set_unit_recall(true);
    let boarded = tick_until(&mut sim, 10_000, |s| s.deployed_unit_count() == 0);
    assert!(boarded, "unit never boarded before crossing test");

    sim.set_apc_target(999.0, 0.0);
    let filled = tick_until(&mut sim, 2_000, |s| s.neighbor_ready(0, 1));
    assert!(filled, "east neighbor never backfilled before crossing");

    let he = sim.current.terrain.half_extent();
    let step = he * 2.0;
    let (unit_x_before, _) = first_unit_xz(&sim);
    let target_world_x = he + 30.0;
    let target_world_z = 10.0;
    sim.set_apc_target(target_world_x, target_world_z);

    let crossed = tick_until(&mut sim, 2_000, |s| s.current_shard_col() == 1);
    assert!(crossed, "APC never crossed into the next shard");
    assert!(sim.neighbor_ready(0, -1), "west slot should hold the old current after crossing");
    assert_neighbor_coords(&sim, 0, -1, 0, 0);

    let apc_x_after_cross = sim.apc_x();
    assert!(
        apc_x_after_cross > -he - 0.1 && apc_x_after_cross < 0.0,
        "APC should land just past -half_extent after strict-threshold crossing: x={apc_x_after_cross:.4} he={he:.4}"
    );

    let expected_x = target_world_x - step;
    let expected_z = target_world_z;
    let arrive_radius_sq = (sim.apc_touch_radius() + 0.05).powi(2);
    let arrived = tick_until(&mut sim, 2_000, |s| {
        let dx = s.apc_x() - expected_x;
        let dz = s.apc_z() - expected_z;
        (dx * dx + dz * dz) <= arrive_radius_sq
    });
    assert!(
        arrived,
        "APC did not continue to rebased target after crossing: x={:.4} z={:.4} expected=({expected_x:.4},{expected_z:.4})",
        sim.apc_x(),
        sim.apc_z(),
    );

    let (unit_x_after, _) = first_unit_xz(&sim);
    assert!(
        ((unit_x_before - step) - unit_x_after).abs() <= 1e-4,
        "unit rebase mismatch: before={unit_x_before:.6} after={unit_x_after:.6} step={step:.6}"
    );
}

#[test]
fn post_crossing_height_is_finite_and_shard_coords_match() {
    let mut sim = build_sim(8);
    sim.set_unit_recall(true);
    sim.set_apc_target(999.0, 0.0);

    let filled = tick_until(&mut sim, 2_000, |s| s.neighbor_ready(0, 1));
    assert!(filled, "east neighbor never backfilled");

    let he = sim.current.terrain.half_extent();
    let target_world_x = he + 30.0;
    let target_world_z = 10.0;
    sim.set_apc_target(target_world_x, target_world_z);
    let crossed = tick_until(&mut sim, 2_000, |s| s.current_shard_col() == 1);
    assert!(crossed, "APC never crossed into expected shard");
    assert!(sim.neighbor_ready(0, -1), "west slot should hold the old current after crossing");
    assert_neighbor_coords(&sim, 0, -1, 0, 0);

    let apc_x_after_cross = sim.apc_x();
    assert!(
        apc_x_after_cross > -he - 0.1 && apc_x_after_cross < 0.0,
        "APC should land just past -half_extent after strict-threshold crossing: x={apc_x_after_cross:.4} he={he:.4}"
    );

    let expected_x = target_world_x - (he * 2.0);
    let expected_z = target_world_z;
    let arrive_radius_sq = (sim.apc_touch_radius() + 0.05).powi(2);
    let arrived = tick_until(&mut sim, 2_000, |s| {
        let dx = s.apc_x() - expected_x;
        let dz = s.apc_z() - expected_z;
        (dx * dx + dz * dz) <= arrive_radius_sq
    });
    assert!(
        arrived,
        "APC did not arrive at rebased target after crossing: x={:.4} z={:.4} expected=({expected_x:.4},{expected_z:.4})",
        sim.apc_x(),
        sim.apc_z(),
    );

    let h = sim.sample_height(sim.apc_x() as f64, sim.apc_z() as f64);
    assert!(h.is_finite(), "height at APC became non-finite after crossing");
    assert_eq!(sim.current_shard_row(), 0);
    assert_eq!(sim.current_shard_col(), 1);
}

#[test]
fn ring_fills_while_idle() {
    let mut sim = build_sim(0);

    for _ in 0..600 {
        sim.tick(1.0 / 60.0);
    }

    assert!(all_neighbors_ready(&sim), "ring-1 should fully backfill while idle");
}

#[test]
fn ring_rekey_determinism() {
    let mut sim = build_sim(0);
    let filled = tick_until(&mut sim, 2_000, all_neighbors_ready);
    assert!(filled, "ring-1 never fully backfilled before determinism check");

    let sample_indices = [0, TEST_HEIGHTMAP_LEN / 2, TEST_HEIGHTMAP_LEN - 1];
    let east_before = heightmap_bits(sim.neighbor_heightmap_ptr(0, 1), sample_indices);

    let he = sim.current.terrain.half_extent();
    sim.set_apc_target(he + 30.0, 10.0);
    let crossed = tick_until(&mut sim, 2_000, |s| s.current_shard_col() == 1);
    assert!(crossed, "APC never crossed east during determinism check");

    let current_bits = heightmap_bits(sim.heightmap_ptr(), sample_indices);
    assert_eq!(
        east_before, current_bits,
        "promoted east neighbor should become the current shard without regeneration"
    );
    assert!(sim.neighbor_ready(0, -1), "old current should rekey into the west slot");
    assert_neighbor_coords(&sim, 0, -1, 0, 0);

    let refilled = tick_until(&mut sim, 2_000, |s| s.neighbor_ready(0, 1));
    assert!(refilled, "new far-east slot never refilled after crossing");
    assert_neighbor_coords(&sim, 0, 1, 0, 2);

    let live_far_east = heightmap_bits(sim.neighbor_heightmap_ptr(0, 1), sample_indices);
    let fresh_far_east = sim
        .current
        .terrain
        .clone_params_for(sim.world_seed, sim.current.row, sim.current.col + 1);
    let fresh_far_east_bits = heightmap_bits(fresh_far_east.heightmap_ptr(), sample_indices);
    assert_eq!(
        live_far_east, fresh_far_east_bits,
        "refilled far-east slot should match a fresh deterministic clone"
    );
}

#[test]
fn crossing_never_oscillates() {
    let mut sim = build_sim(8);
    let he = sim.current.terrain.half_extent();
    sim.set_apc_target(he + 30.0, 10.0);

    let mut crossings = 0;
    let mut prev_col = sim.current_shard_col();
    for _ in 0..20_000 {
        sim.tick(1.0 / 60.0);
        let col = sim.current_shard_col();
        if col != prev_col {
            crossings += 1;
            prev_col = col;
        }
    }

    assert_eq!(
        crossings, 1,
        "shard col changed {crossings} times; must cross exactly once"
    );
    assert_eq!(sim.current_shard_col(), 1);
    assert!((sim.apc_x() - (-he + 30.0)).abs() < 1.0);
}

#[test]
fn ring_backfill_seed_set_is_order_independent_across_entry_sequences() {
    let sequences: [[(i32, i32); 3]; 3] = [
        [(-1, 0), (1, 1), (0, -1)],
        [(1, 0), (-1, -1), (0, 1)],
        [(0, -1), (1, -1), (-1, 0)],
    ];

    let mut sets = Vec::new();
    for sequence in sequences {
        let mut sim = build_sim(0);
        for (dr, dc) in sequence {
            sim.backfill_neighbor(dr, dc);
        }
        for (dr, dc) in NEIGHBOR_OFFSETS {
            sim.backfill_neighbor(dr, dc);
        }
        assert!(all_neighbors_ready(&sim), "ring did not fully populate");
        sets.push(ring_seed_set(&sim));
    }

    let baseline = &sets[0];
    for (idx, candidate) in sets.iter().enumerate().skip(1) {
        assert_eq!(
            baseline, candidate,
            "ring cell_seed mismatch between sequence 0 and sequence {idx}; baseline={baseline:?} candidate={candidate:?}"
        );
    }
}

#[test]
fn repeated_boundary_crossings_keep_ring_and_memory_footprint_stable() {
    let mut sim = build_sim(0);
    let he = sim.current.terrain.half_extent();
    let margin_target = he + 18.0;

    let prefetched = tick_until(&mut sim, 2_000, all_neighbors_ready);
    assert!(prefetched, "ring-1 failed to prefill before crossing stress");

    let baseline_live_shards = count_live_ring_shards(&sim);
    let baseline_ptr_count = collect_live_heightmap_ptrs(&sim).len();

    let mut max_live_shards = baseline_live_shards;
    let mut max_ptr_count = baseline_ptr_count;
    let mut min_col = sim.current_shard_col();
    let mut max_col = sim.current_shard_col();
    let mut live_shard_series = vec![baseline_live_shards];
    let mut ptr_series = vec![baseline_ptr_count];

    for crossing_idx in 0..20 {
        let start_col = sim.current_shard_col();
        let target_x = if crossing_idx % 2 == 0 {
            margin_target
        } else {
            -margin_target
        };
        sim.set_apc_target(target_x, 0.0);

        let crossed = tick_until(&mut sim, 4_000, |s| s.current_shard_col() != start_col);
        assert!(crossed, "crossing {crossing_idx} never completed");

        let live_shards = count_live_ring_shards(&sim);
        let ptr_count = collect_live_heightmap_ptrs(&sim).len();
        max_live_shards = max_live_shards.max(live_shards);
        max_ptr_count = max_ptr_count.max(ptr_count);
        live_shard_series.push(live_shards);
        ptr_series.push(ptr_count);

        assert!(
            (1..=9).contains(&live_shards),
            "live shard count out of bounds after crossing {crossing_idx}: {live_shards}"
        );
        assert!(
            ptr_count <= 9,
            "distinct live heightmap pointer count out of bounds after crossing {crossing_idx}: {ptr_count}"
        );

        min_col = min_col.min(sim.current_shard_col());
        max_col = max_col.max(sim.current_shard_col());
    }

    let final_live_shards = count_live_ring_shards(&sim);
    let final_ptr_count = collect_live_heightmap_ptrs(&sim).len();
    let live_monotonic_growth = live_shard_series.windows(2).all(|w| w[1] >= w[0]);
    let ptr_monotonic_growth = ptr_series.windows(2).all(|w| w[1] >= w[0]);

    println!(
        "crossing-stability probe: baseline_live_shards={baseline_live_shards} final_live_shards={final_live_shards} max_live_shards={max_live_shards} baseline_ptrs={baseline_ptr_count} final_ptrs={final_ptr_count} max_ptrs={max_ptr_count} live_monotonic_growth={live_monotonic_growth} ptr_monotonic_growth={ptr_monotonic_growth} col_span=[{min_col},{max_col}] live_series={live_shard_series:?} ptr_series={ptr_series:?}"
    );

    assert!(
        !(live_monotonic_growth && final_live_shards > baseline_live_shards),
        "live shard count shows sustained monotonic growth across crossings"
    );
    assert!(
        !(ptr_monotonic_growth && final_ptr_count > baseline_ptr_count),
        "live heightmap pointer count shows sustained monotonic growth across crossings"
    );
}

#[test]
fn repeated_crossings_recover_to_full_ring_after_settle() {
    let mut sim = build_sim(0);
    let he = sim.current.terrain.half_extent();
    let margin_target = he + 18.0;
    let expected_full = 1 + NEIGHBOR_OFFSETS.len();
    let settle_limit_ticks = 2_000usize;

    let prefetched = tick_until(&mut sim, settle_limit_ticks, all_neighbors_ready);
    assert!(prefetched, "initial ring-1 prefill did not settle to full occupancy");

    let mut settled_live_series = Vec::with_capacity(20);
    let mut settled_ptr_series = Vec::with_capacity(20);
    let mut settle_ticks_series = Vec::with_capacity(20);

    for crossing_idx in 0..20 {
        let start_col = sim.current_shard_col();
        let target_x = if crossing_idx % 2 == 0 {
            margin_target
        } else {
            -margin_target
        };
        sim.set_apc_target(target_x, 0.0);

        let crossed = tick_until(&mut sim, 4_000, |s| s.current_shard_col() != start_col);
        assert!(crossed, "crossing {crossing_idx} never completed");

        let mut settle_ticks = 0usize;
        while settle_ticks < settle_limit_ticks && !all_neighbors_ready(&sim) {
            sim.tick(1.0 / 60.0);
            settle_ticks += 1;
        }

        let settled = all_neighbors_ready(&sim);
        assert!(
            settled,
            "crossing {crossing_idx} never fully settled within {settle_limit_ticks} ticks"
        );

        let live_shards = count_live_ring_shards(&sim);
        let ptr_count = collect_live_heightmap_ptrs(&sim).len();

        settled_live_series.push(live_shards);
        settled_ptr_series.push(ptr_count);
        settle_ticks_series.push(settle_ticks);

        assert_eq!(
            live_shards, expected_full,
            "crossing {crossing_idx} settled to wrong live shard count: got {live_shards}, expected {expected_full}"
        );
        assert_eq!(
            ptr_count, expected_full,
            "crossing {crossing_idx} settled to wrong unique ptr count: got {ptr_count}, expected {expected_full}"
        );
    }

    let settle_trend = if settle_ticks_series.windows(2).all(|w| w[1] == w[0]) {
        "flat"
    } else if settle_ticks_series.windows(2).all(|w| w[1] >= w[0])
        && settle_ticks_series[19] > settle_ticks_series[0]
    {
        "growing"
    } else {
        "noisy"
    };

    println!(
        "settled-crossing probe: live={settled_live_series:?} ptrs={settled_ptr_series:?} ticks_to_settle={settle_ticks_series:?} trend={settle_trend}"
    );
}

#[test]
fn corner_probe_uses_distinct_shard_instances_in_ring() {
    let mut sim = build_sim(0);
    let filled = tick_until(&mut sim, 2_000, all_neighbors_ready);
    assert!(filled, "ring-1 did not fully populate before corner probe");

    let east_index = slot_index(0, 1).expect("east slot index missing");
    let south_index = slot_index(1, 0).expect("south slot index missing");
    let southeast_index = slot_index(1, 1).expect("southeast slot index missing");

    let east = sim.neighbors[east_index].as_ref().expect("east neighbor missing");
    let south = sim.neighbors[south_index].as_ref().expect("south neighbor missing");
    let southeast = sim.neighbors[southeast_index]
        .as_ref()
        .expect("southeast neighbor missing");

    let current_ptr = sim.current.terrain.heightmap_ptr() as usize;
    let east_ptr = east.terrain.heightmap_ptr() as usize;
    let south_ptr = south.terrain.heightmap_ptr() as usize;
    let southeast_ptr = southeast.terrain.heightmap_ptr() as usize;

    assert_ne!(current_ptr, east_ptr, "east pointer must be a distinct shard instance");
    assert_ne!(current_ptr, south_ptr, "south pointer must be a distinct shard instance");
    assert_ne!(current_ptr, southeast_ptr, "southeast pointer must be a distinct shard instance");

    let he = sim.current.terrain.half_extent();
    let slope_center = sim.current.terrain.slope_degrees_at(he, he);
    let slope_east = east.terrain.slope_degrees_at(-he, he);
    let slope_south = south.terrain.slope_degrees_at(he, -he);
    let slope_southeast = southeast.terrain.slope_degrees_at(-he, -he);
    let slope_corner_max_diff = [slope_east, slope_south, slope_southeast]
        .iter()
        .map(|v| (slope_center - *v).abs())
        .fold(0.0f32, f32::max);

    println!(
        "corner-validity probe: ptrs current={current_ptr:#x} east={east_ptr:#x} south={south_ptr:#x} southeast={southeast_ptr:#x} slope_corner_max_diff={slope_corner_max_diff:.6}"
    );

    assert!(
        slope_corner_max_diff <= 1e-3,
        "corner slope mismatch across distinct ring shards: {slope_corner_max_diff}"
    );
}
