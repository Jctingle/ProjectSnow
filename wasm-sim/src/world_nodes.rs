use crate::rng::{cell_seed, Rng};
use crate::terrain::{Terrain, SEA_LEVEL};

pub(crate) const MAX_WORLD_NODES_PER_SHARD: usize = 32;
const LAYER_WORLD_NODES: u32 = 2;
const STRUCTURE_EDGE_MARGIN: f32 = 10.0;
const STRUCTURE_ATTEMPTS: usize = 10;
const STRUCTURE_SPAWN_CHANCE: f32 = 0.25;
const SETTLEMENT_HALF_WIDTH: f32 = 4.0;
const SETTLEMENT_HALF_DEPTH: f32 = 4.0;
const SETTLEMENT_SAMPLE_SCALE: f32 = 0.82;
const SETTLEMENT_FLOAT_WELL_DEPTH: f32 = 2.4;
const SETTLEMENT_RELIEF_MAX: f32 = 4.0;
const SETTLEMENT_EMBEDDED_FLOAT_WELL_MIN: f32 = 0.38;
const SETTLEMENT_EMBEDDED_ATTACHMENT_MIN: f32 = 0.58;
const SETTLEMENT_PERCHED_ATTACHMENT_MAX: f32 = 0.34;
const SETTLEMENT_PERCHED_RELIEF_MIN: f32 = 0.35;
const SCRAP_CANDIDATES_PER_NODE: usize = 12;
const RESOURCE_CANDIDATES_PER_NODE: usize = 20;
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
const SCRAP_TARGET_MIN: usize = 1;
const SCRAP_TARGET_MAX: usize = 2;
const NICKEL_TARGET_MIN: usize = 1;
const NICKEL_TARGET_MAX: usize = 2;
const NICKEL_EDGE_MARGIN: f32 = 8.0;
const NICKEL_MIN_SPACING: f32 = 12.0;
const NICKEL_MAX_SLOPE_DEG: f32 = 8.0;
const NICKEL_MAX_HEIGHT_ABOVE_SEA: f32 = 0.45;
const NICKEL_HEIGHT_WEIGHT: f32 = 8.0;
const NICKEL_SLOPE_WEIGHT: f32 = 1.5;
const NICKEL_SCRAP_CLEARANCE: f32 = 10.0;
const NICKEL_STRUCTURE_CLEARANCE: f32 = 14.0;
const NICKEL_BAND_WIDTH_MIN: f32 = 5.0;
const NICKEL_BAND_WIDTH_MAX: f32 = 10.0;
const NICKEL_BAND_LENGTH_MIN: f32 = 2.0;
const NICKEL_BAND_LENGTH_MAX: f32 = 4.5;
pub(crate) const SCRAP_MAX_SLOPE_DEG: f32 = 18.0;

pub(crate) mod category {
    pub(crate) const STRUCTURE: u8 = 1;
    pub(crate) const METAL_SCRAP: u8 = 2;
    pub(crate) const RAW_RESOURCE: u8 = 3;
}

pub(crate) mod subtype {
    pub(crate) const SETTLEMENT_BALANCED: u8 = 0;
    pub(crate) const SCRAP_FIELD: u8 = 1;
    pub(crate) const NICKEL_BAND: u8 = 2;
    pub(crate) const SETTLEMENT_PERCHED: u8 = 3;
    pub(crate) const SETTLEMENT_EMBEDDED: u8 = 4;
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

        nodes.generate_settlement_slot(world_seed, row, col, terrain, half_extent, &mut rng);
        nodes.generate_scrap_fields(world_seed, row, col, terrain, half_extent, &mut rng);
        nodes.generate_nickel_bands(world_seed, row, col, terrain, half_extent, &mut rng);
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

