use crate::rng::Rng;
use crate::terrain::Terrain;

const SEEK_APC: u8 = 0;
const SEEK_RANDOM: u8 = 1;
const CREWED: u8 = 2;
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
    wander_radius: f32,
    recall_active: bool,
}

impl Units {
    pub fn new(max_units: usize, wander_radius: f32) -> Self {
        Self {
            positions: vec![0.0; max_units * 3],
            states: vec![SEEK_APC; max_units],
            target_x: vec![0.0; max_units],
            target_z: vec![0.0; max_units],
            count: 0,
            max_units,
            wander_radius,
            recall_active: false,
        }
    }

    pub fn set_recall(&mut self, active: bool) {
        self.recall_active = active;
    }

    pub fn deployed_count(&self) -> usize {
        self.states
            .iter()
            .take(self.count)
            .filter(|&&s| s != CREWED)
            .count()
    }

    pub fn deploy_all(&mut self) {
        for s in self.states.iter_mut().take(self.count) {
            if *s == CREWED {
                *s = SEEK_APC;
            }
        }
    }

    pub fn rebase(&mut self, dx: f32, dz: f32) {
        for pos in self.positions.chunks_exact_mut(3).take(self.count) {
            pos[0] += dx;
            pos[2] += dz;
        }
        for t in self.target_x.iter_mut().take(self.count) {
            *t += dx;
        }
        for t in self.target_z.iter_mut().take(self.count) {
            *t += dz;
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
            if *state == CREWED {
                continue;
            }

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
                    if self.recall_active {
                        *state = CREWED;
                    } else {
                        *tx = rng.next_signed() * self.wander_radius;
                        *tz = rng.next_signed() * self.wander_radius;
                        *state = SEEK_RANDOM;
                    }
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::terrain::Terrain;

    fn build_test_terrain(seed: u32) -> Terrain {
        let mut terrain = Terrain::new(seed, 17.0, 29.0, 0.028, 5.2, 1.2, 2.1, 0.011, 0.2, 0.95);
        terrain.generate_heightmap(0, 0, 144.0, 144.0);
        terrain.regenerate(seed, 0, 0);
        terrain
    }

    #[test]
    fn recall_boards_units_and_deploy_all_restores_deployed_count() {
        let terrain = build_test_terrain(7777);
        let mut units = Units::new(8, 72.0);
        let mut rng = Rng::new(2026);

        assert_eq!(units.spawn_unit(0.6, 0.0, &terrain), 0);
        assert_eq!(units.spawn_unit(-0.5, 0.2, &terrain), 1);
        assert_eq!(units.spawn_unit(0.2, -0.6, &terrain), 2);
        assert_eq!(units.deployed_count(), 3);

        units.set_recall(true);

        let delta = 1.0 / 60.0;

        let mut boarded = false;
        for _ in 0..10_000 {
            units.tick(delta, (0.0, 0.0), &terrain, &mut rng);
            if units.deployed_count() == 0 {
                boarded = true;
                break;
            }
        }

        assert!(boarded, "units never fully boarded within tick budget");

        let before = units.positions.clone();
        units.tick(delta, (0.0, 0.0), &terrain, &mut rng);
        let after = units.positions.clone();
        assert_eq!(before, after, "crewed units should stop moving");

        units.deploy_all();
        assert_eq!(units.deployed_count(), 3);
    }
}
