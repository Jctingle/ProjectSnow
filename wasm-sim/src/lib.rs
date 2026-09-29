use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};

mod apc;
mod apc_interior;
mod lattice;
mod machines;
mod rng;
mod shard_ring;
mod subgrid;
mod terrain;
mod world_nodes;

#[cfg(test)]
mod shard_ring_tests;
#[cfg(test)]
mod snapshot_tests;

use apc::Apc;
use shard_ring::{crossing_direction, trigger_direction, Shard, NEIGHBOR_OFFSETS};
use world_nodes::WorldNodes;

const SIM_SNAPSHOT_FORMAT_VERSION: u32 = 1;
const SIM_SNAPSHOT_CONTENT_VERSION: u32 = 1;

#[derive(Serialize, Deserialize)]
struct SimSnapshotEnvelope {
    format_version: u32,
    content_version: u32,
    payload: SimSnapshotPayload,
}

#[derive(Serialize, Deserialize)]
struct SimSnapshotPayload {
    world_seed: u32,
    current_row: i32,
    current_col: i32,
    loaded_neighbors: Vec<NeighborOffset>,
    terrain: TerrainSnapshot,
    apc: ApcSnapshot,
}

#[derive(Serialize, Deserialize)]
struct NeighborOffset {
    dr: i32,
    dc: i32,
}

#[derive(Serialize, Deserialize)]
struct TerrainSnapshot {
    seed_x: f64,
    seed_y: f64,
    base_seed_x: f64,
    base_seed_y: f64,
    noise_scale: f64,
    height_mult: f32,
    crag_strength: f32,
    crag_freq: f64,
    sweep_scale: f64,
    sweep_amp: f32,
    tier_height_scale: f32,
    heightmap_width: usize,
    heightmap_height: usize,
    heightmap_world_width: f32,
    heightmap_world_height: f32,
}

#[derive(Serialize, Deserialize)]
struct ApcSnapshot {
    x: f32,
    y: f32,
    z: f32,
    target_x: f32,
    target_z: f32,
    speed: f32,
    cliff_threshold_deg: f32,
    target_requires_shard_crossing: bool,
}

#[wasm_bindgen]
pub struct Sim {
    current: Shard,
    neighbors: [Option<Shard>; 8],
    world_seed: u32,
    apc: Apc,
}

#[wasm_bindgen]
impl Sim {
    #[wasm_bindgen(constructor)]
    pub fn new(
        noise_seed: u32,
        seed_x: f64,
        seed_y: f64,
        scale: f64,
        height_mult: f32,
        terrain_half_extent: f32,
        crag_strength: f32,
        crag_freq: f64,
        sweep_scale: f64,
        sweep_amp: f32,
        tier_height_scale: f32,
        apc_speed: f32,
        apc_cliff_threshold_deg: f32,
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
        let world_nodes = WorldNodes::generate(noise_seed, 0, 0, &terrain);

        let current = Shard {
            terrain,
            world_nodes,
            row: 0,
            col: 0,
        };

        Sim {
            current,
            neighbors: std::array::from_fn(|_| None),
            world_seed: noise_seed,
            apc: Apc::new(apc_speed, apc_cliff_threshold_deg),
        }
    }

    pub fn sample_height(&self, x: f64, z: f64) -> f32 {
        self.current.terrain.sample_height(x, z)
    }

