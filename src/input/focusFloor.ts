import { isCubeFocusMode, isFocusMode, scrollFocusLevel } from '../focusMode';

// Trackpads emit many small fractional deltas per gesture while a mouse notch
// arrives as one large delta, so steps are accumulated to a threshold and
// capped at one floor per event to keep both feeling like one notch, one floor.
const STEP_THRESHOLD = 40;
const LINE_HEIGHT_PX = 16;

// Mousewheel scrolls through interior floors while focus mode is active.
// Safe to attach unconditionally: it no-ops whenever focus mode is off.
export function attachFocusFloorControls(canvas: HTMLCanvasElement): void {
  let accumulated = 0;

  canvas.addEventListener(
    'wheel',
    (event: WheelEvent) => {
      if (!isFocusMode()) return;
      event.preventDefault();
      if (isCubeFocusMode()) return;

      const pixels = event.deltaMode === 1 ? event.deltaY * LINE_HEIGHT_PX : event.deltaY;
      if (pixels === 0) return;
      if (Math.sign(pixels) !== Math.sign(accumulated)) accumulated = 0;
      accumulated += pixels;

      if (accumulated <= -STEP_THRESHOLD) {
        scrollFocusLevel(1);
        accumulated = 0;
      } else if (accumulated >= STEP_THRESHOLD) {
        scrollFocusLevel(-1);
        accumulated = 0;
      }
    },
    { passive: false },
  );
}
