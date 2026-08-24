import { isFocusMode, rotateFocusAzimuth } from '../focusMode';

const DRAG_SENSITIVITY = 0.01;

// Left-drag rotates the halo-ring camera around the APC while focus mode is active.
// Safe to attach unconditionally: it no-ops whenever focus mode is off.
export function attachFocusOrbitControls(canvas: HTMLCanvasElement): void {
  let dragging = false;
  let lastX = 0;

  canvas.addEventListener('mousedown', (event: MouseEvent) => {
    if (event.button !== 0 || !isFocusMode()) return;
    dragging = true;
    lastX = event.clientX;
  });

  window.addEventListener('mousemove', (event: MouseEvent) => {
    if (!dragging) return;
    const dx = event.clientX - lastX;
    lastX = event.clientX;
    rotateFocusAzimuth(-dx * DRAG_SENSITIVITY);
  });

  const endDrag = (): void => {
    dragging = false;
  };
  window.addEventListener('mouseup', endDrag);
  canvas.addEventListener('mouseleave', endDrag);
}
