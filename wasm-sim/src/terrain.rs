use crate::rng::Rng;
use noise::{NoiseFn, Simplex};

struct TerrainSeed {
    x: f32,
    z: f32,
    base_value: f32,
    decay_rate: f32,
}

const MIN_SEEDS: usize = 3;
const MAX_SEEDS: usize = 8;
const TIER_MIN: f32 = 0.0;
const TIER_MAX: f32 = 9.0;
const DECAY_MIN: f32 = 0.15;
const DECAY_MAX: f32 = 1.2;
const EXPECTED_TIER: f32 = (TIER_MIN + TIER_MAX) / 2.0;
const MAX_INFLUENCE_RADIUS: f32 = (TIER_MAX - EXPECTED_TIER) / DECAY_MIN;
const SEA_LEVEL: f32 = -3.0;
const BOUNDARY_INFLUENCE_RADIUS: f32 = 6.0;
const INTERIOR_NOISE_AMP: f32 = 0.2;
const STRUCTURE_MARGIN: f32 = 1.0;

pub struct Terrain {
    simplex: Simplex,
    crag_noise: Simplex,
    sweep_noise: Simplex,
    seed_x: f64,
    seed_y: f64,
    scale: f64,
    height_mult: f32,
    crag_strength: f32,
    crag_freq: f64,
    sweep_scale: f64,
    sweep_amp: f32,
    tier_height_scale: f32,
    seeds: Vec<TerrainSeed>,
    zone_threshold: f32,
    heightmap: Vec<f32>,
    slopemap: Vec<f32>,
    hm_width: usize,
    hm_height: usize,
    hm_half_w: f32,
    hm_half_h: f32,
    hm_cell_w: f32,
    hm_cell_h: f32,
}

impl Terrain {
    pub fn new(
        noise_seed: u32,
        seed_x: f64,
        seed_y: f64,
        scale: f64,
        height_mult: f32,
        crag_strength: f32,
        crag_freq: f64,
        sweep_scale: f64,
        sweep_amp: f32,
        tier_height_scale: f32,
    ) -> Self {
        Self {
            simplex: Simplex::new(noise_seed),
            crag_noise: Simplex::new(noise_seed.wrapping_add(1)),
            sweep_noise: Simplex::new(noise_seed.wrapping_add(2)),
            seed_x,
            seed_y,
            scale,
            height_mult,
            crag_strength,
            crag_freq,
            sweep_scale,
            sweep_amp,
            tier_height_scale,
            seeds: Vec::new(),
            zone_threshold: 0.0,
            heightmap: Vec::new(),
            slopemap: Vec::new(),
            hm_width: 0,
            hm_height: 0,
            hm_half_w: 0.0,
            hm_half_h: 0.0,
            hm_cell_w: 1.0,
            hm_cell_h: 1.0,
        }
    }

    pub fn generate_variance(&mut self, rng: &mut Rng, half_extent: f32) {
        let seed_count = MIN_SEEDS
            + (rng.next_unsigned() * (MAX_SEEDS - MIN_SEEDS + 1) as f32) as usize;
        let seed_count = seed_count.min(MAX_SEEDS);

        self.seeds = (0..seed_count)
            .map(|_| TerrainSeed {
                x: rng.next_signed() * half_extent,
                z: rng.next_signed() * half_extent,
                base_value: TIER_MIN + rng.next_unsigned() * (TIER_MAX - TIER_MIN),
                decay_rate: DECAY_MIN + rng.next_unsigned() * (DECAY_MAX - DECAY_MIN),
            })
            .collect();

        self.zone_threshold = TIER_MIN + rng.next_unsigned() * (TIER_MAX - TIER_MIN);
    }

    pub fn regenerate(&mut self, noise_seed: u32) {
        self.simplex = Simplex::new(noise_seed);
        self.crag_noise = Simplex::new(noise_seed.wrapping_add(1));
        self.sweep_noise = Simplex::new(noise_seed.wrapping_add(2));

        let half_extent = self.hm_half_w;
        let mut rng = Rng::new(noise_seed);
        self.generate_variance(&mut rng, half_extent);
    }

    pub fn set_height_mult(&mut self, v: f32) {
        self.height_mult = v;
    }

    pub fn set_crag_strength(&mut self, v: f32) {
        self.crag_strength = v;
    }

    pub fn set_crag_freq(&mut self, v: f64) {
        self.crag_freq = v;
    }

    pub fn set_sweep_scale(&mut self, v: f64) {
        self.sweep_scale = v;
    }

    pub fn set_sweep_amp(&mut self, v: f32) {
        self.sweep_amp = v;
    }

    pub fn set_tier_height_scale(&mut self, v: f32) {
        self.tier_height_scale = v;
    }

