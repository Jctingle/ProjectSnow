export const STRUCTURE_CATEGORY = 1;
export const SCRAP_CATEGORY = 2;
export const RAW_RESOURCE_CATEGORY = 3;

export const SCRAP_FIELD_SUBTYPE = 1;
export const NICKEL_BAND_SUBTYPE = 2;
export const LARGE_STRUCTURE_SUBTYPE = 5;
export const SMALL_STRUCTURE_SUBTYPE = 6;

// Structure yaw is derived from the node seed; node meshes and terrain cutout
// fields must resolve it identically or the cutout drifts off the footprint.
export function structureRotationY(seed: number): number {
  return ((seed & 0xff) / 255) * Math.PI * 2;
}
