/**
 * Minimal protobuf decoding for `proto:<Message>` log entries.
 *
 * WPILib protobuf log entries carry their schema as a serialized
 * FileDescriptorProto in a sibling `/.schema/proto:<Message>` entry (the
 * DataLog.addSchema(Protobuf) path). This module parses just enough of that
 * descriptor — message names, field numbers, names and types, including
 * nested messages — to generically decode pose-style payloads off the wire.
 * Wire format: field key varints (field number << 3 | wire type), varints,
 * 64-bit blocks, length-delimited groups. Pure interpretation, no eval.
 */

export type ProtoValue = number | boolean | string | LongValue | ProtoValue[] | { [field: string]: ProtoValue };

/** A 64-bit varint kept as {low, high} pieces; pose data rarely needs it. */
export interface LongValue {
  low: number;
  high: number;
}

export interface ProtoFieldDesc {
  name: string;
  number: number;
  /** protobuf FieldDescriptorProto.Type value. */
  type: number;
  /** Fully-qualified referenced message type (".pkg.Msg"), for messages. */
  typeName?: string;
}

export interface ProtoMessageDesc {
  /** Fully-qualified name without the leading dot (".pkg.Msg" → "pkg.Msg"). */
  name: string;
  fields: ProtoFieldDesc[];
  nested: ProtoMessageDesc[];
}

export const PROTO_TYPE_DOUBLE = 1;
export const PROTO_TYPE_FLOAT = 2;
export const PROTO_TYPE_BOOL = 8;
export const PROTO_TYPE_STRING = 9;
export const PROTO_TYPE_MESSAGE = 11;

/* ------------------------------------------------------------------ */
/* Wire-format primitives                                              */
/* ------------------------------------------------------------------ */

interface WireCursor {
  bytes: Uint8Array;
  view: DataView;
  pos: number;
}

function readVarint(c: WireCursor): bigint | null {
  let value = 0n;
  let shift = 0n;
  for (;;) {
    if (c.pos >= c.bytes.length) return null;
    const b = c.bytes[c.pos]!;
    c.pos++;
    value |= BigInt(b & 0x7f) << shift;
    if ((b & 0x80) === 0) return value;
    shift += 7n;
    if (shift > 70n) return null; // malformed varint longer than 10 bytes
  }
}

function zigzagDecode(value: bigint): number {
  return Number((value >> 1n) ^ -(value & 1n));
}

/* ------------------------------------------------------------------ */
/* FileDescriptorProto mini-parser                                     */
/* ------------------------------------------------------------------ */

/** Iterate length-delimited submessages of a message body (field `field`). */
function forEachField(
  bytes: Uint8Array,
  field: number,
  visit: (sub: Uint8Array) => void,
): void {
  const c: WireCursor = { bytes, view: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), pos: 0 };
  while (c.pos < bytes.length) {
    const start = c.pos;
    const key = readVarint(c);
    if (key === null) return;
    const fieldNumber = Number(key >> 3n);
    const wireType = Number(key & 7n);
    if (fieldNumber === field && wireType === 2) {
      const len = readVarint(c);
      if (len === null) return;
      const end = c.pos + Number(len);
      if (end > bytes.length) return;
      visit(bytes.subarray(c.pos, end));
      c.pos = end;
      continue;
    }
    if (!skipWireValue(c, wireType)) return;
    if (c.pos <= start) return;
  }
}

function skipWireValue(c: WireCursor, wireType: number): boolean {
  switch (wireType) {
    case 0: return readVarint(c) !== null;
    case 1: c.pos += 8; return c.pos <= c.bytes.length;
    case 2: {
      const len = readVarint(c);
      if (len === null) return false;
      c.pos += Number(len);
      return c.pos <= c.bytes.length;
    }
    case 5: c.pos += 4; return c.pos <= c.bytes.length;
    default: return false; // groups (3/4) deprecated and unused here
  }
}

function readStringField(bytes: Uint8Array, field: number): string | undefined {
  let found: string | undefined;
  forEachField(bytes, field, (sub) => {
    if (found === undefined) {
      found = new TextDecoder('utf-8', { fatal: false }).decode(sub);
    }
  });
  return found;
}

function readNumberField(bytes: Uint8Array, field: number): number | undefined {
  const c: WireCursor = { bytes, view: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), pos: 0 };
  while (c.pos < bytes.length) {
    const key = readVarint(c);
    if (key === null) return undefined;
    const fieldNumber = Number(key >> 3n);
    const wireType = Number(key & 7n);
    if (fieldNumber === field && wireType === 0) {
      // A truncated value varint propagates undefined (field dropped),
      // never a silent 0. Read once — readVarint consumes bytes.
      const value = readVarint(c);
      return value === null ? undefined : Number(value);
    }
    if (!skipWireValue(c, wireType)) return undefined;
  }
  return undefined;
}

