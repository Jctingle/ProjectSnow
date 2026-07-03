use crate::rng::Rng;
use crate::terrain::Terrain;

const SEEK_APC: u8 = 0;
const SEEK_RANDOM: u8 = 1;
pub(crate) const UNIT_SPEED: f32 = 0.1;
const UNIT_TOUCH_RADIUS: f32 = 0.3;
const UNIT_TOUCH_RADIUS_SQ: f32 = UNIT_TOUCH_RADIUS * UNIT_TOUCH_RADIUS;
const UNIT_Y_OFFSET: f32 = 0.04;

pub struct Units {
    positions: Vec<f32>,
    states: Vec<u8>,
    target_x: Vec<f32>,
    target_z: Vec<f32>,
    count: usize,
    max_units: usize,
    shard_half: f32,
}

impl Units {
    pub fn new(max_units: usize, shard_half: f32) -> Self {
        Self {
            positions: vec![0.0; max_units * 3],
            states: vec![SEEK_APC; max_units],
            target_x: vec![0.0; max_units],
            target_z: vec![0.0; max_units],
            count: 0,
            max_units,
            shard_half,
        }
    }

    pub fn spawn_unit(&mut self, x: f32, z: f32, terrain: &Terrain) -> i32 {
        if self.count >= self.max_units {
            return -1;
        }

        let id = self.count;
        let y = terrain.height_at_or_sample(x, z) * terrain.height_mult() + UNIT_Y_OFFSET;
        self.positions[id * 3] = x;
        self.positions[id * 3 + 1] = y;
        self.positions[id * 3 + 2] = z;
        self.states[id] = SEEK_APC;
        self.target_x[id] = 0.0;
        self.target_z[id] = 0.0;
        self.count += 1;

        id as i32
    }

    pub fn tick(&mut self, delta: f32, apc_pos: (f32, f32), terrain: &Terrain, rng: &mut Rng) {
        let step = UNIT_SPEED * delta * 60.0;
        let (apc_x, apc_z) = apc_pos;

        for (((pos, state), tx), tz) in self
            .positions
            .chunks_exact_mut(3)
            .take(self.count)
            .zip(self.states.iter_mut().take(self.count))
            .zip(self.target_x.iter_mut().take(self.count))
            .zip(self.target_z.iter_mut().take(self.count))
        {
            let (goal_x, goal_z) = if *state == SEEK_APC {
                (apc_x, apc_z)
            } else {
                (*tx, *tz)
            };

            let dx = goal_x - pos[0];
            let dz = goal_z - pos[2];
            let dist_sq = dx * dx + dz * dz;

            if dist_sq < UNIT_TOUCH_RADIUS_SQ {
                if *state == SEEK_APC {
                    *tx = rng.next_signed() * self.shard_half;
                    *tz = rng.next_signed() * self.shard_half;
                    *state = SEEK_RANDOM;
                } else {
                    *state = SEEK_APC;
                }
            } else {
                let inv_dist = 1.0 / dist_sq.sqrt();
                pos[0] += dx * inv_dist * step;
                pos[2] += dz * inv_dist * step;
                pos[1] = terrain.height_at_clamped(pos[0], pos[2]) * terrain.height_mult() + UNIT_Y_OFFSET;
            }
        }
    }

    pub fn positions_ptr(&self) -> *const f32 {
        self.positions.as_ptr()
    }

    pub fn states_ptr(&self) -> *const u8 {
        self.states.as_ptr()
    }

    pub fn count(&self) -> usize {
        self.count
    }

    pub fn max_units(&self) -> usize {
        self.max_units
    }
}
