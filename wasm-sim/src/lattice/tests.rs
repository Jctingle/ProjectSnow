use super::*;

const ENVELOPE: Dims = Dims {
    w: 15,
    h: 10,
    d: 20,
};
const DEFAULT_HULL: Dims = Dims { w: 2, h: 1, d: 3 };

/// Growth is additive from a fixed corner, so the hull anchors at the origin.
const HULL_ORIGIN: (usize, usize, usize) = (0, 0, 0);

fn envelope_lattice() -> Lattice {
    Lattice::new(ENVELOPE)
}

#[test]
fn cell_index_round_trips_for_every_cell() {
    let lattice = envelope_lattice();
    let mut seen = vec![false; lattice.cell_count()];

    for y in 0..ENVELOPE.h {
        for z in 0..ENVELOPE.d {
            for x in 0..ENVELOPE.w {
                let index = lattice.cell_index(x, y, z);
                assert!(index < lattice.cell_count(), "index {index} out of range");
                assert!(!seen[index], "index {index} collided");
                seen[index] = true;
                assert_eq!(lattice.cell_coords(index), (x, y, z));
            }
        }
    }

    assert!(seen.into_iter().all(|hit| hit), "not every index was covered");
}

#[test]
fn a_level_is_contiguous() {
    let lattice = envelope_lattice();
    let stride = ENVELOPE.w * ENVELOPE.d;

    for y in 0..ENVELOPE.h {
        let first = lattice.cell_index(0, y, 0);
        let last = lattice.cell_index(ENVELOPE.w - 1, y, ENVELOPE.d - 1);
        assert_eq!(first, y * stride);
        assert_eq!(last, first + stride - 1);
    }
}

#[test]
fn face_indices_are_unique_and_fully_cover_each_array() {
    let lattice = envelope_lattice();

    let mut seen_x = vec![false; lattice.face_x_slice().len()];
    for y in 0..ENVELOPE.h {
        for z in 0..ENVELOPE.d {
            for x in 0..=ENVELOPE.w {
                let slot = lattice.face_x_index(x, y, z);
                assert!(!seen_x[slot], "face_x slot {slot} collided");
                seen_x[slot] = true;
            }
        }
    }
    assert!(seen_x.into_iter().all(|hit| hit));

    let mut seen_y = vec![false; lattice.face_y_slice().len()];
    for y in 0..=ENVELOPE.h {
        for z in 0..ENVELOPE.d {
            for x in 0..ENVELOPE.w {
                let slot = lattice.face_y_index(x, y, z);
                assert!(!seen_y[slot], "face_y slot {slot} collided");
                seen_y[slot] = true;
            }
        }
    }
    assert!(seen_y.into_iter().all(|hit| hit));

    let mut seen_z = vec![false; lattice.face_z_slice().len()];
    for y in 0..ENVELOPE.h {
        for z in 0..=ENVELOPE.d {
            for x in 0..ENVELOPE.w {
                let slot = lattice.face_z_index(x, y, z);
                assert!(!seen_z[slot], "face_z slot {slot} collided");
                seen_z[slot] = true;
            }
        }
    }
    assert!(seen_z.into_iter().all(|hit| hit));
}

/// The invariant the whole staggered layout exists to guarantee: a wall is one
/// object, not two half-walls that can disagree.
#[test]
fn neighbours_share_exactly_one_face_slot() {
    let lattice = envelope_lattice();
    let pairs = [
        (Dir::PosX, Dir::NegX),
        (Dir::PosY, Dir::NegY),
        (Dir::PosZ, Dir::NegZ),
    ];

    for index in 0..lattice.cell_count() {
        for (forward, backward) in pairs {
            let Some(neighbour) = lattice.neighbor(index, forward) else {
                continue;
            };
            assert_eq!(
                lattice.face_slot(index, forward),
                lattice.face_slot(neighbour, backward),
                "cell {index} and {neighbour} disagree on their shared face",
            );
        }
    }
}

#[test]
fn writing_a_face_is_visible_from_both_sides() {
    let mut lattice = envelope_lattice();
    let index = lattice.cell_index(4, 2, 6);
    let neighbour = lattice.neighbor(index, Dir::PosZ).unwrap();

    lattice.set_face(index, Dir::PosZ, FACE_LADDER);

    assert_eq!(lattice.face(index, Dir::PosZ), FACE_LADDER);
    assert_eq!(lattice.face(neighbour, Dir::NegZ), FACE_LADDER);
}

