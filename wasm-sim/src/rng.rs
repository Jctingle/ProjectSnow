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
