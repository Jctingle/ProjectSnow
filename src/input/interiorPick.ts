import * as THREE from 'three';
import { enterCubeFocus, isCubeFocusMode, isFocusMode } from '../focusMode';
import type { ApcInteriorView } from '../world/apcInterior';

// Left-drag already orbits the halo ring, so a gesture that moves beyond this
// many pixels is a drag and must not also register as a selection click.
const DRAG_SLOP_PX = 4;

const ndc = new THREE.Vector2();

// Cell hover and selection inside focus mode. No-ops whenever focus mode is off.
export function attachInteriorPicking(
  canvas: HTMLCanvasElement,
  camera: THREE.Camera,
  view: ApcInteriorView,
): void {
  let downX = 0;
  let downY = 0;
  let dragged = false;

  const toNdc = (event: MouseEvent): boolean => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    ndc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    return true;
  };

  canvas.addEventListener('mousedown', (event: MouseEvent) => {
    if (event.button !== 0) return;
    downX = event.clientX;
    downY = event.clientY;
    dragged = false;
  });

  canvas.addEventListener('mousemove', (event: MouseEvent) => {
    if (!isFocusMode()) return;
    if (
      (event.buttons & 1) !== 0 &&
      (Math.abs(event.clientX - downX) > DRAG_SLOP_PX ||
        Math.abs(event.clientY - downY) > DRAG_SLOP_PX)
    ) {
      dragged = true;
    }
    if (!toNdc(event)) return;
    if (isCubeFocusMode()) {
      view.setHoveredSubcell(view.pickSubcell(ndc, camera));
      return;
    }
    view.setHoveredCell(view.pickCell(ndc, camera));
  });

  canvas.addEventListener('mouseleave', () => {
    if (isCubeFocusMode()) view.setHoveredSubcell(-1);
    else view.setHoveredCell(-1);
  });

  canvas.addEventListener('click', (event: MouseEvent) => {
    if (!isFocusMode() || dragged) return;
    if (!toNdc(event)) return;

    if (isCubeFocusMode()) {
      view.setSelectedSubcell(view.pickSubcell(ndc, camera));
      return;
    }

    const cell = view.pickCell(ndc, camera);
    if (cell < 0) return;
    view.setSelectedCell(cell);
    enterCubeFocus(cell);
  });
}
