use super::*;
use crate::terrain::Terrain;

const FROM: (f32, f32) = (-20.0, -10.0);
const TO: (f32, f32) = (60.0, 50.0);

fn flat_terrain() -> Terrain {
    let mut terrain = Terrain::new(0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0);
    terrain.generate_heightmap(33, 33, 80.0, 80.0);
    terrain.regenerate(0, 0, 0);
    terrain
}

fn sloped_terrain() -> Terrain {
    let mut terrain = Terrain::new(1337, 17.0, 29.0, 0.028, 5.2, 1.2, 2.1, 0.011, 0.2, 0.95);
    terrain.generate_heightmap(145, 145, 144.0, 144.0);
    terrain.regenerate(1337, 0, 0);
    terrain
}

fn sloped_edge() -> EdgeTraversal {
    let terrain = sloped_terrain();
    let edge = edge_traversal(&terrain, FROM, TO, 90.0);
    assert!(edge.slope_deg > 0.0, "fixture unexpectedly produced flat terrain");
    edge
}

fn report_edge(label: &str, terrain: &Terrain, edge: &EdgeTraversal) {
    let from_height = terrain.sample_height(FROM.0 as f64, FROM.1 as f64);
    let to_height = terrain.sample_height(TO.0 as f64, TO.1 as f64);
    eprintln!(
        "{label}: from_height={from_height:.6} to_height={to_height:.6} slope_deg={:.6} distance={:.6} cost={:.6}",
        edge.slope_deg,
        edge.distance,
        cost(edge),
    );
}

#[test]
fn flat_terrain_cost_matches_distance() {
    let terrain = flat_terrain();
    let edge = edge_traversal(&terrain, FROM, TO, 0.0);
    report_edge("flat", &terrain, &edge);

    assert!(!edge.blocked);
    assert!((cost(&edge) - edge.distance).abs() <= 1e-5);
}

#[test]
fn slope_over_limit_is_blocked_and_infinite() {
    let terrain = sloped_terrain();
    let slope = edge_traversal(&terrain, FROM, TO, 90.0).slope_deg;
    let edge = edge_traversal(&terrain, FROM, TO, slope - 0.01);
    report_edge("over_limit", &terrain, &edge);

    assert!(edge.blocked);
    assert_eq!(cost(&edge), f32::INFINITY);
}

#[test]
fn slope_under_limit_cost_exceeds_flat_cost() {
    let flat = flat_terrain();
    let flat_cost = cost(&edge_traversal(&flat, FROM, TO, 0.0));
    let terrain = sloped_terrain();
    let slope = sloped_edge().slope_deg;
    let edge = edge_traversal(&terrain, FROM, TO, slope + 0.01);
    report_edge("under_limit", &terrain, &edge);

    assert!(!edge.blocked);
    assert!(cost(&edge) > flat_cost);
}

#[test]
fn max_slope_is_a_real_threshold_input() {
    let terrain = sloped_terrain();
    let slope = edge_traversal(&terrain, FROM, TO, 90.0).slope_deg;
    let blocked = edge_traversal(&terrain, FROM, TO, slope - 0.01);
    let allowed = edge_traversal(&terrain, FROM, TO, slope + 0.01);
    report_edge("threshold_blocked", &terrain, &blocked);
    report_edge("threshold_allowed", &terrain, &allowed);

    assert!(blocked.blocked);
    assert!(!allowed.blocked);
}