    pub fn height_at_or_sample(&self, x: f32, z: f32) -> f32 {
        self.current.terrain.height_at_or_sample(x, z)
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

    pub fn generate_access_hillmap(&mut self) {
        self.current.terrain.generate_access_hillmap();
    }

    pub fn regenerate_terrain(&mut self, noise_seed: u32) {
        self.world_seed = noise_seed;
        self.current
            .terrain
            .regenerate(noise_seed, self.current.row, self.current.col);
        self.regenerate_current_world_nodes();
        self.clear_neighbors();
    }

    pub fn set_height_mult(&mut self, v: f32) {
        self.current.terrain.set_height_mult(v);
        self.regenerate_current_world_nodes();
        self.clear_neighbors();
    }

    pub fn set_crag_strength(&mut self, v: f32) {
        self.current.terrain.set_crag_strength(v);
        self.regenerate_current_world_nodes();
        self.clear_neighbors();
    }

    pub fn set_crag_freq(&mut self, v: f64) {
        self.current.terrain.set_crag_freq(v);
        self.regenerate_current_world_nodes();
        self.clear_neighbors();
    }

    pub fn set_sweep_scale(&mut self, v: f64) {
        self.current.terrain.set_sweep_scale(v);
        self.regenerate_current_world_nodes();
        self.clear_neighbors();
    }

    pub fn set_sweep_amp(&mut self, v: f32) {
        self.current.terrain.set_sweep_amp(v);
        self.regenerate_current_world_nodes();
        self.clear_neighbors();
    }

    pub fn set_tier_height_scale(&mut self, v: f32) {
        self.current.terrain.set_tier_height_scale(v);
        self.regenerate_current_world_nodes();
        self.clear_neighbors();
    }

    pub fn set_apc_speed(&mut self, v: f32) {
        self.apc.set_speed(v);
    }

    pub fn set_apc_cliff_threshold_deg(&mut self, v: f32) {
        self.apc.set_cliff_threshold_deg(v);
    }

    pub fn tick(&mut self, delta: f32) {
        self.apc.tick(delta, &self.current.terrain);

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

        if let Some((dr, dc)) = crossing_direction(ax, az, he) {
            let step = he * 2.0;
            let dx = -(dc as f32) * step;
            let dz = -(dr as f32) * step;
            self.apc.rebase(dx, dz);

            let target = self.take_or_generate_neighbor(dr, dc);
            let old_current = std::mem::replace(&mut self.current, target);
            self.rekey_neighbors(old_current);
        }
    }

    pub fn heightmap_ptr(&self) -> *const f32 {
        self.current.terrain.heightmap_ptr()
    }

    pub fn slopemap_ptr(&self) -> *const f32 {
        self.current.terrain.slopemap_ptr()
    }

    pub fn access_hillmap_ptr(&self) -> *const f32 {
        self.current.terrain.access_hillmap_ptr()
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
        let requires_shard_crossing = tx.abs() > he || tz.abs() > he;
        self.apc.set_target(tx, tz, requires_shard_crossing);
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

    pub fn neighbor_access_hillmap_ptr(&self, dr: i32, dc: i32) -> *const f32 {
        self.neighbor_shard(dr, dc)
            .map_or(std::ptr::null(), |neighbor| neighbor.terrain.access_hillmap_ptr())
    }

    pub fn world_node_count(&self) -> usize {
        self.current.world_nodes.count()
    }

    pub fn world_node_ids_ptr(&self) -> *const u32 {
        self.current.world_nodes.ids_ptr()
    }

    pub fn world_node_categories_ptr(&self) -> *const u8 {
        self.current.world_nodes.categories_ptr()
    }

    pub fn world_node_subtypes_ptr(&self) -> *const u8 {
        self.current.world_nodes.subtypes_ptr()
    }

    pub fn world_node_x_ptr(&self) -> *const f32 {
        self.current.world_nodes.x_ptr()
    }

    pub fn world_node_z_ptr(&self) -> *const f32 {
        self.current.world_nodes.z_ptr()
    }

    pub fn world_node_radius_or_w_ptr(&self) -> *const f32 {
        self.current.world_nodes.radius_or_w_ptr()
    }

    pub fn world_node_depth_or_h_ptr(&self) -> *const f32 {
        self.current.world_nodes.depth_or_h_ptr()
    }

    pub fn world_node_seeds_ptr(&self) -> *const u32 {
        self.current.world_nodes.seeds_ptr()
    }

    pub fn world_node_flags_ptr(&self) -> *const u32 {
        self.current.world_nodes.flags_ptr()
    }

    pub fn neighbor_world_node_count(&self, dr: i32, dc: i32) -> usize {
        self.neighbor_shard(dr, dc)
            .map_or(0, |neighbor| neighbor.world_nodes.count())
    }

    pub fn neighbor_world_node_ids_ptr(&self, dr: i32, dc: i32) -> *const u32 {
        self.neighbor_shard(dr, dc)
            .map_or(std::ptr::null(), |neighbor| neighbor.world_nodes.ids_ptr())
    }

    pub fn neighbor_world_node_categories_ptr(&self, dr: i32, dc: i32) -> *const u8 {
        self.neighbor_shard(dr, dc)
            .map_or(std::ptr::null(), |neighbor| neighbor.world_nodes.categories_ptr())
    }

    pub fn neighbor_world_node_subtypes_ptr(&self, dr: i32, dc: i32) -> *const u8 {
        self.neighbor_shard(dr, dc)
            .map_or(std::ptr::null(), |neighbor| neighbor.world_nodes.subtypes_ptr())
    }

    pub fn neighbor_world_node_x_ptr(&self, dr: i32, dc: i32) -> *const f32 {
        self.neighbor_shard(dr, dc)
            .map_or(std::ptr::null(), |neighbor| neighbor.world_nodes.x_ptr())
    }

    pub fn neighbor_world_node_z_ptr(&self, dr: i32, dc: i32) -> *const f32 {
        self.neighbor_shard(dr, dc)
            .map_or(std::ptr::null(), |neighbor| neighbor.world_nodes.z_ptr())
    }

    pub fn neighbor_world_node_radius_or_w_ptr(&self, dr: i32, dc: i32) -> *const f32 {
        self.neighbor_shard(dr, dc)
            .map_or(std::ptr::null(), |neighbor| neighbor.world_nodes.radius_or_w_ptr())
    }

    pub fn neighbor_world_node_depth_or_h_ptr(&self, dr: i32, dc: i32) -> *const f32 {
        self.neighbor_shard(dr, dc)
            .map_or(std::ptr::null(), |neighbor| neighbor.world_nodes.depth_or_h_ptr())
    }

    pub fn neighbor_world_node_seeds_ptr(&self, dr: i32, dc: i32) -> *const u32 {
        self.neighbor_shard(dr, dc)
            .map_or(std::ptr::null(), |neighbor| neighbor.world_nodes.seeds_ptr())
    }

    pub fn neighbor_world_node_flags_ptr(&self, dr: i32, dc: i32) -> *const u32 {
        self.neighbor_shard(dr, dc)
            .map_or(std::ptr::null(), |neighbor| neighbor.world_nodes.flags_ptr())
    }

    pub fn current_shard_row(&self) -> i32 {
        self.current.row
    }

    pub fn current_shard_col(&self) -> i32 {
        self.current.col
    }

    pub fn export_snapshot_json(&self) -> String {
        let loaded_neighbors = NEIGHBOR_OFFSETS
            .iter()
            .filter_map(|(dr, dc)| {
                if self.neighbor_shard(*dr, *dc).is_some() {
                    Some(NeighborOffset { dr: *dr, dc: *dc })
                } else {
                    None
                }
            })
            .collect::<Vec<NeighborOffset>>();

        let payload = SimSnapshotPayload {
            world_seed: self.world_seed,
            current_row: self.current.row,
            current_col: self.current.col,
            loaded_neighbors,
            terrain: TerrainSnapshot {
                seed_x: self.current.terrain.seed_x(),
                seed_y: self.current.terrain.seed_y(),
                base_seed_x: self.current.terrain.base_seed_x(),
                base_seed_y: self.current.terrain.base_seed_y(),
                noise_scale: self.current.terrain.noise_scale(),
                height_mult: self.current.terrain.height_mult(),
                crag_strength: self.current.terrain.crag_strength(),
                crag_freq: self.current.terrain.crag_freq(),
                sweep_scale: self.current.terrain.sweep_scale(),
                sweep_amp: self.current.terrain.sweep_amp(),
                tier_height_scale: self.current.terrain.tier_height_scale(),
                heightmap_width: self.current.terrain.heightmap_width(),
                heightmap_height: self.current.terrain.heightmap_height(),
                heightmap_world_width: self.current.terrain.heightmap_world_width(),
                heightmap_world_height: self.current.terrain.heightmap_world_height(),
            },
            apc: ApcSnapshot {
                x: self.apc.x(),
                y: self.apc.y(),
                z: self.apc.z(),
                target_x: self.apc.target_x(),
                target_z: self.apc.target_z(),
                speed: self.apc.speed(),
                cliff_threshold_deg: self.apc.cliff_threshold_deg(),
                target_requires_shard_crossing: self.apc.target_requires_shard_crossing(),
            },
        };

        let envelope = SimSnapshotEnvelope {
            format_version: SIM_SNAPSHOT_FORMAT_VERSION,
            content_version: SIM_SNAPSHOT_CONTENT_VERSION,
            payload,
        };

        serde_json::to_string(&envelope).unwrap_or_else(|_| String::from(""))
    }

    /// Returns empty string on success, otherwise a human-readable error.
    pub fn import_snapshot_json(&mut self, snapshot_json: &str) -> String {
        match self.restore_from_snapshot_json(snapshot_json) {
            Ok(()) => String::new(),
            Err(message) => message,
        }
    }
}

impl Sim {
    fn restore_from_snapshot_json(&mut self, snapshot_json: &str) -> Result<(), String> {
        let envelope: SimSnapshotEnvelope =
            serde_json::from_str(snapshot_json).map_err(|_| String::from("snapshot decode failed"))?;
        if envelope.format_version != SIM_SNAPSHOT_FORMAT_VERSION {
            return Err(String::from("unsupported sim snapshot format version"));
        }
        if envelope.content_version != SIM_SNAPSHOT_CONTENT_VERSION {
            return Err(String::from("unsupported sim snapshot content version"));
        }

        let payload = envelope.payload;
        if payload.loaded_neighbors.len() > NEIGHBOR_OFFSETS.len() {
            return Err(String::from("too many loaded neighbor entries"));
        }
        if payload.terrain.heightmap_width == 0
            || payload.terrain.heightmap_height == 0
            || payload.terrain.heightmap_world_width <= 0.0
            || payload.terrain.heightmap_world_height <= 0.0
        {
            return Err(String::from("heightmap dimensions invalid"));
        }

        let mut neighbor_keys = std::collections::BTreeSet::new();
        for offset in &payload.loaded_neighbors {
            if shard_ring::slot_index(offset.dr, offset.dc).is_none() {
                return Err(String::from("invalid neighbor offset"));
            }
            if !neighbor_keys.insert((offset.dr, offset.dc)) {
                return Err(String::from("duplicate neighbor offset"));
            }
        }

        let mut terrain = terrain::Terrain::new(
            payload.world_seed,
            payload.terrain.base_seed_x,
            payload.terrain.base_seed_y,
            payload.terrain.noise_scale,
            payload.terrain.height_mult,
            payload.terrain.crag_strength,
            payload.terrain.crag_freq,
            payload.terrain.sweep_scale,
            payload.terrain.sweep_amp,
            payload.terrain.tier_height_scale,
        );
        terrain.generate_heightmap(
            payload.terrain.heightmap_width,
            payload.terrain.heightmap_height,
            payload.terrain.heightmap_world_width,
            payload.terrain.heightmap_world_height,
        );
        terrain.regenerate(payload.world_seed, payload.current_row, payload.current_col);
        terrain.generate_access_hillmap();
        terrain.generate_slopemap();

        let seed_match = (terrain.seed_x() - payload.terrain.seed_x).abs() <= 1e-9
            && (terrain.seed_y() - payload.terrain.seed_y).abs() <= 1e-9;
        if !seed_match {
            return Err(String::from("terrain seed offsets mismatch"));
        }

        let world_nodes = WorldNodes::generate(
            payload.world_seed,
            payload.current_row,
            payload.current_col,
            &terrain,
        );

        self.world_seed = payload.world_seed;
        self.current = Shard {
            terrain,
            world_nodes,
            row: payload.current_row,
            col: payload.current_col,
        };
        self.clear_neighbors();
        for offset in &payload.loaded_neighbors {
            let _ = self.backfill_neighbor(offset.dr, offset.dc);
        }

        self.apc.restore_state(
            payload.apc.x,
            payload.apc.y,
            payload.apc.z,
            payload.apc.target_x,
            payload.apc.target_z,
            payload.apc.speed,
            payload.apc.cliff_threshold_deg,
            payload.apc.target_requires_shard_crossing,
        );
        Ok(())
    }

    fn regenerate_current_world_nodes(&mut self) {
        self.current.world_nodes = WorldNodes::generate(
            self.world_seed,
            self.current.row,
            self.current.col,
            &self.current.terrain,
        );
    }
}
