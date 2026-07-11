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
const NEIGHBOR_OFFSETS: [(i32, i32); 8] = [
    (0, 1),
    (0, -1),
    (1, 0),
    (-1, 0),
    (1, 1),
    (1, -1),
    (-1, 1),
    (-1, -1),
];

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

fn slot_index(dr: i32, dc: i32) -> Option<usize> {
    NEIGHBOR_OFFSETS
        .iter()
        .position(|&(offset_dr, offset_dc)| (offset_dr, offset_dc) == (dr, dc))
}

fn crossing_direction(ax: f32, az: f32, half_extent: f32) -> Option<(i32, i32)> {
    let dc = if ax > half_extent {
        1
    } else if ax < -half_extent {
        -1
    } else {
        0
    };
    let dr = if az > half_extent {
        1
    } else if az < -half_extent {
        -1
    } else {
        0
    };

    if dc != 0 && dr != 0 {
        let x_overshoot = ax.abs() - half_extent;
        let z_overshoot = az.abs() - half_extent;
        if x_overshoot >= z_overshoot {
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

impl Sim {
    fn clear_neighbors(&mut self) {
        for slot in &mut self.neighbors {
            *slot = None;
        }
    }

    fn neighbor_shard(&self, dr: i32, dc: i32) -> Option<&Shard> {
        slot_index(dr, dc).and_then(|index| self.neighbors[index].as_ref())
    }

    fn backfill_neighbor(&mut self, dr: i32, dc: i32) -> bool {
        let Some(index) = slot_index(dr, dc) else {
            return false;
        };
        if self.neighbors[index].is_some() {
            return false;
        }

        let row = self.current.row + dr;
        let col = self.current.col + dc;
        let terrain = self
            .current
            .terrain
            .clone_params_for(self.world_seed, row, col);
        self.neighbors[index] = Some(Shard { terrain, row, col });
        true
    }

    fn take_or_generate_neighbor(&mut self, dr: i32, dc: i32) -> Shard {
        let row = self.current.row + dr;
        let col = self.current.col + dc;

        if let Some(index) = slot_index(dr, dc) {
            if let Some(shard) = self.neighbors[index].take() {
                return shard;
            }
        }

        Shard {
            terrain: self
                .current
                .terrain
                .clone_params_for(self.world_seed, row, col),
            row,
            col,
        }
    }

    fn rekey_neighbors(&mut self, old_current: Shard) {
        let mut drained = Vec::with_capacity(NEIGHBOR_OFFSETS.len() + 1);
        drained.push(old_current);
        for slot in &mut self.neighbors {
            if let Some(shard) = slot.take() {
                drained.push(shard);
            }
        }

        for shard in drained {
            let dr = shard.row - self.current.row;
            let dc = shard.col - self.current.col;
            if let Some(index) = slot_index(dr, dc) {
                assert!(
                    self.neighbors[index].is_none(),
                    "rekey collision for neighbor slot ({dr}, {dc})"
                );
                self.neighbors[index] = Some(shard);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEST_HEIGHTMAP_W: usize = 145;
    const TEST_HEIGHTMAP_H: usize = 145;
    const TEST_HEIGHTMAP_LEN: usize = TEST_HEIGHTMAP_W * TEST_HEIGHTMAP_H;

    fn build_sim(max_units: usize) -> Sim {
        let mut sim = Sim::new(
            max_units, 4242, 17.0, 29.0, 0.028, 5.2, 72.0, 72.0, 1.2, 2.1, 0.011, 0.2, 0.95,
            2026,
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
}