import { clearSelection } from './selection';
import { gameMode, setGameMode } from './gameMode';

export function attachKeyboardShortcuts(): void {
  window.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key !== 'Escape') {
      return;
    }

    clearSelection();

    if (gameMode.type === 'subLevel') {
      setGameMode({ type: 'freeRoam' });
    }
  });
}
