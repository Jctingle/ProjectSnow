use crate::rng::{cell_seed, Rng};
use crate::terrain::Terrain;

pub(crate) const MAX_WORLD_NODES_PER_SHARD: usize = 32;
const LAYER_WORLD_NODES: u32 = 2;
const STRUCTURE_EDGE_MARGIN: f32 = 10.0;
const STRUCTURE_ATTEMPTS: usize = 10;
const SCRAP_CANDIDATES_PER_NODE: usize = 12;
const SCRAP_RADIUS_MIN: f32 = 2.0;
const SCRAP_RADIUS_MAX: f32 = 5.0;
const SCRAP_DEPTH_MIN: f32 = 2.0;
const SCRAP_DEPTH_MAX: f32 = 5.5;
const SCRAP_ZONE_NON_LOWLAND_PENALTY: f32 = 10.0;
const SCRAP_HEIGHT_WEIGHT: f32 = 2.25;
const SCRAP_SLOPE_WEIGHT: f32 = 1.0;
const SCRAP_STRUCTURE_CLEARANCE: f32 = 14.0;
const SCRAP_MIN_SPACING: f32 = SCRAP_RADIUS_MAX * 2.4;
const SCRAP_FLATNESS_SAMPLE_EPS: f32 = 1.0;
pub(crate) const SCRAP_MAX_SLOPE_DEG: f32 = 18.0;

pub(crate) mod category {
    pub(crate) const STRUCTURE: u8 = 1;
    pub(crate) const METAL_SCRAP: u8 = 2;
}

pub(crate) mod subtype {
    pub(crate) const RESERVED: u8 = 0;
    pub(crate) const SCRAP_FIELD: u8 = 1;
}

pub(crate) struct WorldNodes {
    count: usize,
    ids: [u32; MAX_WORLD_NODES_PER_SHARD],
    categories: [u8; MAX_WORLD_NODES_PER_SHARD],
    subtypes: [u8; MAX_WORLD_NODES_PER_SHARD],
    x: [f32; MAX_WORLD_NODES_PER_SHARD],
    z: [f32; MAX_WORLD_NODES_PER_SHARD],
    radius_or_w: [f32; MAX_WORLD_NODES_PER_SHARD],
    depth_or_h: [f32; MAX_WORLD_NODES_PER_SHARD],
    seeds: [u32; MAX_WORLD_NODES_PER_SHARD],
    flags: [u32; MAX_WORLD_NODES_PER_SHARD],
}

impl WorldNodes {
    pub(crate) fn generate(world_seed: u32, row: i32, col: i32, terrain: &Terrain) -> Self {
        let mut nodes = Self::default();
        let mut rng = Rng::new(cell_seed(world_seed, row, col, LAYER_WORLD_NODES));
        let half_extent = terrain.half_extent();

        nodes.generate_reserved_structure_slot(world_seed, row, col, terrain, half_extent, &mut rng);
        nodes.generate_scrap_fields(world_seed, row, col, terrain, half_extent, &mut rng);
        nodes
    }

    pub(crate) fn count(&self) -> usize {
        self.count
    }

    pub(crate) fn ids_ptr(&self) -> *const u32 {
        self.ids.as_ptr()
    }

    pub(crate) fn categories_ptr(&self) -> *const u8 {
        self.categories.as_ptr()
    }

    pub(crate) fn subtypes_ptr(&self) -> *const u8 {
        self.subtypes.as_ptr()
    }

    pub(crate) fn x_ptr(&self) -> *const f32 {
        self.x.as_ptr()
    }

    pub(crate) fn z_ptr(&self) -> *const f32 {
        self.z.as_ptr()
    }

    pub(crate) fn radius_or_w_ptr(&self) -> *const f32 {
        self.radius_or_w.as_ptr()
    }

    pub(crate) fn depth_or_h_ptr(&self) -> *const f32 {
        self.depth_or_h.as_ptr()
    }

    pub(crate) fn seeds_ptr(&self) -> *const u32 {
        self.seeds.as_ptr()
    }

    pub(crate) fn flags_ptr(&self) -> *const u32 {
        self.flags.as_ptr()
    }

    fn generate_reserved_structure_slot(
        &mut self,
        world_seed: u32,
        row: i32,
        col: i32,
        terrain: &Terrain,
        half_extent: f32,
        rng: &mut Rng,
    ) {
        for attempt in 0..STRUCTURE_ATTEMPTS {
            let x = sample_inner_coord(rng, half_extent, STRUCTURE_EDGE_MARGIN);
            let z = sample_inner_coord(rng, half_extent, STRUCTURE_EDGE_MARGIN);
            if !terrain.is_structure_viable(x, z) {
                continue;
            }

            self.push(
                stable_node_id(world_seed, row, col, attempt as u32),
                category::STRUCTURE,
                subtype::RESERVED,
                x,
                z,
                4.0,
                4.0,
                cell_seed(world_seed, row, col, 0x1000 + attempt as u32),
                0,
            );
            break;
        }
    }

