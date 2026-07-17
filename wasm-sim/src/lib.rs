use wasm_bindgen::prelude::*;

mod apc;
mod rng;
mod shard_ring;
mod terrain;
mod units;

#[cfg(test)]
mod shard_ring_tests;

use apc::Apc;
use rng::Rng;
use shard_ring::{crossing_direction, trigger_direction, Shard, NEIGHBOR_OFFSETS};
use units::Units;

#[wasm_bindgen]
pub struct Sim {
    current: Shard,
    neighbors: [Option<Shard>; 8],
    world_seed: u32,
    units: Units,
    apc: Apc,
    rng: Rng,
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
        unit_wander_radius: f32,
        terrain_half_extent: f32,
        crag_strength: f32,
        crag_freq: f64,
        sweep_scale: f64,
        sweep_amp: f32,
        tier_height_scale: f32,
        rng_seed: u32,
    ) -> Sim {
        let mut terrain = terrain::Terrain::new(
            noise_seed,
            seed_x,
            seed_y,
            scale,
            height_mult,
            crag_strength,
            crag_freq,
            sweep_scale,
            sweep_amp,
            tier_height_scale,
        );
        terrain.generate_heightmap(0, 0, terrain_half_extent * 2.0, terrain_half_extent * 2.0);
        terrain.regenerate(noise_seed, 0, 0);

        let current = Shard {
            terrain,
            row: 0,
            col: 0,
        };

        Sim {
            current,
            neighbors: std::array::from_fn(|_| None),
            world_seed: noise_seed,
            units: Units::new(max_units, unit_wander_radius),
            apc: Apc::new(),
            rng: Rng::new(rng_seed),
        }
    }

    pub fn sample_height(&self, x: f64, z: f64) -> f32 {
        self.current.terrain.sample_height(x, z)
    }

    pub fn generate_heightmap(
        &mut self,
        grid_w: usize,
        grid_h: usize,
        world_w: f32,
        world_h: f32,
    ) {
        self.current
            .terrain
            .generate_heightmap(grid_w, grid_h, world_w, world_h);
    }

    pub fn generate_slopemap(&mut self) {
        self.current.terrain.generate_slopemap();
    }

    pub fn regenerate_terrain(&mut self, noise_seed: u32) {
        self.world_seed = noise_seed;
        self.current
            .terrain
            .regenerate(noise_seed, self.current.row, self.current.col);
        self.clear_neighbors();
    }

    pub fn set_height_mult(&mut self, v: f32) {
        self.current.terrain.set_height_mult(v);
        self.clear_neighbors();
    }

    pub fn set_crag_strength(&mut self, v: f32) {
        self.current.terrain.set_crag_strength(v);
        self.clear_neighbors();
    }

    pub fn set_crag_freq(&mut self, v: f64) {
        self.current.terrain.set_crag_freq(v);
        self.clear_neighbors();
    }

    pub fn set_sweep_scale(&mut self, v: f64) {
        self.current.terrain.set_sweep_scale(v);
        self.clear_neighbors();
    }

    pub fn set_sweep_amp(&mut self, v: f32) {
        self.current.terrain.set_sweep_amp(v);
        self.clear_neighbors();
    }

    pub fn set_tier_height_scale(&mut self, v: f32) {
        self.current.terrain.set_tier_height_scale(v);
        self.clear_neighbors();
    }

    pub fn spawn_unit(&mut self, x: f32, z: f32) -> i32 {
        self.units.spawn_unit(x, z, &self.current.terrain)
    }

    pub fn set_unit_recall(&mut self, active: bool) {
        self.units.set_recall(active);
    }

    pub fn deployed_unit_count(&self) -> usize {
        self.units.deployed_count()
    }

    pub fn deploy_all_units(&mut self) {
        self.units.deploy_all();
    }

    pub fn tick(&mut self, delta: f32) {
        self.apc.tick(delta, &self.current.terrain);
        self.units
            .tick(delta, self.apc.position_xz(), &self.current.terrain, &mut self.rng);

        let (ax, az) = self.apc.position_xz();
        let he = self.current.terrain.half_extent();
        let current_trigger = trigger_direction(ax, az, he);

        if let Some((trigger_dr, trigger_dc)) = current_trigger {
            if self.backfill_neighbor(trigger_dr, trigger_dc) {
                return;
            }
        }

        for (dr, dc) in NEIGHBOR_OFFSETS {
            if current_trigger == Some((dr, dc)) {
                continue;
            }
            if self.backfill_neighbor(dr, dc) {
                return;
            }
        }

        if self.units.deployed_count() == 0 {
            if let Some((dr, dc)) = crossing_direction(ax, az, he) {
                let step = he * 2.0;
                let dx = -(dc as f32) * step;
                let dz = -(dr as f32) * step;
                self.apc.rebase(dx, dz);
                self.units.rebase(dx, dz);

                let target = self.take_or_generate_neighbor(dr, dc);
                let old_current = std::mem::replace(&mut self.current, target);
                self.rekey_neighbors(old_current);
            }
        }
    }

    pub fn positions_ptr(&self) -> *const f32 {
        self.units.positions_ptr()
    }

    pub fn states_ptr(&self) -> *const u8 {
        self.units.states_ptr()
    }

    pub fn heightmap_ptr(&self) -> *const f32 {
        self.current.terrain.heightmap_ptr()
    }

    pub fn slopemap_ptr(&self) -> *const f32 {
        self.current.terrain.slopemap_ptr()
    }

    pub fn count(&self) -> usize {
        self.units.count()
    }

    pub fn max_units(&self) -> usize {
        self.units.max_units()
    }

    pub fn height_mult(&self) -> f32 {
        self.current.terrain.height_mult()
    }

    pub fn zone_at(&self, x: f32, z: f32) -> u8 {
        self.current.terrain.zone_at(x, z)
    }

    pub fn slope_degrees_at(&self, x: f32, z: f32) -> f32 {
        self.current.terrain.slope_degrees_at(x, z)
    }

    pub fn is_structure_viable(&self, x: f32, z: f32) -> bool {
        self.current.terrain.is_structure_viable(x, z)
    }

    pub fn apc_x(&self) -> f32 {
        self.apc.x()
    }

    pub fn apc_y(&self) -> f32 {
        self.apc.y()
    }

    pub fn apc_z(&self) -> f32 {
        self.apc.z()
    }

    pub fn apc_target_x(&self) -> f32 {
        self.apc.target_x()
    }

    pub fn apc_target_z(&self) -> f32 {
        self.apc.target_z()
    }

    pub fn set_apc_target(&mut self, x: f32, z: f32) {
        let he = self.current.terrain.half_extent();
        let m = 0.5;
        let reach = 3.0 * he - m;
        let mut tx = x.clamp(-reach, reach);
        let mut tz = z.clamp(-reach, reach);
        // Diagonal guard: crossing is cardinal-only. If the target exceeds
        // the current shard on BOTH axes, pull the lesser-overshoot axis
        // back inside so the path resolves to a cardinal neighbor.
        let ox = (tx.abs() - he).max(0.0);
        let oz = (tz.abs() - he).max(0.0);
        if ox > 0.0 && oz > 0.0 {
            if ox >= oz {
                tz = tz.clamp(-(he - m), he - m);
            } else {
                tx = tx.clamp(-(he - m), he - m);
            }
        }
        self.apc.set_target(tx, tz);
    }

    pub fn apc_touch_radius(&self) -> f32 {
        self.apc.touch_radius()
    }

    pub fn neighbor_ready(&self, dr: i32, dc: i32) -> bool {
        self.neighbor_shard(dr, dc).is_some()
    }

    pub fn neighbor_heightmap_ptr(&self, dr: i32, dc: i32) -> *const f32 {
        self.neighbor_shard(dr, dc)
            .map_or(std::ptr::null(), |neighbor| neighbor.terrain.heightmap_ptr())
    }

    pub fn neighbor_slopemap_ptr(&self, dr: i32, dc: i32) -> *const f32 {
        self.neighbor_shard(dr, dc)
            .map_or(std::ptr::null(), |neighbor| neighbor.terrain.slopemap_ptr())
    }

    pub fn current_shard_row(&self) -> i32 {
        self.current.row
    }

    pub fn current_shard_col(&self) -> i32 {
        self.current.col
    }
}
