mod grid;
#[cfg(test)]
mod tests;

use crate::rng::{cell_seed, Rng};
use noise::{NoiseFn, Simplex};

struct TerrainSeed {
    x: f32,
    z: f32,
    canonical_x: f32,
    canonical_z: f32,
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
/// Floor on the crag distortion multiplier. This is correctness-critical,
/// not a style knob: it bounds the maximum reach of any seed to
/// MAX_INFLUENCE_RADIUS / MIN_CRAG_MULT = 30 / 0.25 = 120 world units.
/// The nearest any seed from outside the included 3x3 cell ring can sit
/// to a query point inside this shard is 144 units with current dimensions.
/// Since 120 < 144, the 3x3 ring in assemble_seeds is provably sufficient
/// at any crag_strength setting. Do not lower this constant or raise
/// MAX_INFLUENCE_RADIUS without re-checking that inequality, and do not
/// expose this through config/dev UI since tuning it can silently break
/// cross-shard determinism.
const MIN_CRAG_MULT: f32 = 0.25;
const LAYER_TERRAIN_SEEDS: u32 = 0;
const SEA_LEVEL: f32 = -3.0;
const BOUNDARY_INFLUENCE_RADIUS: f32 = 6.0;
const INTERIOR_NOISE_AMP: f32 = 0.2;
const STRUCTURE_MARGIN: f32 = 1.0;

pub struct Terrain {
    simplex: Simplex,
    crag_noise: Simplex,
    sweep_noise: Simplex,
    base_seed_x: f64,
    base_seed_y: f64,
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
            base_seed_x: seed_x,
            base_seed_y: seed_y,
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

    fn seeds_for_cell(
        world_seed: u32,
        row: i32,
        col: i32,
        half_extent: f32,
    ) -> (Vec<TerrainSeed>, f32) {
        let mut rng = Rng::new(cell_seed(world_seed, row, col, LAYER_TERRAIN_SEEDS));
        let seed_count = MIN_SEEDS
            + (rng.next_unsigned() * (MAX_SEEDS - MIN_SEEDS + 1) as f32) as usize;
        let seed_count = seed_count.min(MAX_SEEDS);

        let seeds = (0..seed_count)
            .map(|_| {
                let x = rng.next_signed() * half_extent;
                let z = rng.next_signed() * half_extent;
                TerrainSeed {
                    x,
                    z,
                    canonical_x: x,
                    canonical_z: z,
                    base_value: TIER_MIN + rng.next_unsigned() * (TIER_MAX - TIER_MIN),
                    decay_rate: DECAY_MIN + rng.next_unsigned() * (DECAY_MAX - DECAY_MIN),
                }
            })
            .collect();

        let zone_threshold = TIER_MIN + rng.next_unsigned() * (TIER_MAX - TIER_MIN);
        (seeds, zone_threshold)
    }

    /// Builds the full effective seed list for shard (row, col): this
    /// shard's own seeds plus all 8 surrounding cells' seeds (orthogonal +
    /// diagonal), translated into this shard's local frame. The 3x3 ring is
    /// sufficient because MIN_CRAG_MULT bounds any seed's maximum effective
    /// reach to MAX_INFLUENCE_RADIUS / MIN_CRAG_MULT = 120 world units,
    /// which is less than the 144-unit minimum distance from any in-shard
    /// query point to any seed outside the ring. Both halves of that
    /// argument are load-bearing: see MIN_CRAG_MULT's comment before
    /// changing either constant.
    fn assemble_seeds(
        world_seed: u32,
        row: i32,
        col: i32,
        half_extent: f32,
    ) -> (Vec<TerrainSeed>, f32) {
        let shard_step = half_extent * 2.0;
        let (mut seeds, zone_threshold) = Self::seeds_for_cell(world_seed, row, col, half_extent);

        let neighbor_offsets = [
            (-1, 0),
            (1, 0),
            (0, -1),
            (0, 1),
            (-1, -1),
            (-1, 1),
            (1, -1),
            (1, 1),
        ];
        for (dr, dc) in neighbor_offsets {
            let (n_row, n_col) = (row + dr, col + dc);
            let (n_seeds, _) = Self::seeds_for_cell(world_seed, n_row, n_col, half_extent);
            for s in n_seeds {
                seeds.push(TerrainSeed {
                    x: s.x + dc as f32 * shard_step,
                    z: s.z + dr as f32 * shard_step,
                    canonical_x: s.canonical_x,
                    canonical_z: s.canonical_z,
                    base_value: s.base_value,
                    decay_rate: s.decay_rate,
                });
            }
        }

        (seeds, zone_threshold)
    }

    pub fn regenerate(&mut self, world_seed: u32, row: i32, col: i32) {
        self.simplex = Simplex::new(world_seed);
        self.crag_noise = Simplex::new(world_seed.wrapping_add(1));
        self.sweep_noise = Simplex::new(world_seed.wrapping_add(2));

        let shard_step = (self.hm_half_w * 2.0) as f64;
        self.seed_x = self.base_seed_x + col as f64 * shard_step;
        self.seed_y = self.base_seed_y + row as f64 * shard_step;

        let half_extent = self.hm_half_w;
        let (seeds, zone_threshold) = Self::assemble_seeds(world_seed, row, col, half_extent);
        self.seeds = seeds;
        self.zone_threshold = zone_threshold;
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

    pub fn half_extent(&self) -> f32 {
        self.hm_half_w
    }

    pub fn clone_params_for(&self, world_seed: u32, row: i32, col: i32) -> Terrain {
        let mut terrain = Terrain::new(
            world_seed,
            self.base_seed_x,
            self.base_seed_y,
            self.scale,
            self.height_mult,
            self.crag_strength,
            self.crag_freq,
            self.sweep_scale,
            self.sweep_amp,
            self.tier_height_scale,
        );

        let world_w = self.hm_half_w * 2.0;
        let world_h = self.hm_half_h * 2.0;
        terrain.generate_heightmap(self.hm_width, self.hm_height, world_w, world_h);
        terrain.regenerate(world_seed, row, col);
        terrain.generate_slopemap();
        terrain
    }

    fn tier_value(&self, x: f32, z: f32) -> (f32, f32) {
        let mut top1 = f32::NEG_INFINITY;
        let mut top2 = f32::NEG_INFINITY;

        for seed in &self.seeds {
            let dx = x - seed.x;
            let dz = z - seed.z;
            let base_dist = (dx * dx + dz * dz).sqrt();
            let crag = self.crag_distortion(seed, dx, dz);
            let dist = base_dist * (1.0 + crag * self.crag_strength).max(MIN_CRAG_MULT);
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
        let nx = seed.canonical_x as f64 * 0.01 + angle.cos() * self.crag_freq;
        let nz = seed.canonical_z as f64 * 0.01 + angle.sin() * self.crag_freq;
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
}