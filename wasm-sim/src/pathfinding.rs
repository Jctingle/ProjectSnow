use crate::terrain::Terrain;
use std::cmp::Ordering;
use std::collections::{BinaryHeap, HashMap};

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

pub struct PathResult {
    pub tiles: Vec<(i32, i32)>,
    pub edges: Vec<EdgeTraversal>,
    pub total_cost: f32,
}

const NEIGHBOR_OFFSETS: [(i32, i32); 8] = [
    (-1, -1),
    (0, -1),
    (1, -1),
    (-1, 0),
    (1, 0),
    (-1, 1),
    (0, 1),
    (1, 1),
];
const SEARCH_PADDING: i32 = 32;

struct OpenNode {
    estimated_total: f32,
    position: (i32, i32),
}

impl PartialEq for OpenNode {
    fn eq(&self, other: &Self) -> bool {
        self.estimated_total == other.estimated_total && self.position == other.position
    }
}

impl Eq for OpenNode {}

impl Ord for OpenNode {
    fn cmp(&self, other: &Self) -> Ordering {
        other
            .estimated_total
            .total_cmp(&self.estimated_total)
            .then_with(|| self.position.cmp(&other.position))
    }
}

impl PartialOrd for OpenNode {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

pub fn find_path(
    terrain: &Terrain,
    start: (i32, i32),
    goal: (i32, i32),
    max_slope_deg: f32,
) -> Option<PathResult> {
    if start == goal {
        return Some(PathResult {
            tiles: vec![start],
            edges: Vec::new(),
            total_cost: 0.0,
        });
    }

    // Keep searches finite by limiting exploration to the start/goal box plus
    // a fixed margin; shard boundaries and cross-shard routing are out of scope.
    let min_x = start.0.min(goal.0) - SEARCH_PADDING;
    let max_x = start.0.max(goal.0) + SEARCH_PADDING;
    let min_z = start.1.min(goal.1) - SEARCH_PADDING;
    let max_z = start.1.max(goal.1) + SEARCH_PADDING;

    let heuristic = |position: (i32, i32)| -> f32 {
        let dx = (goal.0 - position.0) as f32;
        let dz = (goal.1 - position.1) as f32;
        dx.hypot(dz)
    };
    let in_bounds =
        |(x, z): (i32, i32)| (min_x..=max_x).contains(&x) && (min_z..=max_z).contains(&z);

    let mut open = BinaryHeap::new();
    let mut best_cost = HashMap::new();
    let mut came_from: HashMap<(i32, i32), (i32, i32)> = HashMap::new();
    best_cost.insert(start, 0.0f32);
    open.push(OpenNode {
        estimated_total: heuristic(start),
        position: start,
    });

    while let Some(OpenNode { position, .. }) = open.pop() {
        let current_cost = *best_cost
            .get(&position)
            .expect("open node must have a cost");

        if position == goal {
            let mut tiles = vec![goal];
            let mut cursor = goal;
            while cursor != start {
                cursor = came_from[&cursor];
                tiles.push(cursor);
            }
            tiles.reverse();

            let mut edges = Vec::with_capacity(tiles.len().saturating_sub(1));
            for pair in tiles.windows(2) {
                edges.push(edge_traversal(
                    terrain,
                    (pair[0].0 as f32, pair[0].1 as f32),
                    (pair[1].0 as f32, pair[1].1 as f32),
                    max_slope_deg,
                ));
            }

            return Some(PathResult {
                tiles,
                edges,
                total_cost: current_cost,
            });
        }

        for (dx, dz) in NEIGHBOR_OFFSETS {
            let neighbor = (position.0 + dx, position.1 + dz);
            if !in_bounds(neighbor) {
                continue;
            }

            let edge = edge_traversal(
                terrain,
                (position.0 as f32, position.1 as f32),
                (neighbor.0 as f32, neighbor.1 as f32),
                max_slope_deg,
            );
            let edge_cost = cost(&edge);
            if !edge_cost.is_finite() {
                continue;
            }

            let next_cost = current_cost + edge_cost;
            if next_cost < *best_cost.get(&neighbor).unwrap_or(&f32::INFINITY) {
                best_cost.insert(neighbor, next_cost);
                came_from.insert(neighbor, position);
                open.push(OpenNode {
                    estimated_total: next_cost + heuristic(neighbor),
                    position: neighbor,
                });
            }
        }
    }

    None
}

#[cfg(test)]
#[path = "pathfinding_tests.rs"]
mod pathfinding_tests;
