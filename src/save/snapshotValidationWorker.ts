/// <reference lib="webworker" />

import init from 'wasm-sim';
import type { SnapshotBundle } from './snapshotRoundTrip';
import { validateSnapshotBundle } from './snapshotRoundTrip';

type ValidateRequest = {
  kind: 'validate';
  bundle: SnapshotBundle;
};

type ValidateResult = {
  kind: 'result';
  revision: number;
  report: {
    ok: boolean;
    message: string;
  };
  validateMs: number;
};

const workerScope: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;
let wasmReady: Promise<void> | null = null;

async function ensureWasmReady(): Promise<void> {
  if (!wasmReady) {
    wasmReady = init().then(() => undefined);
  }
  await wasmReady;
}

workerScope.onmessage = async (event: MessageEvent<ValidateRequest>): Promise<void> => {
  const message = event.data;
  if (!message || message.kind !== 'validate') return;

  try {
    await ensureWasmReady();
  } catch (error) {
    const result: ValidateResult = {
      kind: 'result',
      revision: message.bundle.revision,
      report: {
        ok: false,
        message: `WASM worker init failed: ${error instanceof Error ? error.message : String(error)}`,
      },
      validateMs: 0,
    };
    workerScope.postMessage(result);
    return;
  }

  const startedAt = performance.now();
  const report = validateSnapshotBundle(message.bundle);
  const validateMs = performance.now() - startedAt;

  const result: ValidateResult = {
    kind: 'result',
    revision: message.bundle.revision,
    report,
    validateMs,
  };
  workerScope.postMessage(result);
};
