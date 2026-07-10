use wasm_bindgen::prelude::*;

mod apc;
mod rng;
mod terrain;
mod units;

use apc::Apc;
use rng::Rng;
use terrain::Terrain;
use units::Units;

const SHARD_TRIGGER_MARGIN: f32 = 12.0;
// Crossing fires when the APC is within CROSS_BAND of the armed edge.
// Must be > the 0.5 target-clamp margin in set_apc_target, or the
// threshold is unreachable through legal input (the bug this fixes).
const CROSS_BAND: f32 = 1.5;

struct Shard {
    terrain: Terrain,
    row: i32,
    col: i32,
}

fn trigger_direction(ax: f32, az: f32, half_extent: f32) -> Option<(i32, i32)> {
    let trigger_edge = half_extent - SHARD_TRIGGER_MARGIN;
    let dc = if ax > trigger_edge {
        1
    } else if ax < -trigger_edge {
        -1
    } else {
        0
    };
    let dr = if az > trigger_edge {
        1
    } else if az < -trigger_edge {
        -1
    } else {
        0
    };

    if dc != 0 && dr != 0 {
        let x_proximity = ax.abs() - trigger_edge;
        let z_proximity = az.abs() - trigger_edge;
        if x_proximity >= z_proximity {
            Some((0, dc))
        } else {
            Some((dr, 0))
        }
    } else if dc != 0 || dr != 0 {
        Some((dr, dc))
    } else {
        None
    }
}

#[wasm_bindgen]
pub struct Sim {
    current: Shard,
    next: Option<Shard>,
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

        let current = Shard {
            terrain,
            row: 0,
            col: 0,
        };

        Sim {
            current,
            next: None,
            world_seed: noise_seed,
            units: Units::new(max_units, shard_half),
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
        self.next = None;
    }

    pub fn set_height_mult(&mut self, v: f32) {
        self.current.terrain.set_height_mult(v);
    }

    pub fn set_crag_strength(&mut self, v: f32) {
        self.current.terrain.set_crag_strength(v);
    }

    pub fn set_crag_freq(&mut self, v: f64) {
        self.current.terrain.set_crag_freq(v);
    }

    pub fn set_sweep_scale(&mut self, v: f64) {
        self.current.terrain.set_sweep_scale(v);
    }

    pub fn set_sweep_amp(&mut self, v: f32) {
        self.current.terrain.set_sweep_amp(v);
    }

