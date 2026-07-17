use super::*;

#[test]
fn slope_degrees_at_sanity() {
    let noise_seed = 1337;
    let mut terrain = Terrain::new(noise_seed, 17.0, 29.0, 0.028, 5.2, 1.2, 2.1, 0.011, 0.2, 0.95);
    terrain.generate_heightmap(0, 0, 240.0, 240.0);
    terrain.regenerate(noise_seed, 0, 0);

    let mut min_deg = f32::INFINITY;
    let mut max_deg = 0.0;
    let mut flat_count = 0usize;
    let mut steep_count = 0usize;

    for xi in -60..=60 {
        for zi in -60..=60 {
            let x = xi as f32 * 2.0;
            let z = zi as f32 * 2.0;
            let deg = terrain.slope_degrees_at(x, z);

            assert!(deg.is_finite(), "non-finite slope at ({x}, {z}): {deg}");
            assert!((0.0..=90.0).contains(&deg), "out-of-range slope at ({x}, {z}): {deg}");

            if deg < min_deg {
                min_deg = deg;
            }
            if deg > max_deg {
                max_deg = deg;
            }
            if deg <= 2.0 {
                flat_count += 1;
            }
            if deg >= 30.0 {
                steep_count += 1;
            }
        }
    }

    println!(
        "slope_degrees_at sanity: min={min_deg:.2} max={max_deg:.2} flat<=2deg={flat_count} steep>=30deg={steep_count}"
    );

    assert!(min_deg <= 2.0, "expected near-flat samples, got min={min_deg:.2}");
    assert!(max_deg >= 30.0, "expected steep samples, got max={max_deg:.2}");
    assert!(flat_count > 0, "expected at least one near-flat sample");
    assert!(steep_count > 0, "expected at least one steep sample");
}

#[test]
fn slopemap_tracks_point_query_at_grid_points() {
    let noise_seed = 2025;
    let mut terrain = Terrain::new(noise_seed, 17.0, 29.0, 0.028, 5.2, 1.2, 2.1, 0.011, 0.2, 0.95);
    terrain.generate_heightmap(0, 0, 240.0, 240.0);
    terrain.regenerate(noise_seed, 0, 0);

    let grid_w = 257;
    let grid_h = 257;
    let world_w = 240.0;
    let world_h = 240.0;
    terrain.generate_heightmap(grid_w, grid_h, world_w, world_h);
    terrain.generate_slopemap();

    let mut max_abs_diff = 0.0f32;
    let mut mean_abs_diff = 0.0f32;
    let mut large_diff_count = 0usize;
    let mut samples = 0usize;

    for row in 0..grid_h {
        let vz = if grid_h > 1 {
            row as f32 / (grid_h as f32 - 1.0)
        } else {
            0.5
        };
        let z = (vz - 0.5) * world_h;

        for col in 0..grid_w {
            let vx = if grid_w > 1 {
                col as f32 / (grid_w as f32 - 1.0)
            } else {
                0.5
            };
            let x = (vx - 0.5) * world_w;

            let grid_deg = terrain.slopemap[row * grid_w + col];
            let point_deg = terrain.slope_degrees_at(x, z);
            let diff = (grid_deg - point_deg).abs();

            if diff > max_abs_diff {
                max_abs_diff = diff;
            }
            if diff >= 30.0 {
                large_diff_count += 1;
            }
            mean_abs_diff += diff;
            samples += 1;
        }
    }

    mean_abs_diff /= samples as f32;

    println!(
        "slopemap vs point query: mean_abs_diff={mean_abs_diff:.2} max_abs_diff={max_abs_diff:.2} large_diff_count={large_diff_count}/{samples}"
    );

    // These tolerances are intentionally loose because slope_degrees_at() is a
    // continuous point query over sample_height(), while generate_slopemap() uses
    // cached grid central differences. Around SEA_LEVEL clamp transitions, small
    // neighborhood shifts can produce larger local slope disagreements.
    assert!(mean_abs_diff <= 8.0, "mean abs diff too high: {mean_abs_diff:.2}");
    assert!(
        large_diff_count as f32 / samples as f32 <= 0.09,
        "too many large diffs: {large_diff_count}/{samples}"
    );
}

#[test]
fn terrain_seed_distribution_sanity() {
    let world_seed = 4242;
    let half_extent = 120.0;

    let (own_seeds, zone_threshold) = Terrain::seeds_for_cell(world_seed, 0, 0, half_extent);
    assert!((MIN_SEEDS..=MAX_SEEDS).contains(&own_seeds.len()));
    assert!((TIER_MIN..=TIER_MAX).contains(&zone_threshold));

    let (assembled_seeds, _) = Terrain::assemble_seeds(world_seed, 0, 0, half_extent);
    assert!(assembled_seeds.len() >= own_seeds.len());

    for seed in &assembled_seeds {
        assert!((TIER_MIN..=TIER_MAX).contains(&seed.base_value));
        assert!((DECAY_MIN..=DECAY_MAX).contains(&seed.decay_rate));
    }
}

