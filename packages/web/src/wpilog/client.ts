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

/** Worker-based inspect; extraction spawns one-shot workers (any slot). */
function workerInspectClient(worker: Worker, onProgress?: WpilogProgress): WpilogClient {
  let pendingResolve: ((value: WpilogInspection) => void) | null = null;
  let pendingReject: ((error: unknown) => void) | null = null;
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
      // order without shipping bytes back and forth.
      return new Promise<Trajectory>((resolve, reject) => {
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
        oneShot.onmessage = (event: MessageEvent) => {
          const data = event.data as { type: string; trajectory?: Trajectory; message?: string };
          if (data.type === 'trajectory' && data.trajectory) {
            settled = true;
            resolve(data.trajectory);
            oneShot.terminate();
          } else if (data.type === 'error') {
            settled = true;
            reject(new Error(data.message ?? 'wpilog extraction failed'));
            oneShot.terminate();
          }
        };
        oneShot.onerror = (event) => {
          if (settled) return;
          settled = true;
          reject(new Error((event as ErrorEvent).message ?? 'wpilog extraction failed'));
          oneShot.terminate();
        };
        oneShot.postMessage({ type: 'extract', bytes, inspection, selection });
      });
    },
    dispose() {
      worker.terminate();
    },
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
