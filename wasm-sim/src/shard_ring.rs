use crate::terrain::Terrain;
use crate::Sim;

pub(crate) const SHARD_TRIGGER_MARGIN: f32 = 12.0;
pub(crate) const NEIGHBOR_OFFSETS: [(i32, i32); 8] = [
    (0, 1),
    (0, -1),
    (1, 0),
    (-1, 0),
    (1, 1),
    (1, -1),
    (-1, 1),
    (-1, -1),
];

pub(crate) struct Shard {
    pub(crate) terrain: Terrain,
    pub(crate) row: i32,
    pub(crate) col: i32,
}

pub(crate) fn trigger_direction(ax: f32, az: f32, half_extent: f32) -> Option<(i32, i32)> {
    let trigger_edge = half_extent - SHARD_TRIGGER_MARGIN;
    let dc = if ax > trigger_edge {
        1
    } else if ax < -trigger_edge {
        -1
    } else {
        0
    };
    let dr = if az > trigger_edge {
        1
    } else if az < -trigger_edge {
        -1
    } else {
        0
    };

    if dc != 0 && dr != 0 {
        let x_proximity = ax.abs() - trigger_edge;
        let z_proximity = az.abs() - trigger_edge;
        if x_proximity >= z_proximity {
            Some((0, dc))
        } else {
            Some((dr, 0))
        }
    } else if dc != 0 || dr != 0 {
        Some((dr, dc))
    } else {
        None
    }
}

pub(crate) fn slot_index(dr: i32, dc: i32) -> Option<usize> {
    NEIGHBOR_OFFSETS
        .iter()
        .position(|&(offset_dr, offset_dc)| (offset_dr, offset_dc) == (dr, dc))
}

pub(crate) fn crossing_direction(ax: f32, az: f32, half_extent: f32) -> Option<(i32, i32)> {
    let dc = if ax > half_extent {
        1
    } else if ax < -half_extent {
        -1
    } else {
        0
    };
    let dr = if az > half_extent {
        1
    } else if az < -half_extent {
        -1
    } else {
        0
    };

    if dc != 0 && dr != 0 {
        let x_overshoot = ax.abs() - half_extent;
        let z_overshoot = az.abs() - half_extent;
        if x_overshoot >= z_overshoot {
            Some((0, dc))
        } else {
            Some((dr, 0))
        }
    } else if dc != 0 || dr != 0 {
        Some((dr, dc))
    } else {
        None
    }
}

impl Sim {
    pub(crate) fn clear_neighbors(&mut self) {
        for slot in &mut self.neighbors {
            *slot = None;
        }
    }

    pub(crate) fn neighbor_shard(&self, dr: i32, dc: i32) -> Option<&Shard> {
        slot_index(dr, dc).and_then(|index| self.neighbors[index].as_ref())
    }

    pub(crate) fn backfill_neighbor(&mut self, dr: i32, dc: i32) -> bool {
        let Some(index) = slot_index(dr, dc) else {
            return false;
        };
        if self.neighbors[index].is_some() {
            return false;
        }

        let row = self.current.row + dr;
        let col = self.current.col + dc;
        let terrain = self
            .current
            .terrain
            .clone_params_for(self.world_seed, row, col);
        self.neighbors[index] = Some(Shard { terrain, row, col });
        true
    }

    pub(crate) fn take_or_generate_neighbor(&mut self, dr: i32, dc: i32) -> Shard {
        let row = self.current.row + dr;
        let col = self.current.col + dc;

        if let Some(index) = slot_index(dr, dc) {
            if let Some(shard) = self.neighbors[index].take() {
                return shard;
            }
        }

        Shard {
            terrain: self
                .current
                .terrain
                .clone_params_for(self.world_seed, row, col),
            row,
            col,
        }
    }

    pub(crate) fn rekey_neighbors(&mut self, old_current: Shard) {
        let mut drained = Vec::with_capacity(NEIGHBOR_OFFSETS.len() + 1);
        drained.push(old_current);
        for slot in &mut self.neighbors {
            if let Some(shard) = slot.take() {
                drained.push(shard);
            }
        }

        for shard in drained {
            let dr = shard.row - self.current.row;
            let dc = shard.col - self.current.col;
            if let Some(index) = slot_index(dr, dc) {
                assert!(
                    self.neighbors[index].is_none(),
                    "rekey collision for neighbor slot ({dr}, {dc})"
                );
                self.neighbors[index] = Some(shard);
            }
        }
    }
}
