import { nearestSlopeAt } from '../world/slopeLookup';

export const DestinationRejectReason = {
  CLIFF: 'CLIFF',
} as const;

export type DestinationRejectReason =
  (typeof DestinationRejectReason)[keyof typeof DestinationRejectReason];

// Checks terrain standability (slope/cliff) only, not route/path reachability.
// A future isReachable check will be added separately and share this denial pathway.
export function isStandable(
  x: number,
  z: number,
  maxSlopeDeg: number,
  slopemap: Float32Array
): { valid: boolean; reason?: DestinationRejectReason } {
  const slopeDeg = nearestSlopeAt(slopemap, x, z);

  if (slopeDeg > maxSlopeDeg) {
    return { valid: false, reason: DestinationRejectReason.CLIFF };
  }

  return { valid: true };
}
