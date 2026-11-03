/**
 * WPILOG binary container reader.
 *
 * Implements the WPILib Data Log File Format Specification 1.0
 * (datalog.adoc + wpilog.ksy, wpiutil/datalog project, verified 2026-11-03
 * against DataLogReader.java): 6-byte "WPILOG" magic, u16 version (major
 * high byte), u32 extra-header length, then varint-packed records whose
 * header lengths come from one bitfield byte — bits 0–1 entry-ID length,
 * bits 2–3 payload-length width, bits 4–6 timestamp width, bit 7 spare.
 * Everything is little-endian; timestamps are integer microseconds.
 *
 * Fault tolerance mirrors the reference reader: a truncated final record
 * stops iteration (reported, not thrown) and a timestamp that cannot be
 * sane (negative after varint read, or beyond the reference's
 * Long.MAX_VALUE/1000 bound) ends the scan there. Unknown control-record
 * or entry types never fail the file — data we cannot interpret is skipped
 * so an unrelated vendor entry cannot take the whole log down.
 */

import { ParseError } from '../parse-error';

export const WPILOG_MAGIC = 'WPILOG';

/** Version constant for format 1.0 (major 1, minor 0). */
export const WPILOG_VERSION_1_0 = 0x0100;

export interface WpilogHeader {
  /** 0xMMmm — major in the high byte, minor in the low byte. */
  version: number;
  /** Free-form extra header text (AdvantageKit writes "AdvantageKit"). */
  extraHeader: string;
  /** Byte offset of the first record. */
  firstRecordOffset: number;
}

export function readWpilogHeader(bytes: Uint8Array, fileName: string): WpilogHeader {
  if (bytes.length < 12) {
    throw new ParseError('invalid-wpilog', fileName, 'file shorter than the smallest valid header');
  }
  for (let i = 0; i < WPILOG_MAGIC.length; i++) {
    if (bytes[i] !== WPILOG_MAGIC.charCodeAt(i)) {
      throw new ParseError('invalid-wpilog', fileName, 'missing WPILOG magic');
    }
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint16(6, true);
  if (version < WPILOG_VERSION_1_0) {
    throw new ParseError('invalid-wpilog', fileName, `version 0x${version.toString(16)} predates format 1.0`);
  }
  const major = version >> 8;
  if (major > 1) {
    throw new ParseError('wpilog-too-new', fileName, `format major version ${major} is newer than the supported 1.x`);
  }
  const extraLen = view.getUint32(8, true);
  if (12 + extraLen > bytes.length) {
    throw new ParseError('invalid-wpilog', fileName, 'extra header length runs past end of file');
  }
  return {
    version,
    extraHeader: new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(12, 12 + extraLen)),
    firstRecordOffset: 12 + extraLen,
  };
}

/** A data record: entry ID ≠ 0. `payload` is a view into the source buffer. */
export interface WpilogDataRecord {
  entryId: number;
  /** Microseconds since the log's unspecified zero (robot program start). */
  timestampUs: number;
  payload: Uint8Array;
}

/** What stopped a scan: clean EOF, a truncated tail, or a corrupt timestamp. */
export type WpilogStopReason = 'eof' | 'truncated' | 'bad-timestamp';

export interface WpilogScanResult {
  stop: WpilogStopReason;
  /** Byte offset where iteration stopped (start of the unusable record). */
  stopOffset: number;
  /** Bytes ignored at the tail when stop is not 'eof'. */
  wastedBytes: number;
}

/** Matches DataLogReader's sanity bound (timestamp µs ≤ Long.MAX_VALUE/1000). */
const MAX_TIMESTAMP_US = Number.MAX_SAFE_INTEGER / 4;

/** Read a little-endian base-256 integer of `len` bytes starting at `offset`. */
function readVarUint(bytes: Uint8Array, offset: number, len: number): number {
  let value = 0;
  for (let i = 0; i < len; i++) {
    value += bytes[offset + i]! * 2 ** (8 * i);
  }
  return value;
}

export interface WpilogRecordHandler {
  /** Start control record (type 0). */
  onStart(entryId: number, name: string, type: string, metadata: string, timestampUs: number): void;
  /** Finish control record (type 1). */
  onFinish(entryId: number, timestampUs: number): void;
  /** SetMetadata control record (type 2). */
  onMetadata(entryId: number, metadata: string, timestampUs: number): void;
  /** Data record for a non-control entry. */
  onData(record: WpilogDataRecord): void;
  /** Optional: called every N records so callers can post progress. */
  onProgress?(scanned: number, offset: number): void;
}

const PROGRESS_EVERY = 50_000;

/**
 * Scan the record stream once, delivering views (no per-record copies).
 * Control records are decoded here; data records are handed up raw.
 */
