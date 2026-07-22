import { APC_HULL_LENGTH, APC_HULL_WIDTH } from '../sim/config';

type SupportSlotBase = {
  localX: number;
  localZ: number;
};

export type WheelSupportSlot = SupportSlotBase & {
  kind: 'wheel';
};

export type TreadSupportSlot = SupportSlotBase & {
  kind: 'tread';
  length: number;
  sampleCount: number;
};

export type SupportSlot = WheelSupportSlot | TreadSupportSlot;
export type SupportLayout = readonly SupportSlot[];

const halfLength = APC_HULL_LENGTH * 0.5;
const halfWidth = APC_HULL_WIDTH * 0.5;

export const DEFAULT_APC_SUPPORT_LAYOUT: SupportLayout = [
  { kind: 'wheel', localX: -halfWidth, localZ: -halfLength },
  { kind: 'wheel', localX: halfWidth, localZ: -halfLength },
  { kind: 'wheel', localX: -halfWidth, localZ: halfLength },
  { kind: 'wheel', localX: halfWidth, localZ: halfLength },
];