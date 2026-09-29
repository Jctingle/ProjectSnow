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
import { getSelectedUnitId } from './selection';
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

const SORTIE_SNAPSHOT_FORMAT_VERSION = 1;
const SORTIE_SNAPSHOT_MAX_RECORDS = 1024;
const SORTIE_SNAPSHOT_MAX_PHASE_MS = 10 * 60 * 1000;

export type SortieSnapshotPhase = SortiePhase;

export type SortieSnapshotRecord = {
  unitId: number;
  targetX: number;
  targetZ: number;
  phase: SortieSnapshotPhase;
  phaseElapsedMs: number;
  phaseRemainingMs: number;
  outboundStartX: number;
  outboundStartZ: number;
  returnStartX: number;
  returnStartZ: number;
  preferredBoardCell: number;
  preferredBoardLocal: number;
};

type SortieSnapshotEnvelope = {
  formatVersion: number;
  records: SortieSnapshotRecord[];
};

export type UnitSortieController = {
  update(nowMs: number): void;
  shiftBy(dx: number, dz: number): void;
  triggerAtCursor(): void;
  getWorldPosition(unitId: number, out: THREE.Vector3): boolean;
  setSelectedUnit(unitId: number | null): void;
  captureSnapshot(nowMs: number): SortieSnapshotRecord[];
  restoreSnapshot(records: SortieSnapshotRecord[], nowMs: number): string | null;
};

const CELL_INTERIOR = 2;
const OCCUPANT_NONE = 0;
const OUTBOUND_MIN_MS = 900;
const RETURN_MIN_MS = 800;
const WORLD_TRAVEL_SPEED = 3.5;
const LERP_EPSILON = 1e-6;
const SELECTED_UNIT_OUTLINE_COLOR = 0xe0b84f;