#[test]
fn shard_edge_continuity_matches_across_neighbors() {
    let world_seed = 9001;
    let half_extent = 72.0;

    let mut left = Terrain::new(world_seed, 17.0, 29.0, 0.028, 5.2, 1.2, 2.1, 0.011, 0.2, 0.95);
    left.generate_heightmap(0, 0, half_extent * 2.0, half_extent * 2.0);
    left.regenerate(world_seed, 0, 0);

    let mut right = Terrain::new(world_seed, 17.0, 29.0, 0.028, 5.2, 1.2, 2.1, 0.011, 0.2, 0.95);
    right.generate_heightmap(0, 0, half_extent * 2.0, half_extent * 2.0);
    right.regenerate(world_seed, 0, 1);

    for zi in -20..=20 {
        let z = zi as f32 * 3.0;
        let left_height = left.sample_height(half_extent as f64, z as f64);
        let right_height = right.sample_height(-(half_extent as f64), z as f64);

        assert!(
            (left_height - right_height).abs() <= 1e-4,
            "shared-edge heights diverged at z={z:.1}: left={left_height:.8} right={right_height:.8}"
        );
    }
}

#[test]
fn noise_layer_continuous_across_shard_boundary() {
    let world_seed = 4242;
    let half_extent = 72.0;

    let mut left = Terrain::new(world_seed, 17.0, 29.0, 0.028, 5.2, 1.2, 2.1, 0.011, 0.2, 0.95);
    left.generate_heightmap(0, 0, half_extent * 2.0, half_extent * 2.0);
    left.regenerate(world_seed, 0, 0);

    let mut right = Terrain::new(world_seed, 17.0, 29.0, 0.028, 5.2, 1.2, 2.1, 0.011, 0.2, 0.95);
    right.generate_heightmap(0, 0, half_extent * 2.0, half_extent * 2.0);
    right.regenerate(world_seed, 0, 1);

    for zi in -24..=24 {
        let z = zi as f32 * 3.0;
        let l = left.sample_height(half_extent as f64, z as f64);
        let r = right.sample_height(-(half_extent as f64), z as f64);
        assert!(
            (l - r).abs() <= 1e-4,
            "shared-edge height diverged at z={z:.1}: left={l:.8} right={r:.8}"
        );
    }

    // Also check a row-adjacent pair (Z axis), not just column-adjacent,
    // since seed_y/row was never exercised by the earlier X-axis-only tests.
    let mut top = Terrain::new(world_seed, 17.0, 29.0, 0.028, 5.2, 1.2, 2.1, 0.011, 0.2, 0.95);
    top.generate_heightmap(0, 0, half_extent * 2.0, half_extent * 2.0);
    top.regenerate(world_seed, 0, 0);

    let mut bottom =
        Terrain::new(world_seed, 17.0, 29.0, 0.028, 5.2, 1.2, 2.1, 0.011, 0.2, 0.95);
    bottom.generate_heightmap(0, 0, half_extent * 2.0, half_extent * 2.0);
    bottom.regenerate(world_seed, 1, 0);

    for xi in -24..=24 {
        let x = xi as f32 * 3.0;
        let t = top.sample_height(x as f64, half_extent as f64);
        let b = bottom.sample_height(x as f64, -(half_extent as f64));
        assert!(
            (t - b).abs() <= 1e-4,
            "shared-edge height diverged at x={x:.1}: top={t:.8} bottom={b:.8}"
        );
    }
}

#[test]
fn crag_reach_bound_keeps_ring1_sufficient() {
    let max_reach = MAX_INFLUENCE_RADIUS / MIN_CRAG_MULT;
    let shard_step = 144.0_f32; // GROUND_SIZE; keep in sync if that changes
    let half_extent = shard_step / 2.0;
    let min_dist_to_outside_ring = shard_step + half_extent - half_extent; // = shard_step
    assert!(
        max_reach < min_dist_to_outside_ring,
        "crag reach bound ({max_reach}) must stay below min distance to \
         outside-ring seeds ({min_dist_to_outside_ring}) or assemble_seeds \
         needs a wider ring"
    );
}

#[test]
fn cloned_shard_cached_heightmap_matches_live_sampling() {
    let world_seed = 4242u32;
    let mut current =
        Terrain::new(world_seed, 17.0, 29.0, 0.028, 5.2, 1.2, 2.1, 0.011, 0.2, 0.95);
    current.generate_heightmap(0, 0, 144.0, 144.0);
    current.regenerate(world_seed, 0, 0);
    current.generate_heightmap(145, 145, 144.0, 144.0);
    current.generate_slopemap();

    let next = current.clone_params_for(world_seed, 0, 1);

    for &(x, z) in &[
        (0.0f32, 0.0f32),
        (30.0, -20.0),
        (-50.0, 45.0),
        (71.0, 0.0),
        (-71.0, -71.0),
    ] {
        let cached = next.height_at_or_sample(x, z);
        let live = next.sample_height(x as f64, z as f64);
        assert!(
            (cached - live).abs() <= 0.06,
            "cloned shard cache stale at ({x},{z}): cached={cached:.4} live={live:.4}"
        );
    }
}

