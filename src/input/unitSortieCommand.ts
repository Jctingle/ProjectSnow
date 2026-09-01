import * as THREE from 'three';
import {
  beginInteriorUnitBoarding,
  beginInteriorUnitExit,
  beginInteriorUnitReturn,
  completeInteriorUnitBoarding,
  getApcCellKinds,
  getApcInterior,
  getApcSubgridOccupantKinds,
  getInteriorUnitCells,
  getInteriorUnitIds,
  getInteriorUnitModes,
  getInteriorUnitSubcells,
  markInteriorUnitDeployed,
  setInteriorUnitMode,
  InteriorLifecycleResult,
  InteriorUnitMode,
  getSim,
} from '../entityStore';
import { isFocusMode } from '../focusMode';
import { getGroundPointFromScreen } from './raycast';
import type { DestinationMarkerController } from './destinationMarker';
import { createUnitPegGeometry, createUnitPegMaterial, UNIT_PEG_Y_OFFSET } from '../render/unitPeg';

type SortiePhase = 'outbound' | 'returning' | 'boarding';

type ActiveSortie = {
  unitId: number;
  targetX: number;
  targetZ: number;
  phase: SortiePhase;
  phaseStartMs: number;
  phaseDeadlineMs: number;
  outboundStartX: number;
  outboundStartZ: number;
  returnStartX: number;
  returnStartZ: number;
  preferredBoardCell: number;
  preferredBoardLocal: number;
};

export type UnitSortieController = {
  update(nowMs: number): void;
  shiftBy(dx: number, dz: number): void;
  triggerAtCursor(): void;
};

const CELL_INTERIOR = 2;
const OCCUPANT_NONE = 0;
const OUTBOUND_MIN_MS = 900;
const RETURN_MIN_MS = 800;
const WORLD_TRAVEL_SPEED = 3.5;
const LERP_EPSILON = 1e-6;

function randomIndex(maxExclusive: number): number {
  return Math.floor(Math.random() * maxExclusive);
}

function travelDurationMs(fromX: number, fromZ: number, toX: number, toZ: number, minMs: number): number {
  const distance = Math.hypot(toX - fromX, toZ - fromZ);
  const duration = (distance / WORLD_TRAVEL_SPEED) * 1000;
  return Math.max(minMs, duration);
}

