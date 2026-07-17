export type GameMode =
  | { type: 'freeRoam' }
  | { type: 'subLevel'; buildingId: number; currentFloor: number };

export let gameMode: GameMode = { type: 'freeRoam' };

export function setGameMode(next: GameMode): void {
  gameMode = next;
}
