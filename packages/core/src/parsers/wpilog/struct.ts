/**
 * WPILib packed-struct schemas: text DSL parser + binary decoder
 * (wpiutil struct.adoc, revision 1.0, verified 2026-11-03).
 *
 * The schema arrives inside the log itself as the payload of a
 * `/.schema/<type>` entry; nested types are sibling schema entries. Decoding
 * is pure interpretation — no eval, no code generation — so a hostile or
 * corrupt schema can never execute anything (parse-layer red line).
 *
 * Bit-field packing follows the spec's storage-unit model exactly:
 * adjacent bit-fields pack least-significant-bit-first into units of the
 * declared integer width; a bit-field joins the open unit when the widths
 * match — or when it is a 1-bit bool — and it fits; otherwise the unit
 * closes and a new one starts. Unused bits are ignored on read. Units wider
 * than 4 bytes decode through BigInt so high fields (e.g. ControlWord's
 * enabled bit at 58) stay exact past Number's 53-bit mantissa.
 */

export interface StructEnum {
  /** enum value → name */
  names: Map<number, string>;
}

export const PRIMITIVE_BYTES: Record<string, number> = {
  bool: 1, char: 1,
  int8: 1, uint8: 1,
  int16: 2, uint16: 2,
  int32: 4, uint32: 4,
  int64: 8, uint64: 8,
  float: 4, float32: 4,
  float64: 8, double: 8,
};

const INTEGER_TYPES = new Set([
  'int8', 'uint8', 'int16', 'uint16', 'int32', 'uint32', 'int64', 'uint64',
]);

export interface StructField {
  name: string;
  /** Declared primitive type, or the referenced struct name for nesteds. */
  type: string;
  /** Standard declaration with arraySize > 0; bit-field when bitWidth > 0. */
  arraySize: number;
  bitWidth: number;
  enumSpec?: StructEnum;
  /** Byte offset of the storage unit (bit-fields) or the field (standard). */
  offset: number;
  /** Bit offset inside the storage unit for bit-fields. */
  bitOffset: number;
  /** Storage-unit byte width for bit-fields (1/2/4/8). */
  unitBytes: number;
}

export interface StructLayout {
  /** Declared struct name (from the schema entry name, not the DSL text). */
  name: string;
  fields: StructField[];
  sizeBytes: number;
}

interface RawField {
  name: string;
  type: string;
  arraySize: number; // 0 = scalar
  bitWidth: number;  // 0 = standard declaration
  enumSpec?: StructEnum;
}

export interface ParsedSchema {
  name: string;
  raw: RawField[];
  /** Nested struct type names this schema references. */
  dependencies: string[];
}

const IDENT = /[A-Za-z_$\u0080-\uFFFF][\w$\u0080-\uFFFF]*/y;

function readIdent(text: string, pos: number): { id: string; pos: number } | null {
  IDENT.lastIndex = pos;
  const match = IDENT.exec(text);
  return match ? { id: match[0], pos: IDENT.lastIndex } : null;
}

function skipWs(text: string, pos: number): number {
  while (pos < text.length && /\s/.test(text[pos]!)) pos++;
  return pos;
}

/** Parse an optional enum spec `{a=1,b=2}` (with optional leading `enum`). */
function parseEnumSpec(text: string, pos: number): { spec: StructEnum; pos: number } | null {
  pos = skipWs(text, pos);
  if (text.startsWith('enum', pos)) {
    const after = skipWs(text, pos + 4);
    if (text[after] === '{') pos = after;
  }
  if (text[pos] !== '{') return null;
  pos = skipWs(text, pos + 1);
  const names = new Map<number, string>();
  while (pos < text.length && text[pos] !== '}') {
    const id = readIdent(text, pos);
    if (!id) return null; // malformed enum — treat the whole spec as absent
    pos = skipWs(text, id.pos);
    if (text[pos] !== '=') return null;
    pos = skipWs(text, pos + 1);
    const numStart = pos;
    while (pos < text.length && /[-+0-9]/.test(text[pos]!)) pos++;
    const value = Number.parseInt(text.slice(numStart, pos), 10);
    if (!Number.isFinite(value)) return null;
    names.set(value, id.id);
    pos = skipWs(text, pos);
    if (text[pos] === ',') pos = skipWs(text, pos + 1);
  }
  return text[pos] === '}' ? { spec: { names }, pos: pos + 1 } : null;
}

