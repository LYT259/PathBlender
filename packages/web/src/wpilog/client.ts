/**
 * WPILOG parse client: runs inspection/extraction in a Web Worker when the
 * platform offers one so a large log never blocks the UI thread, and falls
 * back to direct (synchronous) calls otherwise — jsdom tests and older
 * WebViews take the same code path. Inspection transfers the bytes to the
 * worker (no copy); extraction is a one-shot worker per call so any number
 * of files can be confirmed in one pass.
 */

import type {
  Trajectory,
  WpilogExtractionSelection,
  WpilogInspection,
} from '@pathblender/core';
import { extractWpilogTrajectory, inspectWpilog } from '@pathblender/core';

export interface WpilogClient {
  /** Parse the container and catalog the log (bytes cloned — caller keeps them). */
  inspect(bytes: Uint8Array, fileName: string): Promise<WpilogInspection>;
  /** Extract one trajectory; safe to call for any inspected log. */
  extract(bytes: Uint8Array, inspection: WpilogInspection, selection: WpilogExtractionSelection): Promise<Trajectory>;
  dispose(): void;
}

export type WpilogProgress = (fraction: number) => void;

export function createWpilogClient(onProgress?: WpilogProgress): WpilogClient {
  // Real browsers: a module worker keeps the parse off the UI thread.
  if (typeof Worker === 'function') {
    try {
      const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      return workerInspectClient(worker, onProgress);
    } catch {
      // Worker construction failed (CSP, exotic shell) — fall through to sync.
    }
  }
  return syncClient();
}

/** Worker-based inspect; extraction spawns one-shot workers (any slot).
 *  dispose() terminates the inspect worker AND every live extraction worker
 *  and rejects their promises — a cancelled dialog can never receive a late
 *  trajectory (acceptance report: late worker reply still called onDone). */
function workerInspectClient(worker: Worker, onProgress?: WpilogProgress): WpilogClient {
  let pendingResolve: ((value: WpilogInspection) => void) | null = null;
  let pendingReject: ((error: unknown) => void) | null = null;
  let disposed = false;
  const liveExtractions = new Set<{ worker: Worker; reject: (error: unknown) => void }>();
  worker.onmessage = (event: MessageEvent) => {
    const data = event.data as { type: string; inspection?: WpilogInspection; message?: string; progress?: number };
    if (data.type === 'inspection' && data.inspection) {
      pendingResolve?.(data.inspection);
    } else if (data.type === 'error') {
      pendingReject?.(new Error(data.message ?? 'wpilog worker failed'));
    } else if (data.type === 'progress') {
      onProgress?.(data.progress ?? 0);
    }
  };
  worker.onerror = (event) => {
    pendingReject?.(new Error((event as ErrorEvent).message ?? 'wpilog worker failed'));
  };
  const disposeAll = () => {
    if (disposed) return;
    disposed = true;
    for (const live of liveExtractions) {
      live.worker.terminate();
      live.reject(new Error('wpilog parse cancelled'));
    }
    liveExtractions.clear();
    worker.terminate();
  };
  return {
    inspect(bytes, fileName) {
      return new Promise<WpilogInspection>((resolve, reject) => {
        pendingResolve = resolve;
        pendingReject = reject;
        onProgress?.(0);
        // Clone, not transfer: the caller keeps its bytes for extraction.
        worker.postMessage({ type: 'inspect', bytes, fileName });
      });
    },
    extract(bytes, inspection, selection) {
      // One-shot worker per extraction: keeps the inspect worker's protocol
      // single-purpose and lets the confirm loop extract any file in any
      // order without shipping bytes back and forth. Every live worker is
      // registered so dispose() can cancel the whole batch.
      return new Promise<Trajectory>((resolve, reject) => {
        if (disposed) {
          reject(new Error('wpilog parse cancelled'));
          return;
        }
        let settled = false;
        let oneShot: Worker;
        try {
          oneShot = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
        } catch {
          try {
            resolve(extractWpilogTrajectory(bytes, inspection, selection));
          } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
          }
          return;
        }
        const live = { worker: oneShot, reject: (error: unknown) => reject(error) };
        liveExtractions.add(live);
        const settle = (finish: () => void) => {
          if (settled) return;
          settled = true;
          liveExtractions.delete(live);
          oneShot.terminate();
          finish();
        };
        oneShot.onmessage = (event: MessageEvent) => {
          // A worker reply racing dispose() is dropped: the promise was
          // already rejected with 'wpilog parse cancelled'.
          if (disposed) return;
          const data = event.data as { type: string; trajectory?: Trajectory; message?: string };
          if (data.type === 'trajectory' && data.trajectory) {
            settle(() => resolve(data.trajectory as Trajectory));
          } else if (data.type === 'error') {
            settle(() => reject(new Error(data.message ?? 'wpilog extraction failed')));
          }
        };
        oneShot.onerror = (event) => {
          if (disposed) return;
          settle(() => reject(new Error((event as ErrorEvent).message ?? 'wpilog extraction failed')));
        };
        oneShot.postMessage({ type: 'extract', bytes, inspection, selection });
      });
    },
    dispose: disposeAll,
  };
}

/** Synchronous fallback used under test (jsdom has no real Workers). */
function syncClient(): WpilogClient {
  return {
    inspect(bytes, fileName) {
      return Promise.resolve(inspectWpilog(bytes, fileName));
    },
    extract(bytes, inspection, selection) {
      return Promise.resolve(extractWpilogTrajectory(bytes, inspection, selection));
    },
    dispose() {
      /* nothing held */
    },
  };
}
