/** Minimal ambient types for gifenc (MIT, no shipped declarations). */
declare module 'gifenc' {
  export interface GifEncoderInstance {
    writeFrame(index: Uint8Array, width: number, height: number, opts?: {
      palette?: number[][];
      delay?: number;
      repeat?: number;
    }): void;
    finish(): void;
    bytes(): Uint8Array;
  }
  export function GIFEncoder(): GifEncoderInstance;
  export function quantize(rgba: Uint8Array | Uint8ClampedArray, maxColors: number): number[][];
  export function applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: number[][]): Uint8Array;
}
