import { ApcInterior, Sim } from 'wasm-sim';
import type { InputRouterController } from '../input';
import {
  APC_CELLS_DEFAULT_X,
  APC_CELLS_DEFAULT_Y,
  APC_CELLS_DEFAULT_Z,
  APC_ENVELOPE_X,
  APC_ENVELOPE_Y,
  APC_ENVELOPE_Z,
  APC_SPEED_DEFAULT,
  APC_TRANSFER_INTERVAL_TICKS,
  CRAG_FREQ,
  CRAG_STRENGTH,
  GROUND_SIZE,
  HEIGHT_MULT,
  NOISE_SEED,
  SCALE,
  SEED_X,
  SEED_Y,
  SLOPE_CLIFF_THRESHOLD_DEG,
  SWEEP_AMP,
  SWEEP_SCALE,
  TIER_HEIGHT_SCALE,
} from '../sim/config';
import {
  deserializeSortieSnapshot,
  serializeSortieSnapshot,
} from '../input/unitSortieCommand';

export type SnapshotRoundTripReport = {
  ok: boolean;
  message: string;
};

export type SnapshotBundle = {
  revision: number;
  capturedAtMs: number;
  captureMs: number;
  simSnapshot: string;
  interiorSnapshot: string;
  sortieSnapshot: string;
  sortieCount: number;
};

export type SnapshotCaptureReport = {
  ok: boolean;
  message: string;
  bundle: SnapshotBundle | null;
};

export type SnapshotCapturePhase =
  | 'capturing-sorties'
  | 'capturing-sim'
  | 'capturing-interior'
  | 'captured';

function scheduleNextFrame(task: () => void): void {
  requestAnimationFrame(() => task());
}

function yieldToNextFrame(): Promise<void> {
  return new Promise((resolve) => {
    scheduleNextFrame(resolve);
  });
}

function normalizeJson(json: string): string | null {
  try {
    return JSON.stringify(JSON.parse(json));
  } catch {
    return null;
  }
}

export function captureSnapshotBundle(
  sim: Sim,
  apcInterior: ApcInterior,
  inputRouter: InputRouterController,
  revision: number,
): SnapshotCaptureReport {
  const startedAtMs = performance.now();

  const sortieRecords = inputRouter.captureSortieSnapshot(startedAtMs);
  const sortieSnapshot = serializeSortieSnapshot(sortieRecords);
  const sortieDecoded = deserializeSortieSnapshot(sortieSnapshot);
  if (sortieDecoded.error || sortieDecoded.records === null) {
    return {
      ok: false,
      message: `Sortie snapshot validation failed: ${sortieDecoded.error ?? 'unknown error'}`,
      bundle: null,
    };
  }

  const simSnapshot = sim.export_snapshot_json();
  const interiorSnapshot = apcInterior.export_snapshot_json();
  if (!simSnapshot || !interiorSnapshot) {
    return { ok: false, message: 'Snapshot export failed', bundle: null };
  }

  const captureMs = performance.now() - startedAtMs;
  return {
    ok: true,
    message: `Captured snapshot revision ${revision} in ${captureMs.toFixed(1)}ms`,
    bundle: {
      revision,
      capturedAtMs: startedAtMs,
      captureMs,
      simSnapshot,
      interiorSnapshot,
      sortieSnapshot,
      sortieCount: sortieDecoded.records.length,
    },
  };
}

export async function captureSnapshotBundlePaced(
  sim: Sim,
  apcInterior: ApcInterior,
  inputRouter: InputRouterController,
  revision: number,
  reportPhase?: (phase: SnapshotCapturePhase, message: string) => void,
): Promise<SnapshotCaptureReport> {
  const startedAtMs = performance.now();
  let captureWorkMs = 0;

  reportPhase?.('capturing-sorties', `Capturing snapshot revision ${revision} sorties...`);
  const sortieCaptureStartedAt = performance.now();
  const sortieRecords = inputRouter.captureSortieSnapshot(sortieCaptureStartedAt);
  const sortieSnapshot = serializeSortieSnapshot(sortieRecords);
  const sortieDecoded = deserializeSortieSnapshot(sortieSnapshot);
  captureWorkMs += performance.now() - sortieCaptureStartedAt;
  if (sortieDecoded.error || sortieDecoded.records === null) {
    return {
      ok: false,
      message: `Sortie snapshot validation failed: ${sortieDecoded.error ?? 'unknown error'}`,
      bundle: null,
    };
  }

  await yieldToNextFrame();

  reportPhase?.('capturing-sim', `Capturing snapshot revision ${revision} sim...`);
  const simCaptureStartedAt = performance.now();
  const simSnapshot = sim.export_snapshot_json();
  captureWorkMs += performance.now() - simCaptureStartedAt;
  if (!simSnapshot) {
    return { ok: false, message: 'Sim snapshot export failed', bundle: null };
  }

  await yieldToNextFrame();

  reportPhase?.('capturing-interior', `Capturing snapshot revision ${revision} interior...`);
  const interiorCaptureStartedAt = performance.now();
  const interiorSnapshot = apcInterior.export_snapshot_json();
  captureWorkMs += performance.now() - interiorCaptureStartedAt;
  if (!interiorSnapshot) {
    return { ok: false, message: 'Interior snapshot export failed', bundle: null };
  }

  const wallClockMs = performance.now() - startedAtMs;
  reportPhase?.(
    'captured',
    `Captured snapshot revision ${revision} in ${captureWorkMs.toFixed(1)}ms work (${wallClockMs.toFixed(1)}ms wall)`,
  );

  return {
    ok: true,
    message: `Captured snapshot revision ${revision} in ${captureWorkMs.toFixed(1)}ms work (${wallClockMs.toFixed(1)}ms wall)`,
    bundle: {
      revision,
      capturedAtMs: startedAtMs,
      captureMs: captureWorkMs,
      simSnapshot,
      interiorSnapshot,
      sortieSnapshot,
      sortieCount: sortieDecoded.records.length,
    },
  };
}

