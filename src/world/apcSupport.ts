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

export function getApcSupportLayout(width: number, length: number): SupportLayout {
  const halfLength = length * 0.5;
  const halfWidth = width * 0.5;
  return [
    { kind: 'wheel', localX: -halfWidth, localZ: -halfLength },
    { kind: 'wheel', localX: halfWidth, localZ: -halfLength },
    { kind: 'wheel', localX: -halfWidth, localZ: halfLength },
    { kind: 'wheel', localX: halfWidth, localZ: halfLength },
  ];
}