#[test]
fn slope_degrees_at_is_continuous_across_shard_coordinate_spaces() {
    let world_seed = 31415u32;
    let half_extent = 72.0f32;

    let mut center =
        Terrain::new(world_seed, 17.0, 29.0, 0.028, 5.2, 1.2, 2.1, 0.011, 0.2, 0.95);
    center.generate_heightmap(0, 0, half_extent * 2.0, half_extent * 2.0);
    center.regenerate(world_seed, 0, 0);

    let east = center.clone_params_for(world_seed, 0, 1);
    let south = center.clone_params_for(world_seed, 1, 0);
    let southeast = center.clone_params_for(world_seed, 1, 1);

    let mut max_x_edge_diff = 0.0f32;
    for zi in -20..=20 {
        let z = zi as f32 * 3.1;
        let a = center.slope_degrees_at(half_extent, z);
        let b = east.slope_degrees_at(-half_extent, z);
        max_x_edge_diff = max_x_edge_diff.max((a - b).abs());
    }

    let mut max_z_edge_diff = 0.0f32;
    for xi in -20..=20 {
        let x = xi as f32 * 3.1;
        let a = center.slope_degrees_at(x, half_extent);
        let b = south.slope_degrees_at(x, -half_extent);
        max_z_edge_diff = max_z_edge_diff.max((a - b).abs());
    }

    let corner_center = center.slope_degrees_at(half_extent, half_extent);
    let corner_east = east.slope_degrees_at(-half_extent, half_extent);
    let corner_south = south.slope_degrees_at(half_extent, -half_extent);
    let corner_southeast = southeast.slope_degrees_at(-half_extent, -half_extent);
    let corner_max_diff = [corner_east, corner_south, corner_southeast]
        .iter()
        .map(|v| (corner_center - *v).abs())
        .fold(0.0f32, f32::max);

    println!(
        "slope_degrees_at seam probe: x_edge_max={max_x_edge_diff:.6} z_edge_max={max_z_edge_diff:.6} corner_max={corner_max_diff:.6}"
    );

    assert!(max_x_edge_diff <= 1e-3, "x-edge slope mismatch too large: {max_x_edge_diff}");
    assert!(max_z_edge_diff <= 1e-3, "z-edge slope mismatch too large: {max_z_edge_diff}");
    assert!(corner_max_diff <= 1e-3, "corner slope mismatch too large: {corner_max_diff}");
}

#[test]
fn slopemap_is_continuous_across_cardinal_edges_and_shared_corner() {
    let world_seed = 27182u32;
    let half_extent = 72.0f32;
    let grid = 73usize;
    let world = half_extent * 2.0;

    let mut center =
        Terrain::new(world_seed, 17.0, 29.0, 0.028, 5.2, 1.2, 2.1, 0.011, 0.2, 0.95);
    center.generate_heightmap(0, 0, world, world);
    center.regenerate(world_seed, 0, 0);
    center.generate_heightmap(grid, grid, world, world);
    center.generate_slopemap();

    let east = center.clone_params_for(world_seed, 0, 1);
    let south = center.clone_params_for(world_seed, 1, 0);
    let southeast = center.clone_params_for(world_seed, 1, 1);

    let mut max_x_edge_diff = 0.0f32;
    for row in 0..grid {
        let a = center.slopemap[row * grid + (grid - 1)];
        let b = east.slopemap[row * grid];
        max_x_edge_diff = max_x_edge_diff.max((a - b).abs());
    }

    let mut max_z_edge_diff = 0.0f32;
    for col in 0..grid {
        let a = center.slopemap[(grid - 1) * grid + col];
        let b = south.slopemap[col];
        max_z_edge_diff = max_z_edge_diff.max((a - b).abs());
    }

    let corner_center = center.slopemap[(grid - 1) * grid + (grid - 1)];
    let corner_east = east.slopemap[(grid - 1) * grid];
    let corner_south = south.slopemap[grid - 1];
    let corner_southeast = southeast.slopemap[0];
    let corner_max_diff = [corner_east, corner_south, corner_southeast]
        .iter()
        .map(|v| (corner_center - *v).abs())
        .fold(0.0f32, f32::max);

    println!(
        "slopemap seam probe: x_edge_max={max_x_edge_diff:.6} z_edge_max={max_z_edge_diff:.6} corner_max={corner_max_diff:.6}"
    );

    assert!(
        max_x_edge_diff <= 0.2,
        "x-edge slopemap mismatch too large: {max_x_edge_diff}"
    );
    assert!(
        max_z_edge_diff <= 0.2,
        "z-edge slopemap mismatch too large: {max_z_edge_diff}"
    );
    assert!(corner_max_diff <= 0.2, "corner slopemap mismatch too large: {corner_max_diff}");
}