export function createUnitSortieController(
  camera: THREE.Camera,
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  marker: DestinationMarkerController,
): UnitSortieController {
  const canvas = renderer.domElement;

  let lastPointerX: number | null = null;
  let lastPointerY: number | null = null;
  let activeSortie: ActiveSortie | null = null;
  let sortieMesh: THREE.Mesh | null = null;

  const sortieGeometry = createUnitPegGeometry();
  const sortieMaterial = createUnitPegMaterial();

  const ensureSortieMesh = (): THREE.Mesh => {
    if (sortieMesh) return sortieMesh;
    sortieMesh = new THREE.Mesh(sortieGeometry, sortieMaterial);
    sortieMesh.visible = false;
    scene.add(sortieMesh);
    return sortieMesh;
  };

  const setSortieMeshAt = (x: number, z: number): void => {
    const sim = getSim();
    const y = sim.height_at_or_sample(x, z) * sim.height_mult() + UNIT_PEG_Y_OFFSET;
    const mesh = ensureSortieMesh();
    mesh.position.set(x, y, z);
    mesh.visible = true;
  };

  const hideSortieMesh = (): void => {
    if (sortieMesh) sortieMesh.visible = false;
  };

  const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

  const phaseProgress = (nowMs: number, startMs: number, endMs: number): number => {
    const span = endMs - startMs;
    if (span <= LERP_EPSILON) return 1;
    return Math.min(Math.max((nowMs - startMs) / span, 0), 1);
  };

  canvas.addEventListener('mousemove', (event: MouseEvent) => {
    lastPointerX = event.clientX;
    lastPointerY = event.clientY;
  });

  const clearSortie = (): void => {
    activeSortie = null;
    marker.clear();
    hideSortieMesh();
  };

  const chooseCandidateUnit = (): {
    unitId: number;
    cell: number;
    local: number;
  } | null => {
    const count = getApcInterior().interior_unit_count();
    if (count <= 0) return null;

    const ids = getInteriorUnitIds();
    const modes = getInteriorUnitModes();
    const cells = getInteriorUnitCells();
    const locals = getInteriorUnitSubcells();

    const candidates: number[] = [];
    for (let i = 0; i < count; i++) {
      const mode = modes[i];
      if (mode !== InteriorUnitMode.BoardedIdle && mode !== InteriorUnitMode.AssignedMachine) {
        continue;
      }
      if (cells[i] === 0xffffffff || locals[i] === 0xff) {
        continue;
      }
      candidates.push(i);
    }

    if (candidates.length === 0) return null;

    const picked = candidates[randomIndex(candidates.length)];
    return {
      unitId: ids[picked],
      cell: cells[picked],
      local: locals[picked],
    };
  };

  const findBoardSlot = (preferredCell: number, preferredLocal: number): { cell: number; local: number } | null => {
    const cellKinds = getApcCellKinds();
    const occupantKinds = getApcSubgridOccupantKinds();

    const isFree = (cell: number, local: number): boolean => {
      if (local < 0 || local > 3) return false;
      if (cell < 0 || cell >= cellKinds.length) return false;
      if (cellKinds[cell] !== CELL_INTERIOR) return false;
      const index = cell * 8 + local;
      return index >= 0 && index < occupantKinds.length && occupantKinds[index] === OCCUPANT_NONE;
    };

    if (isFree(preferredCell, preferredLocal)) {
      return { cell: preferredCell, local: preferredLocal };
    }

    for (let cell = 0; cell < cellKinds.length; cell++) {
      if (cellKinds[cell] !== CELL_INTERIOR) continue;
      for (let local = 0; local < 4; local++) {
        if (isFree(cell, local)) return { cell, local };
      }
    }

    return null;
  };

  const transitionToReturning = (nowMs: number): void => {
    if (!activeSortie) return;

    const result = beginInteriorUnitReturn(activeSortie.unitId);
    if (result !== InteriorLifecycleResult.Ok) {
      clearSortie();
      return;
    }

    const sim = getSim();
    activeSortie.returnStartX = activeSortie.targetX;
    activeSortie.returnStartZ = activeSortie.targetZ;
    const returnMs = travelDurationMs(activeSortie.targetX, activeSortie.targetZ, sim.apc_x(), sim.apc_z(), RETURN_MIN_MS);
    activeSortie.phase = 'returning';
    activeSortie.phaseStartMs = nowMs;
    activeSortie.phaseDeadlineMs = nowMs + returnMs;

    marker.rebuild([{ x: activeSortie.targetX, z: activeSortie.targetZ }], sim.apc_y());
  };

  const transitionToBoarding = (): boolean => {
    if (!activeSortie) return false;
    const result = beginInteriorUnitBoarding(activeSortie.unitId);
    return result === InteriorLifecycleResult.Ok;
  };

  const completeBoarding = (): boolean => {
    if (!activeSortie) return false;

    const slot = findBoardSlot(activeSortie.preferredBoardCell, activeSortie.preferredBoardLocal);
    if (!slot) return false;

    const result = completeInteriorUnitBoarding(
      activeSortie.unitId,
      slot.cell,
      slot.local,
    );
    return result === InteriorLifecycleResult.Ok;
  };

  const triggerAtCursor = (): void => {
    if (activeSortie || isFocusMode()) return;
    if (lastPointerX === null || lastPointerY === null) return;

    const worldPoint = getGroundPointFromScreen(lastPointerX, lastPointerY, camera, renderer);
    if (!worldPoint) return;

    const candidate = chooseCandidateUnit();
    if (!candidate) return;

    const beginExit = beginInteriorUnitExit(candidate.unitId);
    if (beginExit !== InteriorLifecycleResult.Ok) return;

    const deployed = markInteriorUnitDeployed(candidate.unitId);
    if (deployed !== InteriorLifecycleResult.Ok) {
      setInteriorUnitMode(candidate.unitId, InteriorUnitMode.BoardedIdle);
      return;
    }

    const sim = getSim();
    const now = performance.now();
    const outboundMs = travelDurationMs(sim.apc_x(), sim.apc_z(), worldPoint.x, worldPoint.z, OUTBOUND_MIN_MS);

    activeSortie = {
      unitId: candidate.unitId,
      targetX: worldPoint.x,
      targetZ: worldPoint.z,
      phase: 'outbound',
      phaseStartMs: now,
      phaseDeadlineMs: now + outboundMs,
      outboundStartX: sim.apc_x(),
      outboundStartZ: sim.apc_z(),
      returnStartX: worldPoint.x,
      returnStartZ: worldPoint.z,
      preferredBoardCell: candidate.cell,
      preferredBoardLocal: candidate.local,
    };

    setSortieMeshAt(sim.apc_x(), sim.apc_z());
    marker.rebuild([{ x: worldPoint.x, z: worldPoint.z }], sim.apc_y());
  };

  const update = (nowMs: number): void => {
    if (!activeSortie) return;

    const sim = getSim();
    if (activeSortie.phase === 'outbound') {
      const t = phaseProgress(nowMs, activeSortie.phaseStartMs, activeSortie.phaseDeadlineMs);
      setSortieMeshAt(
        lerp(activeSortie.outboundStartX, activeSortie.targetX, t),
        lerp(activeSortie.outboundStartZ, activeSortie.targetZ, t),
      );
      if (nowMs < activeSortie.phaseDeadlineMs) {
        marker.updateDynamicLine();
        return;
      }
      setSortieMeshAt(activeSortie.targetX, activeSortie.targetZ);
      transitionToReturning(nowMs);
      return;
    }

    if (activeSortie.phase === 'returning') {
      const t = phaseProgress(nowMs, activeSortie.phaseStartMs, activeSortie.phaseDeadlineMs);
      setSortieMeshAt(
        lerp(activeSortie.returnStartX, sim.apc_x(), t),
        lerp(activeSortie.returnStartZ, sim.apc_z(), t),
      );
      if (nowMs < activeSortie.phaseDeadlineMs) {
        marker.updateDynamicLine();
        return;
      }
      if (!transitionToBoarding()) {
        clearSortie();
        return;
      }
      activeSortie.phase = 'boarding';
      activeSortie.phaseDeadlineMs = nowMs + 1;
      return;
    }

    if (!completeBoarding()) {
      activeSortie.phaseDeadlineMs = nowMs + 250;
      return;
    }

    marker.clear();
    activeSortie = null;
    hideSortieMesh();
    marker.rebuild([], sim.apc_y());
  };

  const shiftBy = (dx: number, dz: number): void => {
    if (!activeSortie) return;
    activeSortie.targetX += dx;
    activeSortie.targetZ += dz;
    const sim = getSim();
    marker.shiftBy(dx, dz, [{ x: activeSortie.targetX, z: activeSortie.targetZ }], sim.apc_y());
  };

  return {
    update,
    shiftBy,
    triggerAtCursor,
  };
}
