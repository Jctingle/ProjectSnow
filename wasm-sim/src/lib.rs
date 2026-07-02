use wasm_bindgen::prelude::*;
use noise::{NoiseFn, Simplex};
use once_cell::sync::Lazy;

// -----------------------------------------------------------------------------
// Unit state model and movement tuning
// -----------------------------------------------------------------------------
const SEEK_APC: u8 = 0;
const SEEK_RANDOM: u8 = 1;
const UNIT_SPEED: f32 = 0.1; // per tick at 60Hz
const APC_SPEED: f32 = UNIT_SPEED / 3.0;
const TOUCH_RADIUS: f32 = 0.5;

// Shared, deterministic noise generator reused across all calls.
static SIMPLEX: Lazy<Simplex> = Lazy::new(|| Simplex::new(42));

// Internal terrain sampler used by all exported terrain/simulation APIs.
fn sample(x: f64, z: f64, seed_x: f64, seed_y: f64, scale: f64) -> f32 {
    SIMPLEX.get([(x + seed_x) * scale, (z + seed_y) * scale]) as f32
}

/// Sample one terrain height value at world-space (x, z).
#[wasm_bindgen]
pub fn sample_height(x: f64, z: f64, seed_x: f64, seed_y: f64, scale: f64) -> f32 {
    sample(x, z, seed_x, seed_y, scale)
}

/// Fill a heightmap buffer using centered grid coordinates.
#[wasm_bindgen]
pub fn generate_heightmap(
    out: &mut [f32],
    width: usize,
    height: usize,
    seed_x: f64,
    seed_y: f64,
    scale: f64,
) {
    for y in 0..height {
        for x in 0..width {
            let nx = x as f64 - (width as f64 / 2.0);
            let ny = y as f64 - (height as f64 / 2.0);
            out[y * width + x] = sample(nx, ny, seed_x, seed_y, scale);
        }
    }
}

/// Batched simulation tick for all active units.
///
/// Behavior:
/// - SEEK_APC: move toward APC.
/// - SEEK_RANDOM: move toward per-unit random target.
/// - On arrival: toggle state and set/consume random target.
/// - APC moves toward its own target at 1/3 unit speed.
/// - Always resample terrain and update unit Y for ground-follow.
#[wasm_bindgen]
pub fn tick_units(
    positions: &mut [f32],
    states: &mut [u8],
    target_x: &mut [f32],
    target_z: &mut [f32],
    count: usize,
    mut apc_x: f32,
    mut apc_z: f32,
    apc_target_x: f32,
    apc_target_z: f32,
    rand_x: f32,
    rand_z: f32,
    delta: f32,
    seed_x: f64,
    seed_y: f64,
    scale: f64,
    height_mult: f32,
) -> Vec<f32> {
    let apc_dx = apc_target_x - apc_x;
    let apc_dz = apc_target_z - apc_z;
    let apc_dist = (apc_dx * apc_dx + apc_dz * apc_dz).sqrt();

    if apc_dist >= TOUCH_RADIUS {
        let step = APC_SPEED * delta * 60.0;
        let move_dist = step.min(apc_dist);
        let apc_nx = apc_dx / apc_dist;
        let apc_nz = apc_dz / apc_dist;
        apc_x += apc_nx * move_dist;
        apc_z += apc_nz * move_dist;
    }

    let apc_y = sample(apc_x as f64, apc_z as f64, seed_x, seed_y, scale) * height_mult;

    for i in 0..count {
        let ux = positions[i * 3];
        let uz = positions[i * 3 + 2];

        let (tx, tz) = if states[i] == SEEK_APC {
            (apc_x, apc_z)
        } else {
            (target_x[i], target_z[i])
        };

        let dx = tx - ux;
        let dz = tz - uz;
        let dist = (dx * dx + dz * dz).sqrt();

        if dist < TOUCH_RADIUS {
            if states[i] == SEEK_APC {
                target_x[i] = rand_x;
                target_z[i] = rand_z;
                states[i] = SEEK_RANDOM;
            } else {
                states[i] = SEEK_APC;
            }
        } else {
            let step = UNIT_SPEED * delta * 60.0; // normalize to 60Hz
            let nx = dx / dist;
            let nz = dz / dist;
            positions[i * 3] += nx * step;
            positions[i * 3 + 2] += nz * step;

            // height follow
            let h = sample(
                positions[i * 3] as f64,
                positions[i * 3 + 2] as f64,
                seed_x, seed_y, scale
            );
            positions[i * 3 + 1] = h * height_mult + 0.04;
        }
    }

    vec![apc_x, apc_z, apc_y]
}