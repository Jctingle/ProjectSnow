use wasm_bindgen::prelude::*;

mod apc;
mod rng;
mod terrain;
mod units;

use apc::Apc;
use rng::Rng;
use terrain::Terrain;
use units::Units;

#[wasm_bindgen]
pub struct Sim {
    terrain: Terrain,
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
        shard_half: f32,
        terrain_half_extent: f32,
        crag_strength: f32,
        crag_freq: f64,
        sweep_scale: f64,
        sweep_amp: f32,
        tier_height_scale: f32,
        rng_seed: u32,
    ) -> Sim {
        let mut terrain = Terrain::new(
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

        Sim {
            terrain,
            units: Units::new(max_units, shard_half),
            apc: Apc::new(),
            rng: Rng::new(rng_seed),
        }
    }

    pub fn sample_height(&self, x: f64, z: f64) -> f32 {
        self.terrain.sample_height(x, z)
    }

    pub fn generate_heightmap(
        &mut self,
        grid_w: usize,
        grid_h: usize,
        world_w: f32,
        world_h: f32,
    ) {
        self.terrain
            .generate_heightmap(grid_w, grid_h, world_w, world_h);
    }

    pub fn generate_slopemap(&mut self) {
        self.terrain.generate_slopemap();
    }

    pub fn regenerate_terrain(&mut self, noise_seed: u32) {
        self.terrain.regenerate(noise_seed, 0, 0);
    }

    pub fn set_height_mult(&mut self, v: f32) {
        self.terrain.set_height_mult(v);
    }

    pub fn set_crag_strength(&mut self, v: f32) {
        self.terrain.set_crag_strength(v);
    }

    pub fn set_crag_freq(&mut self, v: f64) {
        self.terrain.set_crag_freq(v);
    }

    pub fn set_sweep_scale(&mut self, v: f64) {
        self.terrain.set_sweep_scale(v);
    }

    pub fn set_sweep_amp(&mut self, v: f32) {
        self.terrain.set_sweep_amp(v);
    }

    pub fn set_tier_height_scale(&mut self, v: f32) {
        self.terrain.set_tier_height_scale(v);
    }

    pub fn spawn_unit(&mut self, x: f32, z: f32) -> i32 {
        self.units.spawn_unit(x, z, &self.terrain)
    }

    pub fn tick(&mut self, delta: f32) {
        self.apc.tick(delta, &self.terrain);
        self.units
            .tick(delta, self.apc.position_xz(), &self.terrain, &mut self.rng);
    }

    pub fn positions_ptr(&self) -> *const f32 {
        self.units.positions_ptr()
    }

    pub fn states_ptr(&self) -> *const u8 {
        self.units.states_ptr()
    }

    pub fn heightmap_ptr(&self) -> *const f32 {
        self.terrain.heightmap_ptr()
    }

    pub fn slopemap_ptr(&self) -> *const f32 {
        self.terrain.slopemap_ptr()
    }

    pub fn count(&self) -> usize {
        self.units.count()
    }

    pub fn max_units(&self) -> usize {
        self.units.max_units()
    }

    pub fn height_mult(&self) -> f32 {
        self.terrain.height_mult()
    }

    pub fn zone_at(&self, x: f32, z: f32) -> u8 {
        self.terrain.zone_at(x, z)
    }

    pub fn steepness_at(&self, x: f32, z: f32) -> f32 {
        self.terrain.steepness_at(x, z)
    }

    pub fn is_structure_viable(&self, x: f32, z: f32) -> bool {
        self.terrain.is_structure_viable(x, z)
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

    pub fn set_apc_target(&mut self, x: f32, z: f32) {
        self.apc.set_target(x, z);
    }

    pub fn apc_touch_radius(&self) -> f32 {
        self.apc.touch_radius()
    }
}