export function validateSnapshotBundle(bundle: SnapshotBundle): SnapshotRoundTripReport {
  const sortieDecoded = deserializeSortieSnapshot(bundle.sortieSnapshot);
  if (sortieDecoded.error || sortieDecoded.records === null) {
    return {
      ok: false,
      message: `Sortie snapshot decode failed: ${sortieDecoded.error ?? 'unknown error'}`,
    };
  }

  const normalizedSimSnapshot = normalizeJson(bundle.simSnapshot);
  const normalizedInteriorSnapshot = normalizeJson(bundle.interiorSnapshot);
  const normalizedSortieSnapshot = normalizeJson(bundle.sortieSnapshot);
  if (!normalizedSimSnapshot || !normalizedInteriorSnapshot || !normalizedSortieSnapshot) {
    return { ok: false, message: 'Snapshot encoding invalid JSON' };
  }

  const simCandidate = new Sim(
    NOISE_SEED,
    SEED_X,
    SEED_Y,
    SCALE,
    HEIGHT_MULT,
    GROUND_SIZE / 2,
    CRAG_STRENGTH,
    CRAG_FREQ,
    SWEEP_SCALE,
    SWEEP_AMP,
    TIER_HEIGHT_SCALE,
    APC_SPEED_DEFAULT,
    SLOPE_CLIFF_THRESHOLD_DEG,
  );
  const simImportError = simCandidate.import_snapshot_json(bundle.simSnapshot);
  if (simImportError) {
    return { ok: false, message: `Sim snapshot import failed: ${simImportError}` };
  }

  const interiorCandidate = new ApcInterior(
    APC_ENVELOPE_X,
    APC_ENVELOPE_Y,
    APC_ENVELOPE_Z,
    APC_CELLS_DEFAULT_X,
    APC_CELLS_DEFAULT_Y,
    APC_CELLS_DEFAULT_Z,
    APC_TRANSFER_INTERVAL_TICKS,
  );
  const interiorImportError = interiorCandidate.import_snapshot_json(bundle.interiorSnapshot);
  if (interiorImportError) {
    return {
      ok: false,
      message: `Interior snapshot import failed: ${interiorImportError}`,
    };
  }

  const normalizedSimRoundTrip = normalizeJson(simCandidate.export_snapshot_json());
  const normalizedInteriorRoundTrip = normalizeJson(
    interiorCandidate.export_snapshot_json(),
  );
  const normalizedSortieRoundTrip = normalizeJson(
    serializeSortieSnapshot(sortieDecoded.records),
  );

  if (
    !normalizedSimRoundTrip ||
    !normalizedInteriorRoundTrip ||
    !normalizedSortieRoundTrip
  ) {
    return { ok: false, message: 'Round-trip snapshot encoding invalid JSON' };
  }

  if (normalizedSimSnapshot !== normalizedSimRoundTrip) {
    return { ok: false, message: 'Sim snapshot round-trip mismatch' };
  }
  if (normalizedInteriorSnapshot !== normalizedInteriorRoundTrip) {
    return { ok: false, message: 'Interior snapshot round-trip mismatch' };
  }
  if (normalizedSortieSnapshot !== normalizedSortieRoundTrip) {
    return { ok: false, message: 'Sortie snapshot round-trip mismatch' };
  }

  return {
    ok: true,
    message: `Round-trip OK r${bundle.revision}: sim=${simCandidate.current_shard_row()},${simCandidate.current_shard_col()} units=${interiorCandidate.interior_unit_count()} sorties=${sortieDecoded.records.length}`,
  };
}
