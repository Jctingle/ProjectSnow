use crate::terrain::Terrain;

pub struct EdgeTraversal {
    pub distance: f32,
    pub slope_deg: f32,
    pub slope_delta: f32,
    pub blocked: bool,
}

pub fn edge_traversal(
    terrain: &Terrain,
    from: (f32, f32),
    to: (f32, f32),
    max_slope_deg: f32,
) -> EdgeTraversal {
    let dx = to.0 - from.0;
    let dz = to.1 - from.1;
    let distance = dx.hypot(dz);
    let slope_deg = terrain.slope_degrees_at((from.0 + to.0) * 0.5, (from.1 + to.1) * 0.5);
    let slope_delta = terrain.sample_height(to.0 as f64, to.1 as f64)
        - terrain.sample_height(from.0 as f64, from.1 as f64);

    EdgeTraversal {
        distance,
        slope_deg,
        slope_delta,
        blocked: slope_deg > max_slope_deg,
    }
}

pub fn cost(edge: &EdgeTraversal) -> f32 {
    if edge.blocked {
        f32::INFINITY
    } else {
        edge.distance * (1.0 + edge.slope_deg / 90.0)
    }
}

#[cfg(test)]
#[path = "pathfinding_tests.rs"]
mod pathfinding_tests;