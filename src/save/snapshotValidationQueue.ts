import type { SnapshotBundle } from './snapshotRoundTrip';

export type SnapshotValidationStatus = {
  phase: 'queued' | 'validating' | 'completed' | 'error';
  revision: number;
  message: string;
  ok: boolean | null;
};

export type SnapshotStatusListener = (status: SnapshotValidationStatus) => void;

type PendingValidation = {
  bundle: SnapshotBundle;
  listener: SnapshotStatusListener;
};

type ActiveValidation = {
  revision: number;
  listener: SnapshotStatusListener;
  dispatchedAtMs: number;
  captureMs: number;
};

type WorkerValidateResult = {
  kind: 'result';
  revision: number;
  report: {
    ok: boolean;
    message: string;
  };
  validateMs: number;
};

function scheduleIdle(task: () => void): void {
  if (typeof globalThis.requestIdleCallback === 'function') {
    globalThis.requestIdleCallback(
      () => task(),
      { timeout: 1200 },
    );
    return;
  }
  setTimeout(task, 0);
}

export function createSnapshotValidationQueue(): {
  enqueue(bundle: SnapshotBundle, listener: SnapshotStatusListener): void;
} {
  const worker = new Worker(new URL('./snapshotValidationWorker.ts', import.meta.url), {
    type: 'module',
  });

  let pending: PendingValidation | null = null;
  let active: ActiveValidation | null = null;
  let drainScheduled = false;

  worker.addEventListener('message', (event: MessageEvent<WorkerValidateResult>) => {
    const result = event.data;
    if (!result || result.kind !== 'result') return;
    if (!active || active.revision !== result.revision) {
      if (pending) scheduleDrain();
      return;
    }

    const queueWaitMs = Math.max(0, active.dispatchedAtMs - pendingCaptureStartedAt(active.revision));
    const totalMs = active.captureMs + result.validateMs + queueWaitMs;

    active.listener({
      phase: result.report.ok ? 'completed' : 'error',
      revision: result.revision,
      ok: result.report.ok,
      message:
        `${result.report.message} (capture ${active.captureMs.toFixed(1)}ms, ` +
        `validate ${result.validateMs.toFixed(1)}ms, total ${totalMs.toFixed(1)}ms)`,
    });
      captureStartByRevision.delete(result.revision);

    active = null;
    if (pending) scheduleDrain();
  });

  worker.addEventListener('error', (errorEvent) => {
    if (!active) return;
    active.listener({
      phase: 'error',
      revision: active.revision,
      ok: false,
      message: `Snapshot validation worker error: ${errorEvent.message}`,
    });
    captureStartByRevision.delete(active.revision);
    active = null;
    if (pending) scheduleDrain();
  });

  const captureStartByRevision = new Map<number, number>();

  const pendingCaptureStartedAt = (revision: number): number => {
    return captureStartByRevision.get(revision) ?? 0;
  };

  const scheduleDrain = (): void => {
    if (drainScheduled) return;
    drainScheduled = true;
    scheduleIdle(() => {
      drainScheduled = false;
      drain();
    });
  };

  const drain = (): void => {
    if (active) return;
    if (!pending) return;

    const job = pending;
    pending = null;
    active = {
      revision: job.bundle.revision,
      listener: job.listener,
      dispatchedAtMs: performance.now(),
      captureMs: job.bundle.captureMs,
    };

    job.listener({
      phase: 'validating',
      revision: job.bundle.revision,
      ok: null,
      message: `Validating snapshot revision ${job.bundle.revision}...`,
    });

    worker.postMessage({
      kind: 'validate',
      bundle: job.bundle,
    });
  };

  return {
    enqueue(bundle: SnapshotBundle, listener: SnapshotStatusListener): void {
      captureStartByRevision.set(bundle.revision, bundle.capturedAtMs);
      pending = { bundle, listener };
      listener({
        phase: 'queued',
        revision: bundle.revision,
        ok: null,
        message: `Queued snapshot validation revision ${bundle.revision}`,
      });
      scheduleDrain();
    },
  };
}