    fn tier_value(&self, x: f32, z: f32) -> (f32, f32) {
        let mut top1 = f32::NEG_INFINITY;
        let mut top2 = f32::NEG_INFINITY;

        for seed in &self.seeds {
            let dx = x - seed.x;
            let dz = z - seed.z;
            let base_dist = (dx * dx + dz * dz).sqrt();
            let crag = self.crag_distortion(seed, dx, dz);
            let dist = (base_dist * (1.0 + crag * self.crag_strength)).max(0.0);
            if dist > MAX_INFLUENCE_RADIUS {
                continue;
            }
            let value = seed.base_value - seed.decay_rate * dist;
            if value > top1 {
                top2 = top1;
                top1 = value;
            } else if value > top2 {
                top2 = value;
            }
        }

        if top1 == f32::NEG_INFINITY {
            return (EXPECTED_TIER, f32::INFINITY);
        }

        (top1, top1 - top2)
    }

    fn noise_amplitude(margin: f32) -> f32 {
        let t = (margin / BOUNDARY_INFLUENCE_RADIUS).clamp(0.0, 1.0);
        INTERIOR_NOISE_AMP + (1.0 - INTERIOR_NOISE_AMP) * (1.0 - t)
    }

    fn crag_distortion(&self, seed: &TerrainSeed, dx: f32, dz: f32) -> f32 {
        let angle = (dz as f64).atan2(dx as f64);
        let nx = seed.x as f64 * 0.01 + angle.cos() * self.crag_freq;
        let nz = seed.z as f64 * 0.01 + angle.sin() * self.crag_freq;
        self.crag_noise.get([nx, nz]) as f32
    }

    pub fn sample_height(&self, x: f64, z: f64) -> f32 {
        let (tier, margin) = self.tier_value(x as f32, z as f32);
        let normalized_tier = tier - EXPECTED_TIER;
        let noise = self
            .simplex
            .get([(x + self.seed_x) * self.scale, (z + self.seed_y) * self.scale])
            as f32;
        let sweep = self
            .sweep_noise
            .get([
                (x + self.seed_x) * self.sweep_scale,
                (z + self.seed_y) * self.sweep_scale,
            ]) as f32;
        let raw = normalized_tier * self.tier_height_scale
            + noise * Self::noise_amplitude(margin)
            + sweep * self.sweep_amp;
        raw.max(SEA_LEVEL)
    }

    pub fn zone_at(&self, x: f32, z: f32) -> u8 {
        let (tier, _) = self.tier_value(x, z);
        if tier < self.zone_threshold { 0 } else { 1 }
    }

    pub fn is_structure_viable(&self, x: f32, z: f32) -> bool {
        self.tier_value(x, z).1 > STRUCTURE_MARGIN
    }

    fn gradient_at(&self, x: f32, z: f32) -> f32 {
        const EPS: f32 = 0.5;
        let h0 = self.sample_height(x as f64, z as f64);
        let hx = self.sample_height((x + EPS) as f64, z as f64);
        let hz = self.sample_height(x as f64, (z + EPS) as f64);
        let dhx = (hx - h0) * self.height_mult;
        let dhz = (hz - h0) * self.height_mult;
        (dhx * dhx + dhz * dhz).sqrt() / EPS
    }

    pub fn steepness_at(&self, x: f32, z: f32) -> f32 {
        self.gradient_at(x, z)
    }

    /// Slope in degrees at an arbitrary world-space point. This is the
    /// durable, multi-purpose slope query - gameplay systems (Heat cost
    /// per movement, cliff/connectivity checks) should call THIS, not the
    /// debug slopemap grid added separately for mesh-vertex coloring.
    /// The slopemap exists only to match the heightmap's render-grid
    /// resolution for the debug overlay and can be removed independently
    /// of this function if the overlay is ever ripped out.
    pub fn slope_degrees_at(&self, x: f32, z: f32) -> f32 {
        self.gradient_at(x, z).atan().to_degrees()
    }

    pub fn generate_heightmap(&mut self, grid_w: usize, grid_h: usize, world_w: f32, world_h: f32) {
        if grid_w == 0 || grid_h == 0 {
            self.heightmap.clear();
            self.hm_width = 0;
            self.hm_height = 0;
            self.hm_half_w = world_w * 0.5;
            self.hm_half_h = world_h * 0.5;
            self.hm_cell_w = world_w.max(1.0);
            self.hm_cell_h = world_h.max(1.0);
            return;
        }

        self.heightmap = vec![0.0; grid_w * grid_h];
        self.hm_width = grid_w;
        self.hm_height = grid_h;
        self.hm_half_w = world_w * 0.5;
        self.hm_half_h = world_h * 0.5;
        self.hm_cell_w = if grid_w > 1 {
            (world_w / (grid_w as f32 - 1.0)).max(f32::EPSILON)
        } else {
            world_w.max(1.0)
        };
        self.hm_cell_h = if grid_h > 1 {
            (world_h / (grid_h as f32 - 1.0)).max(f32::EPSILON)
        } else {
            world_h.max(1.0)
        };

        for row in 0..grid_h {
            let vz = if grid_h > 1 {
                row as f32 / (grid_h as f32 - 1.0)
            } else {
                0.5
            };
            let wz = (vz - 0.5) * world_h;
            for col in 0..grid_w {
                let vx = if grid_w > 1 {
                    col as f32 / (grid_w as f32 - 1.0)
                } else {
                    0.5
                };
                let wx = (vx - 0.5) * world_w;
                self.heightmap[row * grid_w + col] = self.sample_height(wx as f64, wz as f64);
            }
        }
    }