    fn generate_scrap_fields(
        &mut self,
        world_seed: u32,
        row: i32,
        col: i32,
        terrain: &Terrain,
        half_extent: f32,
        rng: &mut Rng,
    ) {
        let target_count = 3 + (rng.next_unsigned() * 4.0) as usize;
        for scrap_index in 0..target_count {
            if self.count >= MAX_WORLD_NODES_PER_SHARD {
                break;
            }

            let Some(candidate) = self.choose_scrap_candidate(terrain, half_extent, rng) else {
                continue;
            };

            let radius = SCRAP_RADIUS_MIN
                + rng.next_unsigned() * (SCRAP_RADIUS_MAX - SCRAP_RADIUS_MIN);
            let depth = SCRAP_DEPTH_MIN
                + rng.next_unsigned() * (SCRAP_DEPTH_MAX - SCRAP_DEPTH_MIN);
            self.push(
                stable_node_id(world_seed, row, col, 0x4000 + scrap_index as u32),
                category::METAL_SCRAP,
                subtype::SCRAP_FIELD,
                candidate.x,
                candidate.z,
                radius,
                depth,
                cell_seed(world_seed, row, col, 0x2000 + scrap_index as u32),
                0,
            );
        }
    }

    fn choose_scrap_candidate(
        &self,
        terrain: &Terrain,
        half_extent: f32,
        rng: &mut Rng,
    ) -> Option<ScrapCandidate> {
        let mut best_candidate = None;

        for _ in 0..SCRAP_CANDIDATES_PER_NODE {
            let x = sample_inner_coord(rng, half_extent, SCRAP_RADIUS_MAX + 2.0);
            let z = sample_inner_coord(rng, half_extent, SCRAP_RADIUS_MAX + 2.0);
            let slope = scrap_flatness_degrees(terrain, x, z);
            if slope > SCRAP_MAX_SLOPE_DEG {
                continue;
            }
            if self.overlaps_category(x, z, SCRAP_MIN_SPACING, category::METAL_SCRAP) {
                continue;
            }
            if self.overlaps_category(x, z, SCRAP_STRUCTURE_CLEARANCE, category::STRUCTURE) {
                continue;
            }

            let height = terrain.sample_height(x as f64, z as f64);
            let zone_penalty = if terrain.zone_at(x, z) == 0 {
                0.0
            } else {
                SCRAP_ZONE_NON_LOWLAND_PENALTY
            };
            let score = slope * SCRAP_SLOPE_WEIGHT
                + height.max(-3.0) * SCRAP_HEIGHT_WEIGHT
                + zone_penalty;

            let candidate = ScrapCandidate { x, z, score };
            if best_candidate
                .as_ref()
                .is_none_or(|best: &ScrapCandidate| candidate.score < best.score)
            {
                best_candidate = Some(candidate);
            }
        }

        best_candidate
    }

    fn overlaps_category(&self, x: f32, z: f32, min_distance: f32, category: u8) -> bool {
        for index in 0..self.count {
            if self.categories[index] != category {
                continue;
            }
            let dx = self.x[index] - x;
            let dz = self.z[index] - z;
            if dx * dx + dz * dz < min_distance * min_distance {
                return true;
            }
        }
        false
    }

    fn push(
        &mut self,
        id: u32,
        category: u8,
        subtype: u8,
        x: f32,
        z: f32,
        radius_or_w: f32,
        depth_or_h: f32,
        seed: u32,
        flags: u32,
    ) {
        if self.count >= MAX_WORLD_NODES_PER_SHARD {
            return;
        }

        let index = self.count;
        self.ids[index] = id;
        self.categories[index] = category;
        self.subtypes[index] = subtype;
        self.x[index] = x;
        self.z[index] = z;
        self.radius_or_w[index] = radius_or_w;
        self.depth_or_h[index] = depth_or_h;
        self.seeds[index] = seed;
        self.flags[index] = flags;
        self.count += 1;
    }
}

struct ScrapCandidate {
    x: f32,
    z: f32,
    score: f32,
}

fn scrap_flatness_degrees(terrain: &Terrain, x: f32, z: f32) -> f32 {
    let h0 = terrain.sample_height(x as f64, z as f64);
    let hx = terrain.sample_height((x + SCRAP_FLATNESS_SAMPLE_EPS) as f64, z as f64);
    let hz = terrain.sample_height(x as f64, (z + SCRAP_FLATNESS_SAMPLE_EPS) as f64);
    let dhx = hx - h0;
    let dhz = hz - h0;
    let gradient = (dhx * dhx + dhz * dhz).sqrt() / SCRAP_FLATNESS_SAMPLE_EPS;
    gradient.atan().to_degrees()
}

impl Default for WorldNodes {
    fn default() -> Self {
        Self {
            count: 0,
            ids: [0; MAX_WORLD_NODES_PER_SHARD],
            categories: [0; MAX_WORLD_NODES_PER_SHARD],
            subtypes: [0; MAX_WORLD_NODES_PER_SHARD],
            x: [0.0; MAX_WORLD_NODES_PER_SHARD],
            z: [0.0; MAX_WORLD_NODES_PER_SHARD],
            radius_or_w: [0.0; MAX_WORLD_NODES_PER_SHARD],
            depth_or_h: [0.0; MAX_WORLD_NODES_PER_SHARD],
            seeds: [0; MAX_WORLD_NODES_PER_SHARD],
            flags: [0; MAX_WORLD_NODES_PER_SHARD],
        }
    }
}

fn sample_inner_coord(rng: &mut Rng, half_extent: f32, margin: f32) -> f32 {
    let reach = (half_extent - margin).max(0.0);
    rng.next_signed() * reach
}

fn stable_node_id(world_seed: u32, row: i32, col: i32, local_index: u32) -> u32 {
    cell_seed(world_seed, row, col, 0x3000 ^ local_index)
}