use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn nudge_positions(positions: &mut [f32], count: usize, delta: f32) {
    for i in 0..count {
        positions[i * 3] += delta; // nudge x of each unit
    }
}