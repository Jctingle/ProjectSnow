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
const TIER_HEIGHT_SCALE: f32 = 0.6;
const BOUNDARY_INFLUENCE_RADIUS: f32 = 6.0;
const INTERIOR_NOISE_AMP: f32 = 0.2;
const STRUCTURE_MARGIN: f32 = 1.0;

pub struct Terrain {
    simplex: Simplex,
    seed_x: f64,
    seed_y: f64,
    scale: f64,
    height_mult: f32,
    seeds: Vec<TerrainSeed>,
    zone_threshold: f32,
    heightmap: Vec<f32>,
    hm_width: usize,
    hm_height: usize,
    hm_half_w: f32,
    hm_half_h: f32,
    hm_cell_w: f32,
    hm_cell_h: f32,
}

impl Terrain {
    pub fn new(noise_seed: u32, seed_x: f64, seed_y: f64, scale: f64, height_mult: f32) -> Self {
        Self {
            simplex: Simplex::new(noise_seed),
            seed_x,
            seed_y,
            scale,
            height_mult,
            seeds: Vec::new(),
            zone_threshold: 0.0,
            heightmap: Vec::new(),
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

    fn tier_value(&self, x: f32, z: f32) -> (f32, f32) {
        if self.seeds.is_empty() {
            return (0.0, f32::INFINITY);
        }

        let mut top1 = f32::NEG_INFINITY;
        let mut top2 = f32::NEG_INFINITY;

        for seed in &self.seeds {
            let dx = x - seed.x;
            let dz = z - seed.z;
            let dist = (dx * dx + dz * dz).sqrt();
            let value = seed.base_value - seed.decay_rate * dist;
            if value > top1 {
                top2 = top1;
                top1 = value;
            } else if value > top2 {
                top2 = value;
            }
        }

        (top1, top1 - top2)
    }

    fn noise_amplitude(margin: f32) -> f32 {
        let t = (margin / BOUNDARY_INFLUENCE_RADIUS).clamp(0.0, 1.0);
        INTERIOR_NOISE_AMP + (1.0 - INTERIOR_NOISE_AMP) * (1.0 - t)
    }

    pub fn sample_height(&self, x: f64, z: f64) -> f32 {
        let (tier, margin) = self.tier_value(x as f32, z as f32);
        let noise = self
            .simplex
            .get([(x + self.seed_x) * self.scale, (z + self.seed_y) * self.scale])
            as f32;
        tier * TIER_HEIGHT_SCALE + noise * Self::noise_amplitude(margin)
    }

    pub fn zone_at(&self, x: f32, z: f32) -> u8 {
        let (tier, _) = self.tier_value(x, z);
        if tier < self.zone_threshold { 0 } else { 1 }
    }

    pub fn is_structure_viable(&self, x: f32, z: f32) -> bool {
        self.tier_value(x, z).1 > STRUCTURE_MARGIN
    }

    pub fn steepness_at(&self, x: f32, z: f32) -> f32 {
        const EPS: f32 = 0.5;
        let h0 = self.sample_height(x as f64, z as f64);
        let hx = self.sample_height((x + EPS) as f64, z as f64);
        let hz = self.sample_height(x as f64, (z + EPS) as f64);
        let dhx = (hx - h0) * self.height_mult;
        let dhz = (hz - h0) * self.height_mult;
        (dhx * dhx + dhz * dhz).sqrt() / EPS
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
