import type { ApcInterior, Sim } from 'wasm-sim';
import type { InputRouterController } from '../input';
import {
  captureSnapshotBundlePaced,
  type SnapshotBundle,
  validateSnapshotBundle,
} from './snapshotRoundTrip';
import {
  deserializeSortieSnapshot,
  type SortieSnapshotRecord,
} from '../input/unitSortieCommand';

const DB_NAME = 'projectsnow-local-save';
const DB_VERSION = 1;
const STORE_NAME = 'snapshots';
const ACTIVE_SAVE_KEY = 'active';
const RECORD_FORMAT_VERSION = 1;
const RECORD_CONTENT_VERSION = 1;
const MAX_SNAPSHOT_STRING_LENGTH = 8_000_000;

export type LocalRestoreResult =
  | {
      mode: 'new';
      message: string;
      revision: number;
      sortieRecords: SortieSnapshotRecord[];
    }
  | {
      mode: 'loaded';
      message: string;
      revision: number;
      sortieRecords: SortieSnapshotRecord[];
    }
  | {
      mode: 'recovery';
      message: string;
      revision: number;
      sortieRecords: SortieSnapshotRecord[];
    };

export type LocalSaveResult = {
  ok: boolean;
  message: string;
  revision: number;
};

type LocalSaveRecord = {
  formatVersion: number;
  contentVersion: number;
  revision: number;
  savedAtEpochMs: number;
  simSnapshot: string;
  interiorSnapshot: string;
  sortieSnapshot: string;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function validateRecordShape(value: unknown): {
  ok: true;
  record: LocalSaveRecord;
} | {
  ok: false;
  reason: string;
} {
  if (!value || typeof value !== 'object') {
    return { ok: false, reason: 'save record is not an object' };
  }

  const record = value as Partial<LocalSaveRecord>;
  if (record.formatVersion !== RECORD_FORMAT_VERSION) {
    return { ok: false, reason: 'unsupported save format version' };
  }
  if (record.contentVersion !== RECORD_CONTENT_VERSION) {
    return { ok: false, reason: 'unsupported save content version' };
  }
  if (!Number.isInteger(record.revision) || (record.revision ?? -1) < 0) {
    return { ok: false, reason: 'save revision invalid' };
  }
  if (!isFiniteNumber(record.savedAtEpochMs) || (record.savedAtEpochMs ?? 0) < 0) {
    return { ok: false, reason: 'save timestamp invalid' };
  }
  if (typeof record.simSnapshot !== 'string' || record.simSnapshot.length === 0) {
    return { ok: false, reason: 'sim snapshot missing' };
  }
  if (typeof record.interiorSnapshot !== 'string' || record.interiorSnapshot.length === 0) {
    return { ok: false, reason: 'interior snapshot missing' };
  }
  if (typeof record.sortieSnapshot !== 'string' || record.sortieSnapshot.length === 0) {
    return { ok: false, reason: 'sortie snapshot missing' };
  }
  if (
    record.simSnapshot.length > MAX_SNAPSHOT_STRING_LENGTH ||
    record.interiorSnapshot.length > MAX_SNAPSHOT_STRING_LENGTH ||
    record.sortieSnapshot.length > MAX_SNAPSHOT_STRING_LENGTH
  ) {
    return { ok: false, reason: 'snapshot payload exceeds safety limit' };
  }

  return {
    ok: true,
    record: {
      formatVersion: record.formatVersion,
      contentVersion: record.contentVersion,
      revision: record.revision as number,
      savedAtEpochMs: record.savedAtEpochMs as number,
      simSnapshot: record.simSnapshot,
      interiorSnapshot: record.interiorSnapshot,
      sortieSnapshot: record.sortieSnapshot,
    },
  };
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onerror = () => {
      reject(request.error ?? new Error('IndexedDB open failed'));
    };
    request.onsuccess = () => {
      resolve(request.result);
    };
  });
}

async function readRawRecord(): Promise<unknown | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(ACTIVE_SAVE_KEY);
    request.onerror = () => {
      reject(request.error ?? new Error('IndexedDB get failed'));
    };
    request.onsuccess = () => {
      resolve(request.result ?? null);
    };
  }).finally(() => {
    db.close();
  });
}

