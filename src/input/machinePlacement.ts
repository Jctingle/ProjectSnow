import * as THREE from 'three';
import { isSubcellFree, placeMachineAtSubcell } from '../entityStore';
import {
  machineDefinitionForHotkey,
  type MachineDefinition,
} from '../features/apc/machines/machineCatalog';
import { isCubeFocusMode, selectedCube } from '../focusMode';
import type { ApcInteriorView } from '../world/apcInterior';

// Matches the interior picker: left-drag orbits, so a gesture that travels
// further than this is a camera move and must not also drop a machine.
const DRAG_SLOP_PX = 4;

const ndc = new THREE.Vector2();

/// Arms machine placement from the catalogue hotkeys while a cube is
/// sub-focused. The held machine follows the cursor as a ghost and commits into
/// the subcell the cursor faces; leaving sub-focus discards it.
export function attachMachinePlacement(
  canvas: HTMLCanvasElement,
  camera: THREE.Camera,
  view: ApcInteriorView,
): void {
  let held: MachineDefinition | null = null;
  let targetSubcell = -1;
  let downX = 0;
  let downY = 0;

  const clear = (): void => {
    if (!held) return;
    held = null;
    targetSubcell = -1;
    view.setMachinePlacementPreview(null);
  };

  const refreshPreview = (): void => {
    const cell = selectedCube();
    if (!held || cell === null) {
      clear();
      return;
    }
    view.setMachinePlacementPreview(
      targetSubcell < 0
        ? null
        : {
            local: targetSubcell,
            color: held.color,
            valid: isSubcellFree(cell, targetSubcell),
          },
    );
  };

  const trackCursor = (event: MouseEvent): void => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    ndc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    targetSubcell = view.pickSubcell(ndc, camera);
    refreshPreview();
  };

  window.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.repeat) return;

    if (event.code === 'Space' || event.key === 'Escape') {
      clear();
      return;
    }

    if (!isCubeFocusMode()) return;
    const definition = machineDefinitionForHotkey(event.key.toLowerCase());
    if (!definition) return;

    event.preventDefault();
    event.stopPropagation();

    // Re-pressing the armed machine's key disarms; a different key swaps kind.
    if (held?.id === definition.id) {
      clear();
      return;
    }
    held = definition;
    refreshPreview();
  });

  canvas.addEventListener('mousedown', (event: MouseEvent) => {
    downX = event.clientX;
    downY = event.clientY;
  });

  canvas.addEventListener('mousemove', (event: MouseEvent) => {
    if (!held) return;
    if (!isCubeFocusMode()) {
      clear();
      return;
    }
    trackCursor(event);
  });

  canvas.addEventListener('mouseleave', () => {
    if (!held) return;
    targetSubcell = -1;
    refreshPreview();
  });

  // Capture on window so the commit resolves before the interior picker's
  // click handler on the canvas turns the same press into a subcell selection.
  window.addEventListener(
    'click',
    (event: MouseEvent) => {
      if (!held || event.target !== canvas || event.button !== 0) return;
      if (
        Math.abs(event.clientX - downX) > DRAG_SLOP_PX ||
        Math.abs(event.clientY - downY) > DRAG_SLOP_PX
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const cell = selectedCube();
      if (cell === null || targetSubcell < 0) return;
      if (placeMachineAtSubcell(cell, targetSubcell, held.kind) < 0) return;

      // Machine arrays reallocate on insert, and a join rewrites footprints, so
      // the instanced meshes are rebuilt rather than patched.
      view.rebuild();
      refreshPreview();
    },
    true,
  );
}
