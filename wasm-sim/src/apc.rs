use crate::terrain::Terrain;
use crate::units::UNIT_SPEED;

const APC_SPEED: f32 = UNIT_SPEED / 3.0;
const APC_TOUCH_RADIUS: f32 = 0.3;
const APC_TOUCH_RADIUS_SQ: f32 = APC_TOUCH_RADIUS * APC_TOUCH_RADIUS;

pub struct Apc {
    x: f32,
    y: f32,
    z: f32,
    target_x: f32,
    target_z: f32,
}

impl Apc {
    pub fn new() -> Self {
        Self {
            x: 0.0,
            y: 0.0,
            z: 0.0,
            target_x: 0.0,
            target_z: 0.0,
        }
    }

    pub fn tick(&mut self, delta: f32, terrain: &Terrain) {
        let dx = self.target_x - self.x;
        let dz = self.target_z - self.z;
        let dist_sq = dx * dx + dz * dz;

        if dist_sq >= APC_TOUCH_RADIUS_SQ {
            let dist = dist_sq.sqrt();
            let step = (APC_SPEED * delta * 60.0).min(dist);
            self.x += dx / dist * step;
            self.z += dz / dist * step;
        }

        self.y = terrain.height_at_or_sample(self.x, self.z) * terrain.height_mult();
    }

    pub fn set_target(&mut self, x: f32, z: f32) {
        self.target_x = x;
        self.target_z = z;
    }

    pub fn position_xz(&self) -> (f32, f32) {
        (self.x, self.z)
    }

    pub fn x(&self) -> f32 {
        self.x
    }

    pub fn y(&self) -> f32 {
        self.y
    }

    pub fn z(&self) -> f32 {
        self.z
    }
}