/** Parse one declaration body into a raw field, or null when malformed. */
function parseDeclaration(body: string): RawField | null {
  let pos = 0;
  let enumSpec: StructEnum | undefined;
  const parsedEnum = parseEnumSpec(body, pos);
  if (parsedEnum) {
    enumSpec = parsedEnum.spec;
    pos = parsedEnum.pos;
  }
  pos = skipWs(body, pos);
  const type = readIdent(body, pos);
  if (!type) return null;
  pos = skipWs(body, type.pos);
  const name = readIdent(body, pos);
  if (!name) return null;
  pos = skipWs(body, name.pos);
  let arraySize = 0;
  let bitWidth = 0;
  if (body[pos] === '[') {
    pos = skipWs(body, pos + 1);
    const numStart = pos;
    while (pos < body.length && /\d/.test(body[pos]!)) pos++;
    arraySize = Number.parseInt(body.slice(numStart, pos), 10);
    if (!Number.isFinite(arraySize) || arraySize <= 0) return null;
    pos = skipWs(body, pos);
    if (body[pos] !== ']') return null;
    pos = skipWs(body, pos + 1);
  }
  if (body[pos] === ':') {
    pos = skipWs(body, pos + 1);
    const numStart = pos;
    while (pos < body.length && /\d/.test(body[pos]!)) pos++;
    bitWidth = Number.parseInt(body.slice(numStart, pos), 10);
    if (!Number.isFinite(bitWidth) || bitWidth <= 0) return null;
    pos = skipWs(body, pos);
  }
  if (pos !== body.length) return null;
  return { name: name.id, type: type.id, arraySize, bitWidth, enumSpec };
}

/**
 * Parse the schema DSL for one struct into raw declarations. Returns null
 * for malformed text; validation of bit-field legality happens here too so
 * an invalid schema can never reach the decoder.
 */
export function parseStructSchema(name: string, schemaText: string): ParsedSchema | null {
  const raw: RawField[] = [];
  const dependencies: string[] = [];
  for (const piece of schemaText.split(';')) {
    if (piece.trim() === '') continue;
    const field = parseDeclaration(piece);
    if (!field) return null;
    if (field.bitWidth > 0) {
      if (field.type === 'bool') {
        if (field.bitWidth !== 1 || field.arraySize > 0) return null;
      } else if (INTEGER_TYPES.has(field.type)) {
        if (field.arraySize > 0) return null; // no bit-field arrays
        if (field.bitWidth > PRIMITIVE_BYTES[field.type]! * 8) return null;
      } else {
        return null; // float/double/nested bit-fields are illegal
      }
    } else if (PRIMITIVE_BYTES[field.type] === undefined) {
      dependencies.push(field.type);
    }
    raw.push(field);
  }
  return { name, raw, dependencies };
}

/** A `resolve` call returns the layout for a type name or undefined. */
export type StructLookup = (name: string) => StructLayout | undefined;

interface OpenUnit {
  byteWidth: number;
  bitsUsed: number;
}

/**
 * Compute the concrete layout for a parsed schema. Nested struct fields get
 * their element sizes from `lookup` (mutual recursion resolves chains);
 * returns null on missing or circular nested references.
 */
export function buildStructLayout(parsed: ParsedSchema, lookup: StructLookup, resolving: Set<string> = new Set()): StructLayout | null {
  resolving.add(parsed.name);
  const resolveElementSize = (type: string): number | null => {
    const prim = PRIMITIVE_BYTES[type];
    if (prim !== undefined) return prim;
    if (resolving.has(type)) return null; // circular reference
    const nested = lookup(type);
    if (!nested) return null;
    return nested.sizeBytes;
  };
  const fields: StructField[] = [];
  let offset = 0;
  let openUnit: OpenUnit | null = null;
  for (const field of parsed.raw) {
    if (field.bitWidth > 0) {
      const unitBytes = field.type === 'bool' ? 1 : PRIMITIVE_BYTES[field.type]!;
      const canJoin = openUnit !== null &&
        (unitBytes === openUnit.byteWidth || field.type === 'bool') &&
        openUnit.bitsUsed + field.bitWidth <= openUnit.byteWidth * 8;
      if (canJoin && openUnit) {
        fields.push({ ...field, offset, bitOffset: openUnit.bitsUsed, unitBytes: openUnit.byteWidth });
        openUnit.bitsUsed += field.bitWidth;
      } else {
        if (openUnit) offset += openUnit.byteWidth;
        fields.push({ ...field, offset, bitOffset: 0, unitBytes });
        openUnit = { byteWidth: unitBytes, bitsUsed: field.bitWidth };
      }
      continue;
    }
    if (openUnit) {
      offset += openUnit.byteWidth;
      openUnit = null;
    }
    const arraySize = field.arraySize > 0 ? field.arraySize : 1;
    const elementSize = resolveElementSize(field.type);
    if (elementSize === null) return null;
    fields.push({ ...field, offset, bitOffset: 0, unitBytes: 0 });
    offset += elementSize * arraySize;
  }
  if (openUnit) offset += openUnit.byteWidth;
  return { name: parsed.name, fields, sizeBytes: offset };
}

/**
 * Build layouts for a whole schema set (one per logged `/.schema/struct:X`),
 * resolving cross-references. Unresolvable schemas are simply absent from
 * the result; entries typed against them report as undecodable.
 */
