pub struct Rng {
    state: u32,
}

impl Rng {
    pub fn new(seed: u32) -> Self {
        Self { state: seed | 1 }
    }

    #[inline]
    pub fn next_signed(&mut self) -> f32 {
        let mut s = self.state;
        s ^= s << 13;
        s ^= s >> 17;
        s ^= s << 5;
        self.state = s;
        (s as f32 / u32::MAX as f32) * 2.0 - 1.0
    }

    #[inline]
    pub fn next_unsigned(&mut self) -> f32 {
        (self.next_signed() + 1.0) * 0.5
    }
}

/// Deterministic hash of (world_seed, row, col, layer_id) into a value
/// suitable for seeding Rng::new(). Same inputs always produce the same
/// output; different layer_id values are intentionally uncorrelated, so
/// future generation layers can never perturb this layer's rolls.
pub fn cell_seed(world_seed: u32, row: i32, col: i32, layer_id: u32) -> u32 {
    let mut h = world_seed;
    h ^= (row as u32).wrapping_mul(0x9E3779B1);
    h ^= (col as u32).wrapping_mul(0x85EBCA77);
    h ^= layer_id.wrapping_mul(0xC2B2AE3D);
    h ^= h >> 15;
    h = h.wrapping_mul(0x2C1B3C6D);
    h ^= h >> 12;
    h = h.wrapping_mul(0x297A2D39);
    h ^= h >> 15;
    h
}
