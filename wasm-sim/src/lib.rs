use wasm_bindgen::prelude::*;
use noise::{NoiseFn, Simplex};

// -----------------------------------------------------------------------------
// Unit state model and movement tuning
// -----------------------------------------------------------------------------
const SEEK_APC: u8 = 0;
const SEEK_RANDOM: u8 = 1;
const UNIT_SPEED: f32 = 0.1; // per tick at 60Hz
const APC_SPEED: f32 = UNIT_SPEED / 3.0;
const TOUCH_RADIUS: f32 = 0.5;
const TOUCH_RADIUS_SQ: f32 = TOUCH_RADIUS * TOUCH_RADIUS;
const UNIT_Y_OFFSET: f32 = 0.04;

/// Owns all simulation state inside WASM linear memory.
/// JS holds zero-copy Float32Array / Uint8Array views over the buffers
/// via the *_ptr() accessors — no per-frame copies across the boundary.
#[wasm_bindgen]
pub struct Sim {
    // --- unit buffers (SoA) ---
    positions: Vec<f32>, // xyz interleaved, len = max_units * 3
    states: Vec<u8>,
    target_x: Vec<f32>,
    target_z: Vec<f32>,
    count: usize,
    max_units: usize,

    // --- APC ---
    apc_x: f32,
    apc_y: f32,
    apc_z: f32,
    apc_target_x: f32,
    apc_target_z: f32,

    // --- terrain ---
    simplex: Simplex,
    seed_x: f64,
    seed_y: f64,
    scale: f64,
    height_mult: f32,
    heightmap: Vec<f32>,
    hm_width: usize,
    hm_height: usize,
    hm_half_w: f32, // world half-extent covered by the heightmap (x)
    hm_half_h: f32, // world half-extent covered by the heightmap (z)
    hm_cell_w: f32, // world units per heightmap cell along x
    hm_cell_h: f32, // world units per heightmap cell along z

    // --- wander bounds + RNG ---
    shard_half: f32, // random targets land in [-shard_half, shard_half]
    rng: u32,        // xorshift32 state
}

#[wasm_bindgen]
impl Sim {
    #[wasm_bindgen(constructor)]
    pub fn new(
        max_units: usize,
        noise_seed: u32,
        seed_x: f64,
        seed_y: f64,
        scale: f64,
        height_mult: f32,
        shard_half: f32,
        rng_seed: u32,
    ) -> Sim {
        Sim {
            positions: vec![0.0; max_units * 3],
            states: vec![SEEK_APC; max_units],
            target_x: vec![0.0; max_units],
            target_z: vec![0.0; max_units],
            count: 0,
            max_units,
            apc_x: 0.0,
            apc_y: 0.0,
            apc_z: 0.0,
            apc_target_x: 0.0,
            apc_target_z: 0.0,
            simplex: Simplex::new(noise_seed),
            seed_x,
            seed_y,
            scale,
            height_mult,
            heightmap: Vec::new(),
            hm_width: 0,
            hm_height: 0,
            hm_half_w: 0.0,
            hm_half_h: 0.0,
            hm_cell_w: 1.0,
            hm_cell_h: 1.0,
            shard_half,
            rng: rng_seed | 1, // xorshift must not start at 0
        }
    }

    // -------------------------------------------------------------------------
    // Terrain
    // -------------------------------------------------------------------------

    /// Raw simplex sample at world (x, z) — same convention as the old
    /// `sample_height`. Used for one-off queries; the hot loop uses the
    /// cached heightmap instead.
    pub fn sample_height(&self, x: f64, z: f64) -> f32 {
        self.simplex
            .get([(x + self.seed_x) * self.scale, (z + self.seed_y) * self.scale]) as f32
    }