    fn generate_settlement_slot(
        &mut self,
        world_seed: u32,
        row: i32,
        col: i32,
        terrain: &Terrain,
        half_extent: f32,
        rng: &mut Rng,
    ) {
        if rng.next_unsigned() > STRUCTURE_SPAWN_CHANCE {
            return;
        }

        for attempt in 0..STRUCTURE_ATTEMPTS {
            let x = sample_inner_coord(rng, half_extent, STRUCTURE_EDGE_MARGIN);
            let z = sample_inner_coord(rng, half_extent, STRUCTURE_EDGE_MARGIN);
            if !terrain.is_structure_viable(x, z) {
                continue;
            }
            let profile = classify_settlement_profile(terrain, x, z, SETTLEMENT_HALF_WIDTH, SETTLEMENT_HALF_DEPTH);

            self.push(
                stable_node_id(world_seed, row, col, attempt as u32),
                category::STRUCTURE,
                profile.subtype,
                x,
                z,
                SETTLEMENT_HALF_WIDTH,
                SETTLEMENT_HALF_DEPTH,
                cell_seed(world_seed, row, col, 0x1000 + attempt as u32),
                encode_settlement_flags(profile.float_well, profile.relief_norm, profile.attachment),
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
        let target_count = SCRAP_TARGET_MIN
            + (rng.next_unsigned() * (SCRAP_TARGET_MAX - SCRAP_TARGET_MIN + 1) as f32) as usize;
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

    fn generate_nickel_bands(
        &mut self,
        world_seed: u32,
        row: i32,
        col: i32,
        terrain: &Terrain,
        half_extent: f32,
        rng: &mut Rng,
    ) {
        let target_count = NICKEL_TARGET_MIN
            + (rng.next_unsigned() * (NICKEL_TARGET_MAX - NICKEL_TARGET_MIN + 1) as f32)
                as usize;
        for nickel_index in 0..target_count {
            if self.count >= MAX_WORLD_NODES_PER_SHARD {
                break;
            }

            let Some(candidate) = self.choose_nickel_candidate(terrain, half_extent, rng) else {
                continue;
            };

            let band_width = NICKEL_BAND_WIDTH_MIN
                + rng.next_unsigned() * (NICKEL_BAND_WIDTH_MAX - NICKEL_BAND_WIDTH_MIN);
            let band_length = NICKEL_BAND_LENGTH_MIN
                + rng.next_unsigned() * (NICKEL_BAND_LENGTH_MAX - NICKEL_BAND_LENGTH_MIN);
            self.push(
                stable_node_id(world_seed, row, col, 0x5000 + nickel_index as u32),
                category::RAW_RESOURCE,
                subtype::NICKEL_BAND,
                candidate.x,
                candidate.z,
                band_width,
                band_length,
                cell_seed(world_seed, row, col, 0x2100 + nickel_index as u32),
                encode_yaw_flag(candidate.yaw),
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

    fn choose_nickel_candidate(
        &self,
        terrain: &Terrain,
        half_extent: f32,
        rng: &mut Rng,
    ) -> Option<BandCandidate> {
        let mut best_candidate = None;

        for _ in 0..RESOURCE_CANDIDATES_PER_NODE {
            let x = sample_inner_coord(rng, half_extent, NICKEL_EDGE_MARGIN);
            let z = sample_inner_coord(rng, half_extent, NICKEL_EDGE_MARGIN);
            let height = terrain.sample_height(x as f64, z as f64);
            let slope = scrap_flatness_degrees(terrain, x, z);

            if height > SEA_LEVEL + NICKEL_MAX_HEIGHT_ABOVE_SEA {
                continue;
            }
            if slope > NICKEL_MAX_SLOPE_DEG {
                continue;
            }
            if self.overlaps_category(x, z, NICKEL_MIN_SPACING, category::RAW_RESOURCE) {
                continue;
            }
            if self.overlaps_category(x, z, NICKEL_SCRAP_CLEARANCE, category::METAL_SCRAP) {
                continue;
            }
            if self.overlaps_category(x, z, NICKEL_STRUCTURE_CLEARANCE, category::STRUCTURE) {
                continue;
            }

            let score = (height - SEA_LEVEL).abs() * NICKEL_HEIGHT_WEIGHT
                + slope * NICKEL_SLOPE_WEIGHT
                + if terrain.zone_at(x, z) == 0 { 0.0 } else { 6.0 };
            let candidate = BandCandidate {
                x,
                z,
                yaw: quantized_yaw_from_rng(rng),
                score,
            };
            if best_candidate
                .as_ref()
                .is_none_or(|best: &BandCandidate| candidate.score < best.score)
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

struct BandCandidate {
    x: f32,
    z: f32,
    yaw: f32,
    score: f32,
}

struct SettlementProfile {
    subtype: u8,
    float_well: f32,
    relief_norm: f32,
    attachment: f32,
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

fn quantized_yaw_from_rng(rng: &mut Rng) -> f32 {
    rng.next_unsigned() * std::f32::consts::TAU
}

fn encode_yaw_flag(yaw: f32) -> u32 {
    let normalized = yaw.rem_euclid(std::f32::consts::TAU) / std::f32::consts::TAU;
    ((normalized * 255.0).round() as u32) & 0xff
}

fn classify_settlement_profile(
    terrain: &Terrain,
    x: f32,
    z: f32,
    half_width: f32,
    half_depth: f32,
) -> SettlementProfile {
    let sample_half_width = half_width * SETTLEMENT_SAMPLE_SCALE;
    let sample_half_depth = half_depth * SETTLEMENT_SAMPLE_SCALE;
    let sample_offsets = [
        (0.0, 0.0),
        (-sample_half_width, -sample_half_depth),
        (-sample_half_width, 0.0),
        (-sample_half_width, sample_half_depth),
        (0.0, -sample_half_depth),
        (0.0, sample_half_depth),
        (sample_half_width, -sample_half_depth),
        (sample_half_width, 0.0),
        (sample_half_width, sample_half_depth),
    ];

    let center_height = terrain.sample_height(x as f64, z as f64);
    let mut min_height = center_height;
    let mut max_height = center_height;
    let mut positive_sum: f32 = 0.0;
    let mut negative_sum: f32 = 0.0;
    let mut max_positive: f32 = 0.0;
    let mut other_count: f32 = 0.0;

    for (index, (ox, oz)) in sample_offsets.iter().enumerate() {
        let sample_height = terrain.sample_height((x + ox) as f64, (z + oz) as f64);
        min_height = min_height.min(sample_height);
        max_height = max_height.max(sample_height);
        if index == 0 {
            continue;
        }

        other_count += 1.0;
        let delta = sample_height - center_height;
        if delta > 0.0 {
            positive_sum += delta;
            max_positive = max_positive.max(delta);
        } else {
            negative_sum += -delta;
        }
    }

    let positive_mean = if other_count > 0.0 { positive_sum / other_count } else { 0.0 };
    let negative_mean = if other_count > 0.0 { negative_sum / other_count } else { 0.0 };
    let relief = max_height - min_height;
    let relief_norm = (relief / SETTLEMENT_RELIEF_MAX).clamp(0.0, 1.0);
    let attachment = if positive_mean + negative_mean <= f32::EPSILON {
        0.5
    } else {
        (positive_mean / (positive_mean + negative_mean)).clamp(0.0, 1.0)
    };
    let float_well = ((max_positive * 0.7 + positive_mean * 0.3) / SETTLEMENT_FLOAT_WELL_DEPTH)
        .clamp(0.0, 1.0);

    let subtype = if float_well >= SETTLEMENT_EMBEDDED_FLOAT_WELL_MIN
        || attachment >= SETTLEMENT_EMBEDDED_ATTACHMENT_MIN
    {
        subtype::SETTLEMENT_EMBEDDED
    } else if relief_norm >= SETTLEMENT_PERCHED_RELIEF_MIN
        && attachment <= SETTLEMENT_PERCHED_ATTACHMENT_MAX
    {
        subtype::SETTLEMENT_PERCHED
    } else {
        subtype::SETTLEMENT_BALANCED
    };

    SettlementProfile {
        subtype,
        float_well,
        relief_norm,
        attachment,
    }
}

fn encode_unit_float(value: f32) -> u32 {
    (value.clamp(0.0, 1.0) * 255.0).round() as u32
}

fn encode_settlement_flags(float_well: f32, relief_norm: f32, attachment: f32) -> u32 {
    encode_unit_float(float_well)
        | (encode_unit_float(relief_norm) << 8)
        | (encode_unit_float(attachment) << 16)
}

#[cfg(test)]
pub(crate) fn settlement_float_well(flags: u32) -> f32 {
    decode_packed_unit_float(flags, 0)
}

#[cfg(test)]
pub(crate) fn settlement_relief_norm(flags: u32) -> f32 {
    decode_packed_unit_float(flags, 8)
}

#[cfg(test)]
pub(crate) fn settlement_attachment(flags: u32) -> f32 {
    decode_packed_unit_float(flags, 16)
}

#[cfg(test)]
fn decode_packed_unit_float(flags: u32, shift: u32) -> f32 {
    ((flags >> shift) & 0xff) as f32 / 255.0
}