function travelDurationMs(fromX: number, fromZ: number, toX: number, toZ: number, minMs: number): number {
  const distance = Math.hypot(toX - fromX, toZ - fromZ);
  const duration = (distance / WORLD_TRAVEL_SPEED) * 1000;
  return Math.max(minMs, duration);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isValidPhase(phase: unknown): phase is SortiePhase {
  return phase === 'outbound' || phase === 'returning' || phase === 'boarding';
}

function validateSortieSnapshotRecord(record: SortieSnapshotRecord): string | null {
  if (!Number.isInteger(record.unitId) || record.unitId < 0) return 'unit id invalid';
  if (!isValidPhase(record.phase)) return 'sortie phase invalid';
  if (!isFiniteNumber(record.targetX) || !isFiniteNumber(record.targetZ)) {
    return 'sortie target invalid';
  }
  if (!isFiniteNumber(record.outboundStartX) || !isFiniteNumber(record.outboundStartZ)) {
    return 'sortie outbound start invalid';
  }
  if (!isFiniteNumber(record.returnStartX) || !isFiniteNumber(record.returnStartZ)) {
    return 'sortie return start invalid';
  }
  if (
    !isFiniteNumber(record.phaseElapsedMs) ||
    record.phaseElapsedMs < 0 ||
    record.phaseElapsedMs > SORTIE_SNAPSHOT_MAX_PHASE_MS
  ) {
    return 'sortie elapsed duration invalid';
  }
  if (
    !isFiniteNumber(record.phaseRemainingMs) ||
    record.phaseRemainingMs < 0 ||
    record.phaseRemainingMs > SORTIE_SNAPSHOT_MAX_PHASE_MS
  ) {
    return 'sortie remaining duration invalid';
  }
  if (!Number.isInteger(record.preferredBoardCell) || record.preferredBoardCell < 0) {
    return 'sortie preferred board cell invalid';
  }
  if (!Number.isInteger(record.preferredBoardLocal) || record.preferredBoardLocal < 0 || record.preferredBoardLocal > 3) {
    return 'sortie preferred board local invalid';
  }
  return null;
}

export function serializeSortieSnapshot(records: SortieSnapshotRecord[]): string {
  const envelope: SortieSnapshotEnvelope = {
    formatVersion: SORTIE_SNAPSHOT_FORMAT_VERSION,
    records,
  };
  return JSON.stringify(envelope);
}

export function deserializeSortieSnapshot(snapshotJson: string): {
  records: SortieSnapshotRecord[] | null;
  error: string | null;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(snapshotJson);
  } catch {
    return { records: null, error: 'sortie snapshot decode failed' };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { records: null, error: 'sortie snapshot envelope invalid' };
  }

  const envelope = parsed as Partial<SortieSnapshotEnvelope>;
  if (envelope.formatVersion !== SORTIE_SNAPSHOT_FORMAT_VERSION) {
    return { records: null, error: 'unsupported sortie snapshot format version' };
  }
  if (!Array.isArray(envelope.records)) {
    return { records: null, error: 'sortie snapshot records missing' };
  }
  if (envelope.records.length > SORTIE_SNAPSHOT_MAX_RECORDS) {
    return { records: null, error: 'sortie snapshot record count exceeds limit' };
  }

  const seenUnitIds = new Set<number>();
  const validated: SortieSnapshotRecord[] = [];
  for (const rawRecord of envelope.records) {
    if (!rawRecord || typeof rawRecord !== 'object') {
      return { records: null, error: 'sortie record invalid' };
    }
    const record = rawRecord as SortieSnapshotRecord;
    const error = validateSortieSnapshotRecord(record);
    if (error) return { records: null, error };
    if (seenUnitIds.has(record.unitId)) {
      return { records: null, error: 'duplicate sortie unit id' };
    }
    seenUnitIds.add(record.unitId);
    validated.push({ ...record });
  }

  return { records: validated, error: null };
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
  const activeSorties = new Map<number, ActiveSortie>();
  const sortieMeshes = new Map<number, THREE.Mesh>();
  const sortieOutlineMeshes = new Map<number, THREE.Mesh>();
  let selectedUnitId: number | null = null;

  const sortieGeometry = createUnitPegGeometry();
  const sortieMaterial = createUnitPegMaterial();
  const sortieOutlineMaterial = new THREE.MeshBasicMaterial({
    color: SELECTED_UNIT_OUTLINE_COLOR,
    side: THREE.BackSide,
    transparent: true,
    opacity: 0.98,
    depthTest: false,
    depthWrite: false,
  });

  const ensureSortieMesh = (unitId: number): THREE.Mesh => {
    const existing = sortieMeshes.get(unitId);
    if (existing) return existing;
    const mesh = new THREE.Mesh(sortieGeometry, sortieMaterial);
    mesh.visible = false;
    scene.add(mesh);
    sortieMeshes.set(unitId, mesh);
    return mesh;
  };

  const ensureSortieOutlineMesh = (unitId: number): THREE.Mesh => {
    const existing = sortieOutlineMeshes.get(unitId);
    if (existing) return existing;
    const mesh = new THREE.Mesh(sortieGeometry, sortieOutlineMaterial);
    mesh.scale.setScalar(1.3);
    mesh.visible = false;
    scene.add(mesh);
    sortieOutlineMeshes.set(unitId, mesh);
    return mesh;
  };

  const refreshSelectedOutlineVisibility = (): void => {
    for (const [unitId, outline] of sortieOutlineMeshes) {
      outline.visible = unitId === selectedUnitId && activeSorties.has(unitId);
    }
  };

  const rebuildMarkers = (): void => {
    const sim = getSim();
    marker.rebuild(
      Array.from(activeSorties.values(), (sortie) => ({
        x: sortie.targetX,
        z: sortie.targetZ,
      })),
      sim.apc_y(),
    );
  };

  const setSortieMeshAt = (unitId: number, x: number, z: number): void => {
    const sim = getSim();
    const y = sim.height_at_or_sample(x, z) * sim.height_mult() + UNIT_PEG_Y_OFFSET;
    const mesh = ensureSortieMesh(unitId);
    mesh.position.set(x, y, z);
    mesh.visible = true;
    const outline = ensureSortieOutlineMesh(unitId);
    outline.position.copy(mesh.position);
    outline.visible = unitId === selectedUnitId;
  };

  const writeWorldPosition = (
    out: THREE.Vector3,
    x: number,
    z: number,
  ): boolean => {
    const sim = getSim();
    out.set(
      x,
      sim.height_at_or_sample(x, z) * sim.height_mult() + UNIT_PEG_Y_OFFSET,
      z,
    );
    return true;
  };

  const hideSortieMesh = (unitId: number): void => {
    const mesh = sortieMeshes.get(unitId);
    if (mesh) mesh.visible = false;
    const outline = sortieOutlineMeshes.get(unitId);
    if (outline) outline.visible = false;
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

  const clearSortie = (unitId: number): void => {
    activeSorties.delete(unitId);
    hideSortieMesh(unitId);
    rebuildMarkers();
  };

  const selectedCandidateUnit = (): {
    unitId: number;
    cell: number;
    local: number;
  } | null => {
    const unitId = selectedUnitId ?? getSelectedUnitId();
    if (unitId === null) return null;
    if (activeSorties.has(unitId)) return null;

    const count = getApcInterior().interior_unit_count();
    if (count <= 0) return null;

    const ids = getInteriorUnitIds();
    const modes = getInteriorUnitModes();
    const cells = getInteriorUnitCells();
    const locals = getInteriorUnitSubcells();

    for (let i = 0; i < count; i++) {
      if (ids[i] !== unitId) continue;

      const mode = modes[i];
      if (mode !== InteriorUnitMode.BoardedIdle && mode !== InteriorUnitMode.AssignedMachine) {
        return null;
      }
      if (cells[i] === 0xffffffff || locals[i] === 0xff) {
        return null;
      }

      return {
        unitId,
        cell: cells[i],
        local: locals[i],
      };
    }

    return null;
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

  const transitionToReturning = (sortie: ActiveSortie, nowMs: number): void => {
    const result = beginInteriorUnitReturn(sortie.unitId);
    if (result !== InteriorLifecycleResult.Ok) {
      clearSortie(sortie.unitId);
      return;
    }

    const sim = getSim();
    sortie.returnStartX = sortie.targetX;
    sortie.returnStartZ = sortie.targetZ;
    const returnMs = travelDurationMs(sortie.targetX, sortie.targetZ, sim.apc_x(), sim.apc_z(), RETURN_MIN_MS);
    sortie.phase = 'returning';
    sortie.phaseStartMs = nowMs;
    sortie.phaseDeadlineMs = nowMs + returnMs;
  };

  const transitionToBoarding = (sortie: ActiveSortie): boolean => {
    const result = beginInteriorUnitBoarding(sortie.unitId);
    return result === InteriorLifecycleResult.Ok;
  };

  const completeBoarding = (sortie: ActiveSortie): boolean => {
    const slot = findBoardSlot(sortie.preferredBoardCell, sortie.preferredBoardLocal);
    if (!slot) return false;

    const result = completeInteriorUnitBoarding(
      sortie.unitId,
      slot.cell,
      slot.local,
    );
    return result === InteriorLifecycleResult.Ok;
  };

  const triggerAtCursor = (): void => {
    if (isFocusMode()) return;
    if (lastPointerX === null || lastPointerY === null) return;

    const worldPoint = getGroundPointFromScreen(lastPointerX, lastPointerY, camera, renderer);
    if (!worldPoint) return;

    const candidate = selectedCandidateUnit();
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

    const activeSortie: ActiveSortie = {
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
    activeSorties.set(candidate.unitId, activeSortie);

    setSortieMeshAt(candidate.unitId, sim.apc_x(), sim.apc_z());
    rebuildMarkers();
  };

  const update = (nowMs: number): void => {
    if (activeSorties.size === 0) return;

    marker.updateDynamicLine();

    const sim = getSim();
    for (const sortie of activeSorties.values()) {
      if (sortie.phase === 'outbound') {
        const t = phaseProgress(nowMs, sortie.phaseStartMs, sortie.phaseDeadlineMs);
        setSortieMeshAt(
          sortie.unitId,
          lerp(sortie.outboundStartX, sortie.targetX, t),
          lerp(sortie.outboundStartZ, sortie.targetZ, t),
        );
        if (nowMs < sortie.phaseDeadlineMs) {
          continue;
        }
        setSortieMeshAt(sortie.unitId, sortie.targetX, sortie.targetZ);
        transitionToReturning(sortie, nowMs);
        continue;
      }

      if (sortie.phase === 'returning') {
        const t = phaseProgress(nowMs, sortie.phaseStartMs, sortie.phaseDeadlineMs);
        setSortieMeshAt(
          sortie.unitId,
          lerp(sortie.returnStartX, sim.apc_x(), t),
          lerp(sortie.returnStartZ, sim.apc_z(), t),
        );
        if (nowMs < sortie.phaseDeadlineMs) {
          continue;
        }
        if (!transitionToBoarding(sortie)) {
          clearSortie(sortie.unitId);
          continue;
        }
        sortie.phase = 'boarding';
        sortie.phaseDeadlineMs = nowMs + 1;
        continue;
      }

      if (!completeBoarding(sortie)) {
        sortie.phaseDeadlineMs = nowMs + 250;
        continue;
      }

      clearSortie(sortie.unitId);
    }
  };

  const shiftBy = (dx: number, dz: number): void => {
    if (activeSorties.size === 0) return;
    for (const sortie of activeSorties.values()) {
      sortie.targetX += dx;
      sortie.targetZ += dz;
    }
    const sim = getSim();
    marker.shiftBy(
      dx,
      dz,
      Array.from(activeSorties.values(), (sortie) => ({ x: sortie.targetX, z: sortie.targetZ })),
      sim.apc_y(),
    );
  };

  return {
    update,
    shiftBy,
    triggerAtCursor,
    getWorldPosition(unitId: number, out: THREE.Vector3): boolean {
      const activeSortie = activeSorties.get(unitId);
      if (!activeSortie) return false;

      const nowMs = performance.now();
      if (activeSortie.phase === 'outbound') {
        const t = phaseProgress(nowMs, activeSortie.phaseStartMs, activeSortie.phaseDeadlineMs);
        return writeWorldPosition(
          out,
          lerp(activeSortie.outboundStartX, activeSortie.targetX, t),
          lerp(activeSortie.outboundStartZ, activeSortie.targetZ, t),
        );
      }

      if (activeSortie.phase === 'returning') {
        const sim = getSim();
        const t = phaseProgress(nowMs, activeSortie.phaseStartMs, activeSortie.phaseDeadlineMs);
        return writeWorldPosition(
          out,
          lerp(activeSortie.returnStartX, sim.apc_x(), t),
          lerp(activeSortie.returnStartZ, sim.apc_z(), t),
        );
      }

      const sim = getSim();
      return writeWorldPosition(out, sim.apc_x(), sim.apc_z());
    },
    setSelectedUnit(unitId: number | null): void {
      selectedUnitId = unitId;
      refreshSelectedOutlineVisibility();
    },
    captureSnapshot(nowMs: number): SortieSnapshotRecord[] {
      return Array.from(activeSorties.values(), (sortie) => {
        const elapsed = Math.max(0, nowMs - sortie.phaseStartMs);
        const remaining = Math.max(0, sortie.phaseDeadlineMs - nowMs);
        return {
          unitId: sortie.unitId,
          targetX: sortie.targetX,
          targetZ: sortie.targetZ,
          phase: sortie.phase,
          phaseElapsedMs: elapsed,
          phaseRemainingMs: remaining,
          outboundStartX: sortie.outboundStartX,
          outboundStartZ: sortie.outboundStartZ,
          returnStartX: sortie.returnStartX,
          returnStartZ: sortie.returnStartZ,
          preferredBoardCell: sortie.preferredBoardCell,
          preferredBoardLocal: sortie.preferredBoardLocal,
        };
      });
    },
    restoreSnapshot(records: SortieSnapshotRecord[], nowMs: number): string | null {
      if (records.length > SORTIE_SNAPSHOT_MAX_RECORDS) {
        return 'sortie snapshot record count exceeds limit';
      }

      const validatedSorties = new Map<number, ActiveSortie>();
      for (const record of records) {
        const error = validateSortieSnapshotRecord(record);
        if (error) return error;
        if (validatedSorties.has(record.unitId)) {
          return 'duplicate sortie unit id';
        }

        const phaseStartMs = nowMs - record.phaseElapsedMs;
        const phaseDeadlineMs = nowMs + record.phaseRemainingMs;
        validatedSorties.set(record.unitId, {
          unitId: record.unitId,
          targetX: record.targetX,
          targetZ: record.targetZ,
          phase: record.phase,
          phaseStartMs,
          phaseDeadlineMs,
          outboundStartX: record.outboundStartX,
          outboundStartZ: record.outboundStartZ,
          returnStartX: record.returnStartX,
          returnStartZ: record.returnStartZ,
          preferredBoardCell: record.preferredBoardCell,
          preferredBoardLocal: record.preferredBoardLocal,
        });
      }

      for (const unitId of activeSorties.keys()) {
        hideSortieMesh(unitId);
      }
      activeSorties.clear();
      for (const [unitId, sortie] of validatedSorties) {
        activeSorties.set(unitId, sortie);
      }
      rebuildMarkers();
      refreshSelectedOutlineVisibility();
      return null;
    },
  };
}
