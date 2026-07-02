export const selectedUnitIds = new Set<number>();

export let selectedBuildingId: number | null = null;

export function selectUnit(id: number, additive = false): void {
  if (!additive) {
    selectedUnitIds.clear();
  }

  selectedUnitIds.add(id);
  selectedBuildingId = null;
}

export function selectBuilding(id: number): void {
  selectedUnitIds.clear();
  selectedBuildingId = id;
}

export function clearSelection(): void {
  selectedUnitIds.clear();
  selectedBuildingId = null;
}