export const selectedUnitIds = new Set<number>();

export let selectedBuildingId: number | null = null;

type SelectionListener = () => void;

const selectionListeners = new Set<SelectionListener>();

function emitSelectionChanged(): void {
  for (const listener of selectionListeners) {
    listener();
  }
}

export function getSelectedUnitId(): number | null {
  const first = selectedUnitIds.values().next();
  return first.done ? null : first.value;
}

export function isUnitSelected(id: number): boolean {
  return selectedUnitIds.has(id);
}

export function subscribeSelectionChanged(listener: SelectionListener): () => void {
  selectionListeners.add(listener);
  return () => {
    selectionListeners.delete(listener);
  };
}

export function selectUnit(id: number, additive = false): void {
  if (!additive) {
    selectedUnitIds.clear();
  }

  selectedUnitIds.add(id);
  selectedBuildingId = null;
  emitSelectionChanged();
}

export function toggleUnitSelection(id: number): void {
  if (selectedUnitIds.size === 1 && selectedUnitIds.has(id) && selectedBuildingId === null) {
    clearSelection();
    return;
  }

  selectUnit(id);
}

export function selectBuilding(id: number): void {
  selectedUnitIds.clear();
  selectedBuildingId = id;
  emitSelectionChanged();
}

export function clearSelection(): void {
  selectedUnitIds.clear();
  selectedBuildingId = null;
  emitSelectionChanged();
}