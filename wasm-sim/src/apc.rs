use crate::terrain::Terrain;

const APC_TOUCH_RADIUS: f32 = 0.3;
const APC_TOUCH_RADIUS_SQ: f32 = APC_TOUCH_RADIUS * APC_TOUCH_RADIUS;
const CLIFF_SAMPLE_SPACING: f32 = 0.25;
const CLIFF_BINARY_SEARCH_STEPS: usize = 6;

pub struct Apc {
    x: f32,
    y: f32,
    z: f32,
    target_x: f32,
    target_z: f32,
    speed: f32,
    cliff_threshold_deg: f32,
    target_requires_shard_crossing: bool,
}

impl Apc {
    pub fn new(speed: f32, cliff_threshold_deg: f32) -> Self {
        Self {
            x: 0.0,
            y: 0.0,
            z: 0.0,
            target_x: 0.0,
            target_z: 0.0,
            speed,
            cliff_threshold_deg,
            target_requires_shard_crossing: false,
        }
    }

    pub fn tick(&mut self, delta: f32, terrain: &Terrain) {
        let dx = self.target_x - self.x;
        let dz = self.target_z - self.z;
        let dist_sq = dx * dx + dz * dz;

        if dist_sq >= APC_TOUCH_RADIUS_SQ {
            let dist = dist_sq.sqrt();
            let step = (self.speed * delta * 60.0).min(dist);
            let dir_x = dx / dist;
            let dir_z = dz / dist;
            let mut safe_step = step;
            if !self.target_requires_shard_crossing {
                let probe_spacing = CLIFF_SAMPLE_SPACING.max(f32::EPSILON);
                let sample_count = (step / probe_spacing).ceil().max(1.0) as usize;
                let mut blocked_step: Option<f32> = None;
                let mut previous_x = self.x;
                let mut previous_z = self.z;
                let mut previous_height = terrain.height_at_or_sample(self.x, self.z) * terrain.height_mult();
                safe_step = 0.0;

                for index in 1..=sample_count {
                    let probe_step = step * index as f32 / sample_count as f32;
                    let probe_x = self.x + dir_x * probe_step;
                    let probe_z = self.z + dir_z * probe_step;
                    let probe_height = terrain.height_at_or_sample(probe_x, probe_z) * terrain.height_mult();
                    if is_cliff_grade(
                        previous_x,
                        previous_z,
                        previous_height,
                        probe_x,
                        probe_z,
                        probe_height,
                        self.cliff_threshold_deg,
                    ) {
                        blocked_step = Some(probe_step);
                        break;
                    }
                    safe_step = probe_step;
                    previous_x = probe_x;
                    previous_z = probe_z;
                    previous_height = probe_height;
                }

                if let Some(mut high) = blocked_step {
                    let mut low = safe_step;
                    for _ in 0..CLIFF_BINARY_SEARCH_STEPS {
                        let mid = (low + high) * 0.5;
                        let start_x = self.x + dir_x * low;
                        let start_z = self.z + dir_z * low;
                        let end_x = self.x + dir_x * mid;
                        let end_z = self.z + dir_z * mid;
                        let start_height = terrain.height_at_or_sample(start_x, start_z) * terrain.height_mult();
                        let end_height = terrain.height_at_or_sample(end_x, end_z) * terrain.height_mult();
                        if is_cliff_grade(
                            start_x,
                            start_z,
                            start_height,
                            end_x,
                            end_z,
                            end_height,
                            self.cliff_threshold_deg,
                        ) {
                            high = mid;
                        } else {
                            low = mid;
                        }
                    }
                    safe_step = low;
                    self.target_x = self.x + dir_x * safe_step;
                    self.target_z = self.z + dir_z * safe_step;
                    self.target_requires_shard_crossing = false;
                }
            }

            if safe_step > 0.0 {
                self.x += dir_x * safe_step;
                self.z += dir_z * safe_step;
            }
        }

        self.y = terrain.height_at_or_sample(self.x, self.z) * terrain.height_mult();
    }

    pub fn set_target(&mut self, x: f32, z: f32, requires_shard_crossing: bool) {
        self.target_x = x;
        self.target_z = z;
        self.target_requires_shard_crossing = requires_shard_crossing;
    }

    pub fn set_speed(&mut self, v: f32) {
        self.speed = v;
    }

    pub fn set_cliff_threshold_deg(&mut self, v: f32) {
        self.cliff_threshold_deg = v;
    }

    pub fn rebase(&mut self, dx: f32, dz: f32) {
        self.x += dx;
        self.z += dz;
        self.target_x += dx;
        self.target_z += dz;
    }

    pub fn position_xz(&self) -> (f32, f32) {
        (self.x, self.z)
    }

    pub fn x(&self) -> f32 {
        self.x
    }

    pub fn target_x(&self) -> f32 {
        self.target_x
    }

    pub fn y(&self) -> f32 {
        self.y
    }

    pub fn z(&self) -> f32 {
        self.z
    }

    pub fn target_z(&self) -> f32 {
        self.target_z
    }

    pub fn touch_radius(&self) -> f32 {
        APC_TOUCH_RADIUS
    }
}

fn is_cliff_grade(
    from_x: f32,
    from_z: f32,
    from_height: f32,
    to_x: f32,
    to_z: f32,
    to_height: f32,
    cliff_threshold_deg: f32,
) -> bool {
    let horizontal = ((to_x - from_x).powi(2) + (to_z - from_z).powi(2)).sqrt();
    if horizontal <= f32::EPSILON {
        return false;
    }
    let vertical_drop = from_height - to_height;
    if vertical_drop <= 0.0 {
        return false;
    }
    let grade_deg = (vertical_drop / horizontal).atan().to_degrees();
    grade_deg >= cliff_threshold_deg
}
