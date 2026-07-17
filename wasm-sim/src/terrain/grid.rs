use super::Terrain;

impl Terrain {
    pub fn generate_heightmap(&mut self, grid_w: usize, grid_h: usize, world_w: f32, world_h: f32) {
        if grid_w == 0 || grid_h == 0 {
            self.heightmap.clear();
            self.hm_width = 0;
            self.hm_height = 0;
            self.hm_half_w = world_w * 0.5;
            self.hm_half_h = world_h * 0.5;
            self.hm_cell_w = world_w.max(1.0);
            self.hm_cell_h = world_h.max(1.0);
            return;
        }

        self.heightmap = vec![0.0; grid_w * grid_h];
        self.hm_width = grid_w;
        self.hm_height = grid_h;
        self.hm_half_w = world_w * 0.5;
        self.hm_half_h = world_h * 0.5;
        self.hm_cell_w = if grid_w > 1 {
            (world_w / (grid_w as f32 - 1.0)).max(f32::EPSILON)
        } else {
            world_w.max(1.0)
        };
        self.hm_cell_h = if grid_h > 1 {
            (world_h / (grid_h as f32 - 1.0)).max(f32::EPSILON)
        } else {
            world_h.max(1.0)
        };

        for row in 0..grid_h {
            let vz = if grid_h > 1 {
                row as f32 / (grid_h as f32 - 1.0)
            } else {
                0.5
            };
            let wz = (vz - 0.5) * world_h;
            for col in 0..grid_w {
                let vx = if grid_w > 1 {
                    col as f32 / (grid_w as f32 - 1.0)
                } else {
                    0.5
                };
                let wx = (vx - 0.5) * world_w;
                self.heightmap[row * grid_w + col] = self.sample_height(wx as f64, wz as f64);
            }
        }
    }

    /// Must be called after generate_heightmap(). Builds a slope-degrees
    /// grid at the same resolution as self.heightmap, using central
    /// differences over the cached heights. At grid borders, this uses a
    /// one-cell halo sample from sample_height() instead of clamping back
    /// to the edge cell so seam-adjacent debug slopes match across shards.
    /// This is the debug-overlay-only path - gameplay code should call
    /// slope_degrees_at() instead, not this grid.
    pub fn generate_slopemap(&mut self) {
        let w = self.hm_width;
        let h = self.hm_height;

        if w < 2 || h < 2 {
            self.slopemap = vec![0.0; w * h];
            return;
        }

        let mut slopemap = vec![0.0; w * h];
        let sample_or_halo = |col: isize, row: isize| -> f32 {
            if col >= 0 && row >= 0 && (col as usize) < w && (row as usize) < h {
                return self.heightmap[row as usize * w + col as usize];
            }

            let wx = -self.hm_half_w + col as f32 * self.hm_cell_w;
            let wz = -self.hm_half_h + row as f32 * self.hm_cell_h;
            self.sample_height(wx as f64, wz as f64)
        };

        for row in 0..h {
            for col in 0..w {
                let x0 = col as isize - 1;
                let x1 = col as isize + 1;
                let z0 = row as isize - 1;
                let z1 = row as isize + 1;

                let h_x0 = sample_or_halo(x0, row as isize);
                let h_x1 = sample_or_halo(x1, row as isize);
                let h_z0 = sample_or_halo(col as isize, z0);
                let h_z1 = sample_or_halo(col as isize, z1);

                let dx = (x1 - x0) as f32 * self.hm_cell_w;
                let dz = (z1 - z0) as f32 * self.hm_cell_h;

                let dhx = (h_x1 - h_x0) * self.height_mult / dx.max(f32::EPSILON);
                let dhz = (h_z1 - h_z0) * self.height_mult / dz.max(f32::EPSILON);

                let gradient = (dhx * dhx + dhz * dhz).sqrt();
                slopemap[row * w + col] = gradient.atan().to_degrees();
            }
        }

        self.slopemap = slopemap;
    }

    #[inline]
    pub fn height_at_or_sample(&self, x: f32, z: f32) -> f32 {
        if self.hm_width < 2 || self.hm_height < 2 {
            return self.sample_height(x as f64, z as f64);
        }

        let gx = (x + self.hm_half_w) / self.hm_cell_w;
        let gz = (z + self.hm_half_h) / self.hm_cell_h;

        if gx < 0.0
            || gz < 0.0
            || gx > (self.hm_width - 1) as f32
            || gz > (self.hm_height - 1) as f32
        {
            return self.sample_height(x as f64, z as f64);
        }

        self.sample_triangle(gx, gz)
    }

    #[inline]
    pub fn height_at_clamped(&self, x: f32, z: f32) -> f32 {
        if self.hm_width < 2 || self.hm_height < 2 {
            return self.sample_height(x as f64, z as f64);
        }

        let gx = (x + self.hm_half_w) / self.hm_cell_w;
        let gz = (z + self.hm_half_h) / self.hm_cell_h;
        let cx = gx.clamp(0.0, (self.hm_width - 1) as f32);
        let cz = gz.clamp(0.0, (self.hm_height - 1) as f32);

        self.sample_triangle(cx, cz)
    }

    pub fn height_mult(&self) -> f32 {
        self.height_mult
    }

    pub fn heightmap_ptr(&self) -> *const f32 {
        self.heightmap.as_ptr()
    }

    pub fn slopemap_ptr(&self) -> *const f32 {
        self.slopemap.as_ptr()
    }

    #[inline]
    fn sample_triangle(&self, gx: f32, gz: f32) -> f32 {
        let x0 = gx as usize;
        let z0 = gz as usize;
        let x1 = (x0 + 1).min(self.hm_width - 1);
        let z1 = (z0 + 1).min(self.hm_height - 1);
        let fx = gx - x0 as f32;
        let fz = gz - z0 as f32;

        let w = self.hm_width;
        let h00 = self.heightmap[z0 * w + x0];
        let h10 = self.heightmap[z0 * w + x1];
        let h01 = self.heightmap[z1 * w + x0];
        let h11 = self.heightmap[z1 * w + x1];

        // Match Three.js PlaneGeometry quad triangulation so sampled unit heights
        // lie on the same flat triangles that the terrain mesh renders.
        if fx + fz <= 1.0 {
            h00 + (h10 - h00) * fx + (h01 - h00) * fz
        } else {
            h11 + (h01 - h11) * (1.0 - fx) + (h10 - h11) * (1.0 - fz)
        }
    }
}