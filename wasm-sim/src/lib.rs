use wasm_bindgen::prelude::*;
use noise::{NoiseFn, Simplex};

#[wasm_bindgen]
pub fn nudge_positions(positions: &mut [f32], count: usize, delta: f32) {
    for i in 0..count {
        positions[i * 3] += delta;
    }
}

#[wasm_bindgen]
pub fn generate_heightmap(
    out: &mut [f32],
    width: usize,
    height: usize,
    seed_x: f64,
    seed_y: f64,
    scale: f64,
) {
    let simplex = Simplex::new(42); // fixed seed for the noise function itself
    for y in 0..height {
        for x in 0..width {
            let nx = (x as f64 + seed_x) * scale;
            let ny = (y as f64 + seed_y) * scale;
            let value = simplex.get([nx, ny]); // range roughly -1.0 to 1.0
            out[y * width + x] = value as f32;
        }
    }
}

#[wasm_bindgen]
pub fn sample_height(x: f64, z: f64, seed_x: f64, seed_y: f64, scale: f64) -> f32 {
    let simplex = Simplex::new(42);
    let nx = (x + seed_x) * scale;
    let nz = (z + seed_y) * scale;
    simplex.get([nx, nz]) as f32
}