#[test]
fn boundary_cells_have_no_outward_neighbour() {
    let lattice = envelope_lattice();

    for y in 0..ENVELOPE.h {
        for z in 0..ENVELOPE.d {
            // The wrap bug this guards: index - 1 at x == 0 lands on the
            // previous row's far edge rather than resolving to None.
            let low = lattice.cell_index(0, y, z);
            assert_eq!(lattice.neighbor(low, Dir::NegX), None);
            let high = lattice.cell_index(ENVELOPE.w - 1, y, z);
            assert_eq!(lattice.neighbor(high, Dir::PosX), None);
        }
    }

    for y in 0..ENVELOPE.h {
        for x in 0..ENVELOPE.w {
            let low = lattice.cell_index(x, y, 0);
            assert_eq!(lattice.neighbor(low, Dir::NegZ), None);
            let high = lattice.cell_index(x, y, ENVELOPE.d - 1);
            assert_eq!(lattice.neighbor(high, Dir::PosZ), None);
        }
    }

    for z in 0..ENVELOPE.d {
        for x in 0..ENVELOPE.w {
            let low = lattice.cell_index(x, 0, z);
            assert_eq!(lattice.neighbor(low, Dir::NegY), None);
            let high = lattice.cell_index(x, ENVELOPE.h - 1, z);
            assert_eq!(lattice.neighbor(high, Dir::PosY), None);
        }
    }
}

#[test]
fn interior_cells_have_all_six_neighbours() {
    let lattice = envelope_lattice();
    let index = lattice.cell_index(7, 5, 10);

    for dir in ALL_DIRS {
        assert!(
            lattice.neighbor(index, dir).is_some(),
            "interior cell missing neighbour for {dir:?}",
        );
    }
}

#[test]
fn neighbour_relation_is_symmetric() {
    let lattice = envelope_lattice();
    let pairs = [
        (Dir::PosX, Dir::NegX),
        (Dir::PosY, Dir::NegY),
        (Dir::PosZ, Dir::NegZ),
    ];

    for index in 0..lattice.cell_count() {
        for (forward, backward) in pairs {
            if let Some(neighbour) = lattice.neighbor(index, forward) {
                assert_eq!(lattice.neighbor(neighbour, backward), Some(index));
            }
        }
    }
}

#[test]
fn default_hull_seats_at_the_envelope_origin() {
    let origin = HULL_ORIGIN;
    assert_eq!(origin, (0, 0, 0));
}

#[test]
fn filling_the_default_hull_marks_exactly_six_cells() {
    let mut lattice = envelope_lattice();
    let origin = HULL_ORIGIN;

    lattice.fill_box(
        origin,
        (DEFAULT_HULL.w, DEFAULT_HULL.h, DEFAULT_HULL.d),
        CELL_INTERIOR,
    );

    let interior = lattice
        .cell_kind_slice()
        .iter()
        .filter(|&&kind| kind == CELL_INTERIOR)
        .count();
    assert_eq!(interior, DEFAULT_HULL.cell_count());
    assert_eq!(interior, 6);

    for z in 0..DEFAULT_HULL.d {
        for x in 0..DEFAULT_HULL.w {
            let index = lattice.cell_index(origin.0 + x, origin.1, origin.2 + z);
            assert_eq!(lattice.cell_kind(index), CELL_INTERIOR);
        }
    }
}

#[test]
fn a_fresh_lattice_is_entirely_outside_and_sealed() {
    let lattice = envelope_lattice();

    assert!(lattice
        .cell_kind_slice()
        .iter()
        .all(|&kind| kind == CELL_OUTSIDE));
    assert!(lattice.face_x_slice().iter().all(|&f| f == FACE_SOLID));
    assert!(lattice.face_y_slice().iter().all(|&f| f == FACE_SOLID));
    assert!(lattice.face_z_slice().iter().all(|&f| f == FACE_SOLID));
}

#[test]
fn face_array_lengths_match_the_staggered_extents() {
    let lattice = envelope_lattice();

    assert_eq!(lattice.cell_count(), 15 * 10 * 20);
    assert_eq!(lattice.face_x_slice().len(), (15 + 1) * 10 * 20);
    assert_eq!(lattice.face_y_slice().len(), 15 * (10 + 1) * 20);
    assert_eq!(lattice.face_z_slice().len(), 15 * 10 * (20 + 1));
}

#[test]
fn dir_index_round_trips_in_a_stable_order() {
    for (expected, dir) in ALL_DIRS.into_iter().enumerate() {
        assert_eq!(dir.index(), expected);
        assert_eq!(Dir::from_index(expected), Some(dir));
    }
    assert_eq!(Dir::from_index(6), None);
}
