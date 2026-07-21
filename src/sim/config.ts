// Seed for the terrain noise field.
// Change this to generate a different (but still deterministic) terrain layout.
export const NOISE_SEED = 184254;

// World-space X offset applied to noise sampling.
// Increasing/decreasing shifts the entire terrain pattern horizontally without
// changing its overall character (frequency/amplitude stay the same).
export const SEED_X = 20;

// World-space Y/Z offset applied to noise sampling.
// Increasing/decreasing shifts the entire terrain pattern vertically in noise
// space, effectively giving a different section of the same infinite field.
export const SEED_Y = 10;

// Terrain frequency in world units (higher = tighter, bumpier hills).
// Lower values produce broader, smoother rolling terrain; higher values produce
// shorter wavelengths that need denser mesh sampling to avoid jagged artifacts.
export const SCALE = 0.09;

// Vertical amplification applied to sampled terrain height.
// Higher values make hills and valleys taller/deeper; lower values flatten terrain.
export const HEIGHT_MULT = 2.2200;

// Upper bound on RAW (pre-height_mult) terrain height. Derived from
// the Rust-side generation caps: TIER_MAX (9.0) * max tier_height_scale
// plus sweep amplitude headroom. Used to size the raycast bracket -
// keep in sync if TIER_MAX or tier scaling changes in terrain/mod.rs.
export const MAX_RAW_TERRAIN_HEIGHT = 10.0;

// Warps each seed's influence boundary into irregular crag shapes.
// Higher values produce rougher, more jagged silhouettes; lower values stay rounder.
export const CRAG_STRENGTH = .45;

// Number of angular lobes sampled around each seed's boundary distortion.
// Lower values yield broad bulges; higher values create tighter crags.
export const CRAG_FREQ = 1.0;

// Frequency of the broad "sweep" undulation layered over all terrain,
// including flat plateau tops (unlike SCALE's texture, this isn't
// dampened near seed centers). Much lower than SCALE - should stay
// noticeably broader/slower than the main terrain texture.
export const SWEEP_SCALE = .0390;

// World-height amplitude of the sweep layer.
// Higher values add more visible large-scale rolling variation on top
// of otherwise-flat areas; lower values keep plateaus calmer.
export const SWEEP_AMP = 2.7200;

// Vertical scale applied to each terrain tier level (valleys/plateaus/
// ridges from the seed-cone system). This is now the dominant driver of
// overall terrain height - higher values produce taller peaks and
// deeper valleys; lower values flatten the whole shard toward sea level.
//optimal value : .268
export const TIER_HEIGHT_SCALE = 0.220;

// Half-width of the square region around the APC that wandering units
// pick random targets within.
export const UNIT_WANDER_RADIUS = 8;

// World units around the APC that remain fully clear of the blizzard mask.
export const BLIZZARD_CLEAR_RADIUS = 40;

// Width of the smooth falloff band from fully clear to full whiteout.
export const BLIZZARD_FEATHER_WIDTH = 20;

// Fraction of the clear radius reserved for a fully transparent inner core
// before haze begins to build outward.
export const BLIZZARD_HAZE_START_RATIO = 0.35;

// Shapes the radial alpha curve. Higher values keep the near-APC haze more
// transparent and push denser whiteout farther outward.
export const BLIZZARD_ALPHA_EXPONENT = 1.6;

// Vertical screen-space center of the in-focus tilt-shift band (0=bottom, 1=top).
export const TILT_SHIFT_FOCUS_CENTER = 0.5;

// Width of the fully in-focus horizontal band in normalized screen height.
export const TILT_SHIFT_FOCUS_WIDTH = 0.2;

// Maximum blur radius (in pixels) at the top/bottom screen edges.
export const TILT_SHIFT_BLUR_STRENGTH = 8;

// Master switch for the tilt-shift post-process effect.
// When false, the pass is removed from the composer.
export const TILT_SHIFT_ENABLED = false;

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

// Input diagnostics for click/raycast investigation. Keep off in normal runs.
export const DEBUG_INPUT_LOGGING = false;

// Reserved for future Heat-cost and cliff/pathfinding thresholds.
// Not used by the current debug overlay.
export const SLOPE_EASY_DEG = 15;

// Gradient B's upper bound for slope debug coloring, in percent grade
// (rise/run * 100). 100% grade == 45 degrees.
export const GRADE_MAX_PERCENT = 100;

// Start of Gradient B's yellow->red segment, converted to degrees so
// systems that query slope_degrees_at() can compare directly.
export const GRADIENT_B_RED_START_DEG =
	Math.atan((GRADE_MAX_PERCENT * 0.75) / 100) * (180 / Math.PI);

// Number of units spawned during initial setup.
// Higher values increase scene/simulation load; lower values lighten CPU/GPU cost.
export const UNIT_COUNT = 25;

// Initial spacing between spawned units around the spawn point.
// Higher values spread units farther apart; lower values cluster them tightly.
export const UNIT_SPACING = 0.35;