async function writeRecord(record: LocalSaveRecord): Promise<void> {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    const readRequest = store.get(ACTIVE_SAVE_KEY);
    readRequest.onerror = () => {
      reject(readRequest.error ?? new Error('IndexedDB pre-write read failed'));
    };
    readRequest.onsuccess = () => {
      const existing = readRequest.result;
      if (existing !== undefined && existing !== null) {
        const validated = validateRecordShape(existing);
        if (validated.ok && validated.record.revision >= record.revision) {
          reject(
            new Error(
              `stale save revision ${record.revision}; current revision ${validated.record.revision}`,
            ),
          );
          return;
        }
      }

      const writeRequest = store.put(record, ACTIVE_SAVE_KEY);
      writeRequest.onerror = () => {
        reject(writeRequest.error ?? new Error('IndexedDB put failed'));
      };
    };

    tx.onerror = () => {
      reject(tx.error ?? new Error('IndexedDB transaction failed'));
    };
    tx.oncomplete = () => {
      resolve();
    };
  }).finally(() => {
    db.close();
  });
}

function toBundle(record: LocalSaveRecord): SnapshotBundle {
  return {
    revision: record.revision,
    capturedAtMs: 0,
    captureMs: 0,
    simSnapshot: record.simSnapshot,
    interiorSnapshot: record.interiorSnapshot,
    sortieSnapshot: record.sortieSnapshot,
    sortieCount: 0,
  };
}

export async function restoreBeforeStart(
  sim: Sim,
  apcInterior: ApcInterior,
): Promise<LocalRestoreResult> {
  let raw: unknown;
  try {
    raw = await readRawRecord();
  } catch (error) {
    return {
      mode: 'recovery',
      message: `Recovery state: could not read save (${error instanceof Error ? error.message : String(error)})`,
      revision: 0,
      sortieRecords: [],
    };
  }

  if (raw === null) {
    return {
      mode: 'new',
      message: 'No local save found; started new game.',
      revision: 0,
      sortieRecords: [],
    };
  }

  const validated = validateRecordShape(raw);
  if (!validated.ok) {
    return {
      mode: 'recovery',
      message: `Recovery state: stored save invalid (${validated.reason}). Existing record preserved.`,
      revision: 0,
      sortieRecords: [],
    };
  }

  const record = validated.record;
  const bundle = toBundle(record);
  const validation = validateSnapshotBundle(bundle);
  if (!validation.ok) {
    return {
      mode: 'recovery',
      message: `Recovery state: stored save unsupported/corrupt (${validation.message}). Existing record preserved.`,
      revision: record.revision,
      sortieRecords: [],
    };
  }

  const simImportError = sim.import_snapshot_json(record.simSnapshot);
  if (simImportError) {
    return {
      mode: 'recovery',
      message: `Recovery state: sim restore failed (${simImportError}). Existing record preserved.`,
      revision: record.revision,
      sortieRecords: [],
    };
  }

  const interiorImportError = apcInterior.import_snapshot_json(record.interiorSnapshot);
  if (interiorImportError) {
    return {
      mode: 'recovery',
      message: `Recovery state: interior restore failed (${interiorImportError}). Existing record preserved.`,
      revision: record.revision,
      sortieRecords: [],
    };
  }

  const sortieDecoded = deserializeSortieSnapshot(record.sortieSnapshot);
  if (sortieDecoded.error || sortieDecoded.records === null) {
    return {
      mode: 'recovery',
      message: `Recovery state: sortie restore failed (${sortieDecoded.error ?? 'unknown sortie decode error'}). Existing record preserved.`,
      revision: record.revision,
      sortieRecords: [],
    };
  }

  return {
    mode: 'loaded',
    message: `Loaded local save revision ${record.revision}.`,
    revision: record.revision,
    sortieRecords: sortieDecoded.records,
  };
}

export async function saveNowPaced(
  sim: Sim,
  apcInterior: ApcInterior,
  inputRouter: InputRouterController,
  nextRevision: number,
  reportProgress?: (message: string) => void,
): Promise<LocalSaveResult> {
  const capture = await captureSnapshotBundlePaced(
    sim,
    apcInterior,
    inputRouter,
    nextRevision,
    (_phase, message) => {
      reportProgress?.(message);
    },
  );

  if (!capture.ok || !capture.bundle) {
    return {
      ok: false,
      revision: nextRevision,
      message: capture.message,
    };
  }

  reportProgress?.(`Writing local save revision ${nextRevision}...`);
  const record: LocalSaveRecord = {
    formatVersion: RECORD_FORMAT_VERSION,
    contentVersion: RECORD_CONTENT_VERSION,
    revision: nextRevision,
    savedAtEpochMs: Date.now(),
    simSnapshot: capture.bundle.simSnapshot,
    interiorSnapshot: capture.bundle.interiorSnapshot,
    sortieSnapshot: capture.bundle.sortieSnapshot,
  };

  try {
    await writeRecord(record);
  } catch (error) {
    return {
      ok: false,
      revision: nextRevision,
      message: `Save failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  return {
    ok: true,
    revision: nextRevision,
    message: `Saved revision ${nextRevision}.`,
  };
}
