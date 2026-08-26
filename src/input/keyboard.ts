import { clearSelection } from './selection';
import { toggleRecallUnits } from '../ui/devPanel';

export function attachKeyboardShortcuts(): void {
  window.addEventListener('keydown', (event: KeyboardEvent) => {
    if (!event.repeat && event.key.toLowerCase() === 'r') {
      toggleRecallUnits();
      return;
    }

    if (event.key !== 'Escape') {
      return;
    }

    clearSelection();
  });
}