    /// Generate and cache the heightmap over the provided world span.
    /// Grid resolution and world coverage are decoupled so callers can
    /// over-sample terrain features without changing play-area size.
    pub fn generate_heightmap(
        &mut self,
        grid_w: usize,
        grid_h: usize,
        world_w: f32,
        world_h: f32,
    ) {
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
                self.heightmap[row * grid_w + col] = self.simplex.get([
                    (wx as f64 + self.seed_x) * self.scale,
                    (wz as f64 + self.seed_y) * self.scale,
                ]) as f32;
            }
        }
    }

    /// Bilinear height lookup from the cached heightmap. ~10x cheaper than a
    /// simplex eval. Falls back to raw simplex outside the cached extent (or
    /// if generate_heightmap was never called).
    #[inline]
    fn height_at(&self, x: f32, z: f32) -> f32 {
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

        let top = h00 + (h10 - h00) * fx;
        let bot = h01 + (h11 - h01) * fx;
        top + (bot - top) * fz
    }

    // -------------------------------------------------------------------------
    // RNG — xorshift32, plenty for wander targets
    // -------------------------------------------------------------------------
    // #[inline]
    // fn next_rand(&mut self) -> f32 {
    //     let mut s = self.rng;
    //     s ^= s << 13;
    //     s ^= s >> 17;
    //     s ^= s << 5;
    //     self.rng = s;
    //     // map to [-1, 1)
    //     (s as f32 / u32::MAX as f32) * 2.0 - 1.0
    // }

    // -------------------------------------------------------------------------
    // Units
    // -------------------------------------------------------------------------

    /// Spawn a unit at (x, z), snapped to terrain. Returns the unit id,
    /// or -1 if the pool is full.
    pub fn spawn_unit(&mut self, x: f32, z: f32) -> i32 {
        if self.count >= self.max_units {
            return -1;
        }
        let id = self.count;
        let y = self.height_at(x, z) * self.height_mult + UNIT_Y_OFFSET;
        self.positions[id * 3] = x;
        self.positions[id * 3 + 1] = y;
        self.positions[id * 3 + 2] = z;
        self.states[id] = SEEK_APC;
        self.target_x[id] = 0.0;
        self.target_z[id] = 0.0;
        self.count += 1;
        id as i32
    }

    /// Batched simulation tick.
    /// - SEEK_APC: move toward APC; on arrival, pick a fresh per-unit random
    ///   target and switch to SEEK_RANDOM.
    /// - SEEK_RANDOM: move toward stored target; on arrival, switch back.
    /// - APC moves toward its own target at 1/3 unit speed.
    pub fn tick(&mut self, delta: f32) {
        // --- APC ---
        let apc_dx = self.apc_target_x - self.apc_x;
        let apc_dz = self.apc_target_z - self.apc_z;
        let apc_dist_sq = apc_dx * apc_dx + apc_dz * apc_dz;

        if apc_dist_sq >= TOUCH_RADIUS_SQ {
            let apc_dist = apc_dist_sq.sqrt();
            let step = (APC_SPEED * delta * 60.0).min(apc_dist);
            self.apc_x += apc_dx / apc_dist * step;
            self.apc_z += apc_dz / apc_dist * step;
        }
        self.apc_y = self.height_at(self.apc_x, self.apc_z) * self.height_mult;

        // Hoisted per-frame constants + locals to appease the borrow checker
        // inside the zipped loop.
        let step = UNIT_SPEED * delta * 60.0;
        let (apc_x, apc_z) = (self.apc_x, self.apc_z);
        let count = self.count;

        // Pre-roll wander targets lazily: we need &mut self for the RNG but
        // the loop mutably borrows the buffers, so split the borrows.
        let mut rng = self.rng;
        let mut next_rand = |state: &mut u32| -> f32 {
            let mut s = *state;
            s ^= s << 13;
            s ^= s >> 17;
            s ^= s << 5;
            *state = s;
            (s as f32 / u32::MAX as f32) * 2.0 - 1.0
        };

        // Split heightmap params out so the closure below doesn't need &self.
        let hm = &self.heightmap;
        let simplex = &self.simplex;
        let seed_x = self.seed_x;
        let seed_y = self.seed_y;
        let scale = self.scale;
        let (w, hgt) = (self.hm_width, self.hm_height);
        let (half_w, half_h) = (self.hm_half_w, self.hm_half_h);
        let (cell_w, cell_h) = (self.hm_cell_w, self.hm_cell_h);
        let height_mult = self.height_mult;

        let height_at = |x: f32, z: f32| -> f32 {
            if w < 2 || hgt < 2 {
                return simplex.get([
                    (x as f64 + seed_x) * scale,
                    (z as f64 + seed_y) * scale,
                ]) as f32;
            }

            let gx = (x + half_w) / cell_w;
            let gz = (z + half_h) / cell_h;
            if gx < 0.0 || gz < 0.0 || gx > (w - 1) as f32 || gz > (hgt - 1) as f32 {
                // Outside cached extent: clamp to edge rather than eval simplex
                // in the hot loop. Size the heightmap to cover the play area.
                let cx = gx.clamp(0.0, (w.max(2) - 1) as f32);
                let cz = gz.clamp(0.0, (hgt.max(2) - 1) as f32);
                let xi = (cx as usize).min(w - 1);
                let zi = (cz as usize).min(hgt - 1);
                return hm[zi * w + xi];
            }
            let x0 = gx as usize;
            let z0 = gz as usize;
            let x1 = (x0 + 1).min(w - 1);
            let z1 = (z0 + 1).min(hgt - 1);
            let fx = gx - x0 as f32;
            let fz = gz - z0 as f32;
            let h00 = hm[z0 * w + x0];
            let h10 = hm[z0 * w + x1];
            let h01 = hm[z1 * w + x0];
            let h11 = hm[z1 * w + x1];
            let top = h00 + (h10 - h00) * fx;
            let bot = h01 + (h11 - h01) * fx;
            top + (bot - top) * fz
        };

        let shard_half = self.shard_half;

        // chunks_exact_mut + zip lets the compiler elide bounds checks.
        for (((pos, state), tx), tz) in self
            .positions
            .chunks_exact_mut(3)
            .take(count)
            .zip(self.states.iter_mut().take(count))
            .zip(self.target_x.iter_mut().take(count))
            .zip(self.target_z.iter_mut().take(count))
        {
            let (goal_x, goal_z) = if *state == SEEK_APC {
                (apc_x, apc_z)
            } else {
                (*tx, *tz)
            };

            let dx = goal_x - pos[0];
            let dz = goal_z - pos[2];
            let dist_sq = dx * dx + dz * dz;

            if dist_sq < TOUCH_RADIUS_SQ {
                if *state == SEEK_APC {
                    *tx = next_rand(&mut rng) * shard_half;
                    *tz = next_rand(&mut rng) * shard_half;
                    *state = SEEK_RANDOM;
                } else {
                    *state = SEEK_APC;
                }
            } else {
                let inv_dist = 1.0 / dist_sq.sqrt();
                pos[0] += dx * inv_dist * step;
                pos[2] += dz * inv_dist * step;
                pos[1] = height_at(pos[0], pos[2]) * height_mult + UNIT_Y_OFFSET;
            }
        }

        self.rng = rng;
    }

    // -------------------------------------------------------------------------
    // Zero-copy accessors — JS builds TypedArray views over these.
    // -------------------------------------------------------------------------
    pub fn positions_ptr(&self) -> *const f32 { self.positions.as_ptr() }
    pub fn states_ptr(&self) -> *const u8 { self.states.as_ptr() }
    pub fn heightmap_ptr(&self) -> *const f32 { self.heightmap.as_ptr() }

    pub fn count(&self) -> usize { self.count }
    pub fn max_units(&self) -> usize { self.max_units }
    pub fn height_mult(&self) -> f32 { self.height_mult }

    pub fn apc_x(&self) -> f32 { self.apc_x }
    pub fn apc_y(&self) -> f32 { self.apc_y }
    pub fn apc_z(&self) -> f32 { self.apc_z }

    pub fn set_apc_target(&mut self, x: f32, z: f32) {
        self.apc_target_x = x;
        self.apc_target_z = z;
    }
}