export function scanWpilogRecords(
  bytes: Uint8Array,
  fromOffset: number,
  handler: WpilogRecordHandler,
): WpilogScanResult {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const size = bytes.length;
  let pos = fromOffset;
  let scanned = 0;
  // Payloads of this size or smaller are decoded inline as control records;
  // anything larger is still position-checked but treated as data.
  while (pos < size) {
    const lenByte = bytes[pos]!;
    const entryLen = (lenByte & 0x03) + 1;
    const sizeLen = ((lenByte >> 2) & 0x03) + 1;
    const tsLen = ((lenByte >> 4) & 0x07) + 1;
    const headerLen = 1 + entryLen + sizeLen + tsLen;
    if (pos + headerLen > size) {
      return { stop: 'truncated', stopOffset: pos, wastedBytes: size - pos };
    }
    const entryId = readVarUint(bytes, pos + 1, entryLen);
    const payloadLen = readVarUint(bytes, pos + 1 + entryLen, sizeLen);
    const timestampUs = readVarUint(bytes, pos + 1 + entryLen + sizeLen, tsLen);
    if (payloadLen > size - pos - headerLen) {
      return { stop: 'truncated', stopOffset: pos, wastedBytes: size - pos };
    }
    if (timestampUs > MAX_TIMESTAMP_US) {
      return { stop: 'bad-timestamp', stopOffset: pos, wastedBytes: size - pos };
    }
    const payloadStart = pos + headerLen;
    const payload = bytes.subarray(payloadStart, payloadStart + payloadLen);
    pos = payloadStart + payloadLen;
    scanned++;
    if (handler.onProgress && scanned % PROGRESS_EVERY === 0) handler.onProgress(scanned, pos);

    if (entryId === 0) {
      // Control record: first payload byte selects Start/Finish/SetMetadata.
      if (payload.length < 5) continue; // not even type + entry id — ignore
      const controlType = payload[0];
      const controlId = view.getUint32(payloadStart + 1, true);
      if (controlType === 0 && payload.length >= 9) {
        const nameLen = view.getUint32(payloadStart + 5, true);
        if (9 + nameLen > payload.length) continue;
        const name = decoder.decode(payload.subarray(9, 9 + nameLen));
        let offset = 9 + nameLen;
        if (offset + 4 > payload.length) {
          handler.onStart(controlId, name, '', '', timestampUs);
          continue;
        }
        const typeLen = view.getUint32(payloadStart + offset, true);
        offset += 4;
        if (offset + typeLen > payload.length) {
          handler.onStart(controlId, name, '', '', timestampUs);
          continue;
        }
        const type = decoder.decode(payload.subarray(offset, offset + typeLen));
        offset += typeLen;
        let metadata = '';
        if (offset + 4 <= payload.length) {
          const metaLen = view.getUint32(payloadStart + offset, true);
          offset += 4;
          if (offset + metaLen <= payload.length) {
            metadata = decoder.decode(payload.subarray(offset, offset + metaLen));
          }
        }
        handler.onStart(controlId, name, type, metadata, timestampUs);
      } else if (controlType === 1) {
        handler.onFinish(controlId, timestampUs);
      } else if (controlType === 2 && payload.length >= 9) {
        const metaLen = view.getUint32(payloadStart + 5, true);
        const metadata = 9 + metaLen <= payload.length
          ? decoder.decode(payload.subarray(9, 9 + metaLen))
          : '';
        handler.onMetadata(controlId, metadata, timestampUs);
      }
      // Unknown control types are skipped (forward compatibility).
      continue;
    }
    handler.onData({ entryId, timestampUs, payload });
  }
  return { stop: 'eof', stopOffset: size, wastedBytes: 0 };
}

/* ------------------------------------------------------------------ */
/* Entry catalog (pass 1: names, types, counts — no payload decoding)  */
/* ------------------------------------------------------------------ */

export interface WpilogEntry {
  id: number;
  name: string;
  /** Type string exactly as logged ("double", "struct:Pose2d", …). */
  type: string;
  /** Metadata string; JSON when non-empty (may carry a "unit" property). */
  metadata: string;
  recordCount: number;
  firstTimestampUs: number;
  lastTimestampUs: number;
}

export interface WpilogCatalog {
  header: WpilogHeader;
  entries: WpilogEntry[];
  /** id → entry for quick lookup during extraction passes. */
  byId: Map<number, WpilogEntry>;
  scan: WpilogScanResult;
}

/**
 * First pass: catalog entries without decoding any data payload.
 * Re-Start of an entry ID keeps the newest name/type and resets counters
 * to keep accounting per active entry run.
 */
export function catalogWpilog(bytes: Uint8Array, fileName: string): WpilogCatalog {
  const header = readWpilogHeader(bytes, fileName);
  const byId = new Map<number, WpilogEntry>();
  const order: WpilogEntry[] = [];
  const start = (id: number, name: string, type: string, metadata: string, ts: number) => {
    const existing = byId.get(id);
    if (existing) {
      // Restart without Finish: undefined by the spec — record the newest
      // identity and continue counting into the same entry.
      existing.name = name;
      existing.type = type;
      existing.metadata = metadata;
      return;
    }
    const entry: WpilogEntry = {
      id, name, type, metadata,
      recordCount: 0,
      firstTimestampUs: ts,
      lastTimestampUs: ts,
    };
    byId.set(id, entry);
    order.push(entry);
  };
  const scan = scanWpilogRecords(bytes, header.firstRecordOffset, {
    onStart: start,
    onFinish: () => undefined,
    onMetadata: (id, metadata) => {
      const entry = byId.get(id);
      if (entry) entry.metadata = metadata;
    },
    onData: (record) => {
      const entry = byId.get(record.entryId);
      if (!entry) return; // data for an entry that never started: skip
      entry.recordCount++;
      if (record.timestampUs < entry.firstTimestampUs) entry.firstTimestampUs = record.timestampUs;
      if (record.timestampUs > entry.lastTimestampUs) entry.lastTimestampUs = record.timestampUs;
    },
  });
  return { header, entries: order, byId, scan };
}