function parseDescriptorProto(bytes: Uint8Array, scope: string): ProtoMessageDesc {
  const name = readStringField(bytes, 1) ?? '';
  const fullName = scope === '' ? name : `${scope}.${name}`;
  const fields: ProtoFieldDesc[] = [];
  forEachField(bytes, 2, (sub) => {
    const fieldName = readStringField(sub, 1);
    const number = readNumberField(sub, 3);
    const type = readNumberField(sub, 5);
    const typeName = readStringField(sub, 6);
    if (fieldName === undefined || number === undefined || type === undefined) return;
    fields.push({ name: fieldName, number, type, typeName });
  });
  const nested: ProtoMessageDesc[] = [];
  forEachField(bytes, 3, (sub) => {
    nested.push(parseDescriptorProto(sub, fullName));
  });
  fields.sort((a, b) => a.number - b.number);
  return { name: fullName, fields, nested };
}

/**
 * Parse a FileDescriptorProto payload into the message table
 * (messages keyed by fully-qualified name, e.g. "wpimath.Pose2d").
 */
export function parseFileDescriptor(bytes: Uint8Array): ProtoMessageDesc[] {
  const messages: ProtoMessageDesc[] = [];
  const pkg = readStringField(bytes, 2) ?? '';
  forEachField(bytes, 4, (sub) => {
    messages.push(parseDescriptorProto(sub, pkg));
  });
  return messages;
}

/* ------------------------------------------------------------------ */
/* Generic payload decoding                                            */
/* ------------------------------------------------------------------ */

function decodeMessage(
  bytes: Uint8Array,
  desc: ProtoMessageDesc | undefined,
  messagesByName: Map<string, ProtoMessageDesc>,
  depth: number,
): { [field: string]: ProtoValue } {
  const out: { [field: string]: ProtoValue } = {};
  if (depth > 8) return out;
  const c: WireCursor = { bytes, view: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), pos: 0 };
  while (c.pos < bytes.length) {
    const key = readVarint(c);
    if (key === null) break;
    const fieldNumber = Number(key >> 3n);
    const wireType = Number(key & 7n);
    const desc2 = desc?.fields.find((f) => f.number === fieldNumber);
    const name = desc2?.name ?? `field${fieldNumber}`;
    let value: ProtoValue | undefined;
    if (wireType === 1) {
      if (desc2?.type === PROTO_TYPE_DOUBLE) {
        value = c.view.getFloat64(c.pos, true);
      }
      c.pos += 8;
    } else if (wireType === 5) {
      if (desc2?.type === PROTO_TYPE_FLOAT) {
        value = c.view.getFloat32(c.pos, true);
      }
      c.pos += 4;
    } else if (wireType === 0) {
      const v = readVarint(c);
      if (v === null) break;
      if (desc2?.type === PROTO_TYPE_BOOL) value = v !== 0n;
      else if (desc2?.type === PROTO_TYPE_DOUBLE || desc2?.type === PROTO_TYPE_FLOAT) {
        // sint/double mismatch tolerance: keep the number
        value = Number(v);
      } else {
        const low = Number(v & 0xffffffffn);
        const high = Number(v >> 32n);
        value = high === 0 ? low : { low, high } satisfies LongValue;
      }
    } else if (wireType === 2) {
      const len = readVarint(c);
      if (len === null) break;
      const end = c.pos + Number(len);
      if (end > bytes.length) break;
      const sub = bytes.subarray(c.pos, end);
      c.pos = end;
      if (desc2?.type === PROTO_TYPE_STRING) {
        value = new TextDecoder('utf-8', { fatal: false }).decode(sub);
      } else if (desc2?.type === PROTO_TYPE_MESSAGE && desc2.typeName) {
        const nestedDesc = messagesByName.get(desc2.typeName.replace(/^\./, ''));
        value = decodeMessage(sub, nestedDesc, messagesByName, depth + 1);
      } else {
        // Unknown nested blob: try decoding as a message only when a
        // descriptor exists; otherwise leave the raw byte length.
        value = { bytes: sub.length };
      }
    } else {
      if (!skipWireValue(c, wireType)) break;
    }
    if (value === undefined) {
      if (wireType === 1 || wireType === 5) value = 0; // skip-shaped 64/32-bit
      else continue;
    }
    const existing = out[name];
    if (existing === undefined) {
      out[name] = value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      out[name] = [existing, value];
    }
  }
  return out;
}

/** Decode a payload against a message table (map of all parsed messages). */
export function decodeProtoPayload(
  bytes: Uint8Array,
  messages: ProtoMessageDesc[],
  rootName: string,
): { [field: string]: ProtoValue } | null {
  const messagesByName = new Map<string, ProtoMessageDesc>();
  const walk = (list: ProtoMessageDesc[]) => {
    for (const message of list) {
      messagesByName.set(message.name, message);
      walk(message.nested);
    }
  };
  walk(messages);
  // The root type string is "proto:Pose2d"; descriptors register the
  // message under its package path (e.g. "wpimath.Pose2d") — match by
  // suffix so both spellings resolve.
  let root = messagesByName.get(rootName);
  if (!root) {
    for (const message of messagesByName.values()) {
      if (message.name.endsWith(`.${rootName}`) || message.name === rootName) {
        root = message;
        break;
      }
    }
  }
  try {
    return decodeMessage(bytes, root, messagesByName, 0);
  } catch {
    return null;
  }
}
