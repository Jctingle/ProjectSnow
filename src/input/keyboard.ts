import { clearSelection } from './selection';
import { getFocusModeKind, isCubeFocusMode, popFocusModeLevel, type FocusModeKind } from '../focusMode';

let onFocusModeChanged: ((mode: FocusModeKind) => void) | null = null;
let onFocusModeEnter: (() => void) | null = null;
let onSortieCommand: (() => void) | null = null;

export function setFocusModeChangedHandler(handler: ((mode: FocusModeKind) => void) | null): void {
  onFocusModeChanged = handler;
}

export function setFocusModeEnterHandler(handler: (() => void) | null): void {
  onFocusModeEnter = handler;
}

export function setSortieCommandHandler(handler: (() => void) | null): void {
  onSortieCommand = handler;
}

export function attachKeyboardShortcuts(): void {
  window.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.repeat) return;

    if (event.key.toLowerCase() === 'd' && getFocusModeKind() === 'normal') {
      event.preventDefault();
      event.stopPropagation();
      onSortieCommand?.();
      return;
    }

    if (event.key.toLowerCase() === 'f' && getFocusModeKind() === 'normal') {
      event.preventDefault();
      event.stopPropagation();
      onFocusModeEnter?.();
      return;
    }

    if (event.code === 'Space' && isCubeFocusMode()) {
      event.preventDefault();
      event.stopPropagation();
      onFocusModeChanged?.(popFocusModeLevel());
      return;
    }

    if (event.key !== 'Escape') {
      return;
    }

    const mode = getFocusModeKind();
    if (mode !== 'normal') {
      event.preventDefault();
      event.stopPropagation();
      onFocusModeChanged?.(popFocusModeLevel());
      return;
    }

    clearSelection();
  });
}
