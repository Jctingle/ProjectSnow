export const SETTLEMENT_BALANCED_SUBTYPE = 0;
export const SETTLEMENT_PERCHED_SUBTYPE = 3;
export const SETTLEMENT_EMBEDDED_SUBTYPE = 4;

export const SETTLEMENT_DEBUG_BEIGE = '#c7b48f';

export function settlementSubtypeLabel(subtype: number): string {
  if (subtype === SETTLEMENT_PERCHED_SUBTYPE) return 'PERCHED';
  if (subtype === SETTLEMENT_EMBEDDED_SUBTYPE) return 'EMBEDDED';
  return 'BALANCED';
}

export function settlementSubtypeClassNumber(subtype: number): number {
  if (subtype === SETTLEMENT_PERCHED_SUBTYPE) return 2;
  if (subtype === SETTLEMENT_EMBEDDED_SUBTYPE) return 3;
  return 1;
}