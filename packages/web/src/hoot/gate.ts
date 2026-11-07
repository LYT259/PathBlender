/**
 * CTRE .hoot import gate (2026-11, HOOT desktop import): every .hoot file
 * stops here — the text parsers never see it. Browsers cannot run the
 * converter, so they get the explicit desktop/Phoenix-Tuner notice instead
 * of a generic parse error; on desktop the core probe (compliancy byte at
 * offset 70) decides between the converter queue and a specific rejection.
 * Task 8 mounts the flow that consumes `desktopQueue`.
 */
import { isHootFileName, probeHootFile } from '@pathblender/core';

export type HootGateError =
  | { key: 'hoot.webUnsupported' }
  | { key: 'hoot.tooOld'; vars: { v: number } }
  | { key: 'hoot.truncated' };

export interface RoutedHoot {
  /** Desktop only, and only probe-convertible files. */
  desktopQueue: Array<{ file: File; relPath: string }>;
  errors: Array<{ relPath: string } & HootGateError>;
}

export async function routeHootFiles(
  incoming: Array<{ file: File; relPath: string }>,
  isDesktop: boolean,
): Promise<RoutedHoot> {
  const routed: RoutedHoot = { desktopQueue: [], errors: [] };
  for (const item of incoming) {
    if (!isHootFileName(item.file.name)) continue;
    if (!isDesktop) {
      routed.errors.push({ relPath: item.relPath, key: 'hoot.webUnsupported' });
      continue;
    }
    const probe = probeHootFile(new Uint8Array(await item.file.arrayBuffer()));
    if (probe.kind === 'convertible') {
      routed.desktopQueue.push(item);
    } else if (probe.reason === 'compliancy-too-old') {
      routed.errors.push({ relPath: item.relPath, key: 'hoot.tooOld', vars: { v: probe.compliancy! } });
    } else {
      routed.errors.push({ relPath: item.relPath, key: 'hoot.truncated' });
    }
  }
  return routed;
}
