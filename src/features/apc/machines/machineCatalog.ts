import { MachineKind } from '../../../entityStore';

/// Presentation and binding data for one machine type. The sim only knows the
/// `kind` discriminant; everything a player sees or presses is declared here so
/// a new machine costs one entry plus a Rust enum variant.
export type MachineDefinition = {
  id: string;
  kind: MachineKind;
  label: string;
  /// Lowercase `KeyboardEvent.key` that arms placement for this machine.
  hotkey: string;
  color: number;
};

const DEFINITIONS: readonly MachineDefinition[] = [
  { id: 'alpha', kind: MachineKind.Alpha, label: 'Machine A', hotkey: 'a', color: 0x4fa3ff },
  { id: 'beta', kind: MachineKind.Beta, label: 'Machine B', hotkey: 'b', color: 0xff9d3f },
];

/// Kinds that predate the catalog still render, just without a palette entry.
export const UNCATALOGUED_MACHINE_COLOR = 0x8899aa;

export function machineDefinitions(): readonly MachineDefinition[] {
  return DEFINITIONS;
}

export function machineDefinitionForHotkey(key: string): MachineDefinition | null {
  return DEFINITIONS.find((definition) => definition.hotkey === key) ?? null;
}

export function machineColorForKind(kind: number): number {
  return DEFINITIONS.find((definition) => definition.kind === kind)?.color
    ?? UNCATALOGUED_MACHINE_COLOR;
}
