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