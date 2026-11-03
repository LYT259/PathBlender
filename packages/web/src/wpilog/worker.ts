/**
 * WPILOG parse worker body. Handles two requests:
 *  - 'inspect': bytes cloned in (caller keeps its copy) → inspection posted back once.
 *  - 'extract': bytes + the inspection + the user's selection → trajectory.
 * Errors surface as {type:'error', message} so the UI can report them.
 */

import { extractWpilogTrajectory, inspectWpilog } from '@pathblender/core';
import type { WpilogExtractionSelection, WpilogInspection } from '@pathblender/core';

type Incoming =
  | { type: 'inspect'; bytes: Uint8Array; fileName: string }
  | { type: 'extract'; bytes: Uint8Array; inspection: WpilogInspection; selection: WpilogExtractionSelection };

self.onmessage = (event: MessageEvent<Incoming>) => {
  const message = event.data;
  const post = (payload: unknown) => (self as unknown as Worker).postMessage(payload);
  if (message.type === 'inspect') {
    try {
      const inspection = inspectWpilog(message.bytes, message.fileName);
      post({ type: 'inspection', inspection });
    } catch (error) {
      post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    }
    return;
  }
  if (message.type === 'extract') {
    try {
      const trajectory = extractWpilogTrajectory(message.bytes, message.inspection, message.selection);
      post({ type: 'trajectory', trajectory });
    } catch (error) {
      post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  }
};
