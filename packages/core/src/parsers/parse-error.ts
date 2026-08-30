/** Parser error kinds, mapped to actionable user-facing messages in the UI. */
export type ParseErrorKind =
  | 'invalid-json'
  | 'unrecognized-format'
  | 'empty-trajectory'
  | 'missing-trajectory'
  | 'not-yet-supported';

export class ParseError extends Error {
  readonly kind: ParseErrorKind;
  readonly fileName: string;

  constructor(kind: ParseErrorKind, fileName: string, detail?: string) {
    super(detail ? `${kind}: ${detail}` : kind);
    this.name = 'ParseError';
    this.kind = kind;
    this.fileName = fileName;
  }
}