    /// Must be called after generate_heightmap(). Builds a slope-degrees
    /// grid at the same resolution as self.heightmap, using central
    /// differences over the cached heights (one-sided at grid edges).
    /// This is the debug-overlay-only path - gameplay code should call
    /// slope_degrees_at() instead, not this grid.
    pub fn generate_slopemap(&mut self) {
        let w = self.hm_width;
        let h = self.hm_height;

        if w < 2 || h < 2 {
            self.slopemap = vec![0.0; w * h];
            return;
        }

        self.slopemap = vec![0.0; w * h];
        for row in 0..h {
            for col in 0..w {
                let x0 = col.saturating_sub(1);
                let x1 = (col + 1).min(w - 1);
                let z0 = row.saturating_sub(1);
                let z1 = (row + 1).min(h - 1);

                let h_x0 = self.heightmap[row * w + x0];
                let h_x1 = self.heightmap[row * w + x1];
                let h_z0 = self.heightmap[z0 * w + col];
                let h_z1 = self.heightmap[z1 * w + col];

                let dx = ((x1 - x0) as f32) * self.hm_cell_w;
                let dz = ((z1 - z0) as f32) * self.hm_cell_h;

                let dhx = (h_x1 - h_x0) * self.height_mult / dx.max(f32::EPSILON);
                let dhz = (h_z1 - h_z0) * self.height_mult / dz.max(f32::EPSILON);

                let gradient = (dhx * dhx + dhz * dhz).sqrt();
                self.slopemap[row * w + col] = gradient.atan().to_degrees();
            }
        }
    }

    #[inline]
    pub fn height_at_or_sample(&self, x: f32, z: f32) -> f32 {
        if self.hm_width < 2 || self.hm_height < 2 {
            return self.sample_height(x as f64, z as f64);
        }

        let gx = (x + self.hm_half_w) / self.hm_cell_w;
        let gz = (z + self.hm_half_h) / self.hm_cell_h;

        if gx < 0.0
            || gz < 0.0
            || gx > (self.hm_width - 1) as f32
            || gz > (self.hm_height - 1) as f32
        {
            return self.sample_height(x as f64, z as f64);
        }

        self.sample_triangle(gx, gz)
    }

    #[inline]
    pub fn height_at_clamped(&self, x: f32, z: f32) -> f32 {
        if self.hm_width < 2 || self.hm_height < 2 {
            return self.sample_height(x as f64, z as f64);
        }

        let gx = (x + self.hm_half_w) / self.hm_cell_w;
        let gz = (z + self.hm_half_h) / self.hm_cell_h;
        let cx = gx.clamp(0.0, (self.hm_width - 1) as f32);
        let cz = gz.clamp(0.0, (self.hm_height - 1) as f32);

        self.sample_triangle(cx, cz)
    }

    pub fn height_mult(&self) -> f32 {
        self.height_mult
    }

    pub fn heightmap_ptr(&self) -> *const f32 {
        self.heightmap.as_ptr()
    }

    pub fn slopemap_ptr(&self) -> *const f32 {
        self.slopemap.as_ptr()
    }

    #[inline]
    fn sample_triangle(&self, gx: f32, gz: f32) -> f32 {
        let x0 = gx as usize;
        let z0 = gz as usize;
        let x1 = (x0 + 1).min(self.hm_width - 1);
        let z1 = (z0 + 1).min(self.hm_height - 1);
        let fx = gx - x0 as f32;
        let fz = gz - z0 as f32;

        let w = self.hm_width;
        let h00 = self.heightmap[z0 * w + x0];
        let h10 = self.heightmap[z0 * w + x1];
        let h01 = self.heightmap[z1 * w + x0];
        let h11 = self.heightmap[z1 * w + x1];

        // Match Three.js PlaneGeometry quad triangulation so sampled unit heights
        // lie on the same flat triangles that the terrain mesh renders.
        if fx + fz <= 1.0 {
            h00 + (h10 - h00) * fx + (h01 - h00) * fz
        } else {
            h11 + (h01 - h11) * (1.0 - fx) + (h10 - h11) * (1.0 - fz)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slope_degrees_at_sanity() {
        let noise_seed = 1337;
        let mut terrain = Terrain::new(
            noise_seed,
            17.0,
            29.0,
            0.028,
            5.2,
            1.2,
            2.1,
            0.011,
            0.2,
            0.95,
        );
        let mut rng = Rng::new(noise_seed);
        terrain.generate_variance(&mut rng, 120.0);

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
        let mut terrain = Terrain::new(
            noise_seed,
            17.0,
            29.0,
            0.028,
            5.2,
            1.2,
            2.1,
            0.011,
            0.2,
            0.95,
        );
        let mut rng = Rng::new(noise_seed);
        terrain.generate_variance(&mut rng, 120.0);

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

        assert!(mean_abs_diff <= 8.0, "mean abs diff too high: {mean_abs_diff:.2}");
        assert!(
            large_diff_count as f32 / samples as f32 <= 0.07,
            "too many large diffs: {large_diff_count}/{samples}"
        );
    }
}
