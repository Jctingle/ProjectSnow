import type { ApcInterior, Sim } from 'wasm-sim';
import type { InputRouterController } from '../input';
import { saveNowPaced, type LocalSaveResult } from './localCheckpoint';

const DEFAULT_AUTOSAVE_INTERVAL_MS = 2000;

type SavePhase =
  | 'idle'
  | 'dirty'
  | 'capturing'
  | 'saving'
  | 'saved'
  | 'error'
  | 'recovery';

export type SaveStatus = {
  phase: SavePhase;
  message: string;
  revision: number;
  dirty: boolean;
  inFlight: boolean;
};

export type SaveStatusListener = (status: SaveStatus) => void;

type AutosaveControllerOptions = {
  sim: Sim;
  apcInterior: ApcInterior;
  inputRouter: InputRouterController;
  initialRevision: number;
  recoveryMessage: string | null;
  autosaveIntervalMs?: number;
};

type LifecycleTargets = {
  windowRef: Window;
  documentRef: Document;
};

export type AutosaveController = {
  markDirty(reason: string): void;
  saveNow(): Promise<LocalSaveResult>;
  flushNow(reason: string): Promise<LocalSaveResult | null>;
  bindLifecycle(targets: LifecycleTargets): void;
  getStatus(): SaveStatus;
  subscribe(listener: SaveStatusListener): () => void;
};

export function createAutosaveController(options: AutosaveControllerOptions): AutosaveController {
  const {
    sim,
    apcInterior,
    inputRouter,
    initialRevision,
    recoveryMessage,
    autosaveIntervalMs = DEFAULT_AUTOSAVE_INTERVAL_MS,
  } = options;

  let revision = initialRevision;
  let dirty = false;
  let inFlight = false;
  let pendingImmediate = false;
  let autosaveTimer: number | null = null;
  let flushInProgress: Promise<LocalSaveResult | null> | null = null;
  const listeners = new Set<SaveStatusListener>();

  let status: SaveStatus = {
    phase: recoveryMessage ? 'recovery' : 'idle',
    message: recoveryMessage ?? `Idle at revision ${revision}.`,
    revision,
    dirty,
    inFlight,
  };

  const emitStatus = (next: Partial<SaveStatus>): void => {
    status = {
      ...status,
      ...next,
      revision,
      dirty,
      inFlight,
    };
    for (const listener of listeners) {
      listener(status);
    }
  };

  const updateDirtyStatus = (reason: string): void => {
    if (recoveryMessage) {
      emitStatus({
        phase: 'recovery',
        message: recoveryMessage,
      });
      return;
    }
    if (inFlight) return;
    emitStatus({
      phase: dirty ? 'dirty' : 'idle',
      message: dirty
        ? `Dirty: ${reason}. Awaiting autosave.`
        : `Idle at revision ${revision}.`,
    });
  };

  const performSave = async (reason: string): Promise<LocalSaveResult> => {
    if (recoveryMessage) {
      return {
        ok: false,
        revision,
        message: recoveryMessage,
      };
    }
    if (inFlight) {
      pendingImmediate = true;
      return {
        ok: false,
        revision,
        message: 'Save already in progress.',
      };
    }
    if (!dirty) {
      return {
        ok: true,
        revision,
        message: `No unsaved changes at revision ${revision}.`,
      };
    }

    inFlight = true;
    dirty = false;
    const nextRevision = revision + 1;

    emitStatus({
      phase: 'capturing',
      message: `Capturing save revision ${nextRevision} (${reason})...`,
    });

    const result = await saveNowPaced(
      sim,
      apcInterior,
      inputRouter,
      nextRevision,
      (message) => {
        emitStatus({
          phase: 'saving',
          message,
        });
      },
    );

    if (result.ok) {
      revision = result.revision;
      if (dirty) {
        emitStatus({
          phase: 'dirty',
          message: `Saved revision ${revision}, but newer changes are pending.`,
        });
      } else {
        emitStatus({
          phase: 'saved',
          message: result.message,
        });
      }
    } else {
      dirty = true;
      emitStatus({
        phase: 'error',
        message: result.message,
      });
    }

    inFlight = false;

    if (pendingImmediate) {
      pendingImmediate = false;
      if (dirty) {
        void performSave('queued-followup');
      }
    }

    return result;
  };

  const ensureAutosaveTimer = (): void => {
    if (autosaveTimer !== null) return;
    autosaveTimer = window.setInterval(() => {
      if (recoveryMessage) return;
      if (!dirty) return;
      if (inFlight) return;
      void performSave('autosave-interval');
    }, autosaveIntervalMs);
  };

  const markDirty = (reason: string): void => {
    if (recoveryMessage) return;
    dirty = true;
    updateDirtyStatus(reason);
  };

  const saveNow = async (): Promise<LocalSaveResult> => {
    if (recoveryMessage) {
      return {
        ok: false,
        revision,
        message: recoveryMessage,
      };
    }
    dirty = true;
    return performSave('manual-save');
  };

  const flushNow = async (reason: string): Promise<LocalSaveResult | null> => {
    if (recoveryMessage) {
      return null;
    }
    if (flushInProgress) return flushInProgress;

    flushInProgress = (async () => {
      pendingImmediate = true;
      dirty = true;
      const result = await performSave(`flush:${reason}`);
      flushInProgress = null;
      return result;
    })();

    return flushInProgress;
  };

  const bindLifecycle = ({ windowRef, documentRef }: LifecycleTargets): void => {
    windowRef.addEventListener('pagehide', () => {
      void flushNow('pagehide');
    });
    documentRef.addEventListener('visibilitychange', () => {
      if (documentRef.visibilityState === 'hidden') {
        void flushNow('visibilitychange-hidden');
      }
    });
  };

  ensureAutosaveTimer();

  return {
    markDirty,
    saveNow,
    flushNow,
    bindLifecycle,
    getStatus: () => status,
    subscribe(listener: SaveStatusListener): () => void {
      listeners.add(listener);
      listener(status);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
