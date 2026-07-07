// Seed for the terrain noise field.
// Change this to generate a different (but still deterministic) terrain layout.
export const NOISE_SEED = 42;

// World-space X offset applied to noise sampling.
// Increasing/decreasing shifts the entire terrain pattern horizontally without
// changing its overall character (frequency/amplitude stay the same).
export const SEED_X = 0;

// World-space Y/Z offset applied to noise sampling.
// Increasing/decreasing shifts the entire terrain pattern vertically in noise
// space, effectively giving a different section of the same infinite field.
export const SEED_Y = 0;

// Terrain frequency in world units (higher = tighter, bumpier hills).
// Lower values produce broader, smoother rolling terrain; higher values produce
// shorter wavelengths that need denser mesh sampling to avoid jagged artifacts.
export const SCALE = 0.08;

// Vertical amplification applied to sampled terrain height.
// Higher values make hills and valleys taller/deeper; lower values flatten terrain.
export const HEIGHT_MULT = 2;

// Half-width of the simulation shard used for gameplay bounds around origin.
// Larger values allow agents/systems to roam farther; smaller values constrain
// activity closer to the center.
export const SHARD_HALF = 8;

// Total terrain width/depth in world units.
// Increasing expands playable terrain area; decreasing shrinks it.
// Derived values below scale from this to preserve mesh/heightmap density.
export const GROUND_SIZE = 144;

// World units per one terrain mesh segment (lower = denser mesh).
// Lower values increase vertex count and smoothness; higher values reduce detail
// and can introduce faceting on higher-frequency terrain.
export const SEGMENT_DENSITY = 2;

// Number of terrain subdivisions derived from world size and segment density.
// Increasing (via lower SEGMENT_DENSITY or larger GROUND_SIZE) improves visual
// smoothness but increases mesh vertex count and load-time mesh build cost.
export const GROUND_SEGMENTS = Math.round(GROUND_SIZE / SEGMENT_DENSITY);

// Heightmap must match the rendered mesh surface, not the raw noise:
// one sample per mesh vertex means bilinear interpolation over the
// heightmap reproduces the same surface the triangles render, so units
// sit exactly on the visible ground instead of the underlying noise.
export const HEIGHTMAP_GRID_SIZE = GROUND_SEGMENTS + 1;

// Number of units spawned during initial setup.
// Higher values increase scene/simulation load; lower values lighten CPU/GPU cost.
export const UNIT_COUNT = 25;

// Initial spacing between spawned units around the spawn point.
// Higher values spread units farther apart; lower values cluster them tightly.
export const UNIT_SPACING = 0.35;
