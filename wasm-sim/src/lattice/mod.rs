//! Generic 3D cell lattice with staggered face storage.
//!
//! Deliberately knows nothing about the APC, terrain, or any other owner: it
//! stores local cell coordinates only, so it can back both the vehicle interior
//! and future generated structures.

// Remove once the machine layer and WASM getters consume the full surface.
#![allow(dead_code)]

#[cfg(test)]
mod tests;

use wasm_bindgen::prelude::*;

pub const CELL_OUTSIDE: u8 = 0;
pub const CELL_STRUCTURE: u8 = 1;
pub const CELL_INTERIOR: u8 = 2;

pub const FACE_SOLID: u8 = 0;
pub const FACE_OPEN: u8 = 1;
pub const FACE_DOOR: u8 = 2;
pub const FACE_LADDER: u8 = 3;

/// Fixed iteration order. Traversal and transfer determinism depend on this
/// never varying, so it is an array rather than anything set- or map-derived.
#[wasm_bindgen]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Dir {
    NegX = 0,
    PosX = 1,
    NegY = 2,
    PosY = 3,
    NegZ = 4,
    PosZ = 5,
}

pub const ALL_DIRS: [Dir; 6] = [
    Dir::NegX,
    Dir::PosX,
    Dir::NegY,
    Dir::PosY,
    Dir::NegZ,
    Dir::PosZ,
];

impl Dir {
    pub fn index(self) -> usize {
        self as usize
    }

    pub fn from_index(index: usize) -> Option<Dir> {
        ALL_DIRS.get(index).copied()
    }
}

/// Which staggered array a face lives in.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum FaceAxis {
    X,
    Y,
    Z,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Dims {
    pub w: usize,
    pub h: usize,
    pub d: usize,
}

impl Dims {
    pub fn new(w: usize, h: usize, d: usize) -> Self {
        assert!(w > 0 && h > 0 && d > 0, "lattice dims must be non-zero");
        Self { w, h, d }
    }

    pub fn cell_count(self) -> usize {
        self.w * self.h * self.d
    }
}

pub struct Lattice {
    dims: Dims,
    cell_kind: Vec<u8>,
    face_x: Vec<u8>,
    face_y: Vec<u8>,
    face_z: Vec<u8>,
}

impl Lattice {
    pub fn new(dims: Dims) -> Self {
        let Dims { w, h, d } = dims;
        Self {
            dims,
            cell_kind: vec![CELL_OUTSIDE; w * h * d],
            face_x: vec![FACE_SOLID; (w + 1) * h * d],
            face_y: vec![FACE_SOLID; w * (h + 1) * d],
            face_z: vec![FACE_SOLID; w * h * (d + 1)],
        }
    }

    pub fn dims(&self) -> Dims {
        self.dims
    }

    pub fn cell_count(&self) -> usize {
        self.cell_kind.len()
    }

    /// Y is the outermost term so a single horizontal level is contiguous.
    pub fn cell_index(&self, x: usize, y: usize, z: usize) -> usize {
        debug_assert!(x < self.dims.w && y < self.dims.h && z < self.dims.d);
        x + self.dims.w * (z + self.dims.d * y)
    }

    pub fn cell_coords(&self, index: usize) -> (usize, usize, usize) {
        debug_assert!(index < self.cell_kind.len());
        let level = self.dims.w * self.dims.d;
        let y = index / level;
        let rem = index % level;
        (rem % self.dims.w, y, rem / self.dims.w)
    }

    pub fn face_x_index(&self, x: usize, y: usize, z: usize) -> usize {
        debug_assert!(x <= self.dims.w && y < self.dims.h && z < self.dims.d);
        x + (self.dims.w + 1) * (z + self.dims.d * y)
    }

    pub fn face_y_index(&self, x: usize, y: usize, z: usize) -> usize {
        debug_assert!(x < self.dims.w && y <= self.dims.h && z < self.dims.d);
        x + self.dims.w * (z + self.dims.d * y)
    }