export function buildStructSet(schemas: Iterable<ParsedSchema>): Map<string, StructLayout> {
  const byName = new Map<string, StructLayout>();
  const parsedByName = new Map<string, ParsedSchema>();
  for (const parsed of schemas) parsedByName.set(parsed.name, parsed);
  const lookup: StructLookup = (name) => {
    const cached = byName.get(name);
    if (cached) return cached;
    const parsed = parsedByName.get(name);
    if (!parsed) return undefined;
    const built = buildStructLayout(parsed, lookup);
    if (built) byName.set(name, built);
    return built ?? undefined;
  };
  for (const parsed of parsedByName.values()) {
    lookup(parsed.name);
  }
  return byName;
}

export type StructValue = number | boolean | string | StructValue[] | { [key: string]: StructValue };

/** Decode one struct instance at `baseOffset` inside `bytes`. */
export function decodeStructValue(
  layout: StructLayout,
  bytes: Uint8Array,
  lookup: StructLookup,
  baseOffset = 0,
  depth = 0,
): { [key: string]: StructValue } | null {
  if (depth > 8) return null; // pathological nesting guard
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: { [key: string]: StructValue } = {};
  for (const field of layout.fields) {
    const offset = baseOffset + field.offset;
    if (field.bitWidth > 0) {
      if (offset + field.unitBytes > bytes.length) return null;
      let value: number | boolean;
      if (field.unitBytes > 4) {
        // Wide units go through BigInt: shifting a 64-bit value held in a
        // Number loses the low bits past 2^53, and the fields we care about
        // (ControlWord enabled/robotMode at bits 56+) must stay exact.
        let raw = 0n;
        for (let i = field.unitBytes - 1; i >= 0; i--) {
          raw = (raw << 8n) | BigInt(bytes[offset + i]!);
        }
        let unit = Number(raw >> BigInt(field.bitOffset));
        // Bit-fields wider than 53 lose their lowest bits in the Number
        // conversion; the pose-relevant ControlWord fields are 1–2 bits
        // near the top of the unit, which stay exact.
        if (field.bitWidth < 53) unit %= 2 ** field.bitWidth;
        value = field.type === 'bool' ? (unit & 1) === 1 : toSigned(unit, field.bitWidth, field.type.startsWith('int'));
      } else {
        let unit = 0;
        for (let i = 0; i < field.unitBytes; i++) {
          unit += bytes[offset + i]! * 2 ** (8 * i);
        }
        unit = Math.floor(unit / 2 ** field.bitOffset) % 2 ** field.bitWidth;
        value = field.type === 'bool' ? (unit & 1) === 1 : toSigned(unit, field.bitWidth, field.type.startsWith('int'));
      }
      out[field.name] = value;
      continue;
    }
    const arraySize = field.arraySize > 0 ? field.arraySize : 1;
    const elementSize = PRIMITIVE_BYTES[field.type] ?? lookup(field.type)?.sizeBytes ?? -1;
    if (elementSize < 0) return null;
    const decodeOne = (elementOffset: number): StructValue | null => {
      if (elementOffset + elementSize > bytes.length) return null;
      try {
        switch (field.type) {
          case 'bool': return bytes[elementOffset] !== 0;
          case 'char': return bytes[elementOffset]!;
          case 'int8': return view.getInt8(elementOffset);
          case 'uint8': return view.getUint8(elementOffset);
          case 'int16': return view.getInt16(elementOffset, true);
          case 'uint16': return view.getUint16(elementOffset, true);
          case 'int32': return view.getInt32(elementOffset, true);
          case 'uint32': return view.getUint32(elementOffset, true);
          case 'int64': return Number(view.getBigInt64(elementOffset, true));
          case 'uint64': return Number(view.getBigUint64(elementOffset, true));
          case 'float': case 'float32': return view.getFloat32(elementOffset, true);
          case 'float64': case 'double': return view.getFloat64(elementOffset, true);
          default: {
            const nested = lookup(field.type);
            if (!nested) return null;
            return decodeStructValue(nested, bytes, lookup, elementOffset, depth + 1);
          }
        }
      } catch {
        return null; // DataView out-of-bounds: malformed record
      }
    };
    if (field.arraySize > 0) {
      const items: StructValue[] = [];
      for (let i = 0; i < field.arraySize; i++) {
        const item = decodeOne(offset + i * elementSize);
        if (item === null) return null;
        items.push(item);
      }
      out[field.name] = field.type === 'char' ? charsToString(items as number[]) : items;
      continue;
    }
    const value = decodeOne(offset);
    if (value === null) return null;
    out[field.name] = value;
  }
  return out;
}

function charsToString(codes: number[]): string {
  let s = '';
  for (const c of codes) {
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s;
}

function toSigned(value: number, bits: number, signed: boolean): number {
  if (!signed) return value;
  const signBit = 2 ** (bits - 1);
  return value >= signBit ? value - 2 ** bits : value;
}