    pub fn set_tier_height_scale(&mut self, v: f32) {
        self.current.terrain.set_tier_height_scale(v);
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

        if let Some(next) = &self.next {
            if let Some((dr, dc)) = current_trigger {
                let armed = (next.row - self.current.row, next.col - self.current.col);
                if armed != (dr, dc) {
                    self.next = None;
                }
            }
        }

        if self.next.is_none() && self.units.deployed_count() == 0 {
            if let Some((dr, dc)) = current_trigger {
                let next_row = self.current.row + dr;
                let next_col = self.current.col + dc;
                let terrain = self
                    .current
                    .terrain
                    .clone_params_for(self.world_seed, next_row, next_col);
                self.next = Some(Shard {
                    terrain,
                    row: next_row,
                    col: next_col,
                });
            }
        }

        let crossing_direction = self.next.as_ref().and_then(|next| {
            let dc = next.col - self.current.col;
            let dr = next.row - self.current.row;
            let crossed = (dc == 1 && ax > he - CROSS_BAND)
                || (dc == -1 && ax < -(he - CROSS_BAND))
                || (dr == 1 && az > he - CROSS_BAND)
                || (dr == -1 && az < -(he - CROSS_BAND));
            if crossed { Some((dr, dc)) } else { None }
        });

        if let Some((dr, dc)) = crossing_direction {
            let step = he * 2.0;
            let dx = -(dc as f32) * step;
            let dz = -(dr as f32) * step;
            self.apc.rebase(dx, dz);
            self.units.rebase(dx, dz);
            self.current = self.next.take().expect("next shard should exist during crossing");

            // Rebased position lands slightly OUTSIDE the new shard's near edge
            // (e.g. he - 1.5 - 2*he = -he - 1.5). Pull the APC just inside and
            // halt it so it awaits a fresh order in the new shard's frame.
            let he_new = self.current.terrain.half_extent();
            let (ax, az) = self.apc.position_xz();
            let cx = ax.clamp(-(he_new - 2.0), he_new - 2.0);
            let cz = az.clamp(-(he_new - 2.0), he_new - 2.0);
            self.apc.set_position(cx, cz);
            self.apc.set_target(cx, cz);
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

    pub fn steepness_at(&self, x: f32, z: f32) -> f32 {
        self.current.terrain.steepness_at(x, z)
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
        let margin = 0.5;
        self.apc.set_target(
            x.clamp(-(he - margin), he - margin),
            z.clamp(-(he - margin), he - margin),
        );
    }

    pub fn apc_touch_radius(&self) -> f32 {
        self.apc.touch_radius()
    }

    pub fn next_shard_ready(&self) -> bool {
        self.next.is_some()
    }

    pub fn next_shard_dc(&self) -> i32 {
        self.next
            .as_ref()
            .map_or(0, |n| n.col - self.current.col)
    }

    pub fn next_shard_dr(&self) -> i32 {
        self.next
            .as_ref()
            .map_or(0, |n| n.row - self.current.row)
    }

    pub fn next_heightmap_ptr(&self) -> *const f32 {
        self.next
            .as_ref()
            .map_or(std::ptr::null(), |n| n.terrain.heightmap_ptr())
    }

    pub fn next_slopemap_ptr(&self) -> *const f32 {
        self.next
            .as_ref()
            .map_or(std::ptr::null(), |n| n.terrain.slopemap_ptr())
    }

    pub fn current_shard_row(&self) -> i32 {
        self.current.row
    }

    pub fn current_shard_col(&self) -> i32 {
        self.current.col
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn build_sim(max_units: usize) -> Sim {
        Sim::new(
            max_units, 4242, 17.0, 29.0, 0.028, 5.2, 72.0, 72.0, 1.2, 2.1, 0.011, 0.2, 0.95,
            2026,
        )
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

    #[test]
    fn next_shard_generation_is_gated_by_boarded_units() {
        let mut sim = build_sim(8);
        assert_eq!(sim.spawn_unit(0.3, 0.0), 0);
        assert_eq!(sim.spawn_unit(-0.2, 0.2), 1);

        sim.set_apc_target(999.0, 0.0);
        for _ in 0..2_000 {
            sim.tick(1.0 / 60.0);
            assert!(
                !sim.next_shard_ready(),
                "next shard should not arm while units are deployed"
            );
        }

        sim.set_unit_recall(true);
        let boarded = tick_until(&mut sim, 10_000, |s| s.deployed_unit_count() == 0);
        assert!(boarded, "units never fully boarded under recall");

        let armed = tick_until(&mut sim, 500, |s| s.next_shard_ready());
        assert!(armed, "next shard failed to arm after all units were boarded");
    }

    #[test]
    fn crossing_rebases_apc_and_units_into_new_shard_frame() {
        let mut sim = build_sim(8);
        assert_eq!(sim.spawn_unit(0.3, 0.0), 0);
        sim.set_unit_recall(true);
        let boarded = tick_until(&mut sim, 10_000, |s| s.deployed_unit_count() == 0);
        assert!(boarded, "unit never boarded before crossing test");

        sim.set_apc_target(999.0, 0.0);
        let armed = tick_until(&mut sim, 2_000, |s| s.next_shard_ready());
        assert!(armed, "next shard never armed before crossing");

        let he = sim.current.terrain.half_extent();
        let step = he * 2.0;
        let (unit_x_before, _) = first_unit_xz(&sim);
        sim.set_apc_target(he + 12.0, 0.0);

        let crossed = tick_until(&mut sim, 2_000, |s| s.current_shard_col() == 1);
        assert!(crossed, "APC never crossed into the next shard");

        let apc_x = sim.apc_x();
        assert!(
            apc_x > -he && apc_x < 0.0,
            "APC should be rebased inside left bound after crossing: x={apc_x:.4} he={he:.4}"
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

        let armed = tick_until(&mut sim, 2_000, |s| s.next_shard_ready());
        assert!(armed, "next shard never armed");

        let he = sim.current.terrain.half_extent();
        sim.set_apc_target(he + 12.0, 0.0);
        let crossed = tick_until(&mut sim, 2_000, |s| s.current_shard_col() == 1);
        assert!(crossed, "APC never crossed into expected shard");

        let h = sim.sample_height(sim.apc_x() as f64, sim.apc_z() as f64);
        assert!(h.is_finite(), "height at APC became non-finite after crossing");
        assert_eq!(sim.current_shard_row(), 0);
        assert_eq!(sim.current_shard_col(), 1);
    }
}