    pub fn face_z_index(&self, x: usize, y: usize, z: usize) -> usize {
        debug_assert!(x < self.dims.w && y < self.dims.h && z <= self.dims.d);
        x + self.dims.w * (z + (self.dims.d + 1) * y)
    }

    /// Resolves a cell-plus-direction to the single shared face slot. Both
    /// cells adjacent to a face must resolve to the same slot.
    pub fn face_slot(&self, index: usize, dir: Dir) -> (FaceAxis, usize) {
        let (x, y, z) = self.cell_coords(index);
        match dir {
            Dir::NegX => (FaceAxis::X, self.face_x_index(x, y, z)),
            Dir::PosX => (FaceAxis::X, self.face_x_index(x + 1, y, z)),
            Dir::NegY => (FaceAxis::Y, self.face_y_index(x, y, z)),
            Dir::PosY => (FaceAxis::Y, self.face_y_index(x, y + 1, z)),
            Dir::NegZ => (FaceAxis::Z, self.face_z_index(x, y, z)),
            Dir::PosZ => (FaceAxis::Z, self.face_z_index(x, y, z + 1)),
        }
    }

    /// `None` at the envelope boundary, so a caller that forgets to check the
    /// face state still cannot wrap onto the opposite side of the lattice.
    pub fn neighbor(&self, index: usize, dir: Dir) -> Option<usize> {
        let (x, y, z) = self.cell_coords(index);
        let level = self.dims.w * self.dims.d;
        match dir {
            Dir::NegX if x > 0 => Some(index - 1),
            Dir::PosX if x + 1 < self.dims.w => Some(index + 1),
            Dir::NegY if y > 0 => Some(index - level),
            Dir::PosY if y + 1 < self.dims.h => Some(index + level),
            Dir::NegZ if z > 0 => Some(index - self.dims.w),
            Dir::PosZ if z + 1 < self.dims.d => Some(index + self.dims.w),
            _ => None,
        }
    }

    pub fn cell_kind(&self, index: usize) -> u8 {
        self.cell_kind[index]
    }

    pub fn set_cell_kind(&mut self, index: usize, kind: u8) {
        self.cell_kind[index] = kind;
    }

    pub fn face(&self, index: usize, dir: Dir) -> u8 {
        let (axis, slot) = self.face_slot(index, dir);
        match axis {
            FaceAxis::X => self.face_x[slot],
            FaceAxis::Y => self.face_y[slot],
            FaceAxis::Z => self.face_z[slot],
        }
    }

    pub fn set_face(&mut self, index: usize, dir: Dir, value: u8) {
        let (axis, slot) = self.face_slot(index, dir);
        match axis {
            FaceAxis::X => self.face_x[slot] = value,
            FaceAxis::Y => self.face_y[slot] = value,
            FaceAxis::Z => self.face_z[slot] = value,
        }
    }

    /// Marks an axis-aligned box of cells, used to seed and to expand the hull.
    pub fn fill_box(
        &mut self,
        origin: (usize, usize, usize),
        extent: (usize, usize, usize),
        kind: u8,
    ) {
        let (ox, oy, oz) = origin;
        let (ex, ey, ez) = extent;
        assert!(
            ox + ex <= self.dims.w && oy + ey <= self.dims.h && oz + ez <= self.dims.d,
            "fill_box exceeds lattice envelope"
        );
        for y in oy..oy + ey {
            for z in oz..oz + ez {
                for x in ox..ox + ex {
                    let index = self.cell_index(x, y, z);
                    self.cell_kind[index] = kind;
                }
            }
        }
    }

    pub fn fill_all(&mut self, kind: u8) {
        self.cell_kind.fill(kind);
    }

    pub fn cell_kind_slice(&self) -> &[u8] {
        &self.cell_kind
    }
    pub fn face_x_slice(&self) -> &[u8] {
        &self.face_x
    }

    pub fn face_y_slice(&self) -> &[u8] {
        &self.face_y
    }

    pub fn face_z_slice(&self) -> &[u8] {
        &self.face_z
    }
}
