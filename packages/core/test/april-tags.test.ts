import { describe, expect, it } from 'vitest';
import { parseAprilTagLayout, AprilTagParseError, makeCustomField, serializeSession, deserializeSession } from '../src';

const layout = JSON.stringify({
  fields: { 'field-length': 16.5417, 'field-width': 8.0137 },
  tags: [
    // 2024+ official shape: quaternion rotation
    { ID: 1, pose: { translation: { x: 15.08, y: 1.45, z: 1.27 }, rotation: { quaternion: { X: 0, Y: 0, Z: 0.7071, W: 0.7071 } } } },
    // older lowercase-id shape, no rotation
    { id: 2, pose: { translation: { x: 1.5, y: 4.0, z: 1.3 } } },
    // malformed entry → skipped, not fatal
    { ID: 'garbage' },
  ],
});

describe('parseAprilTagLayout', () => {
  it('parses both ID shapes with quaternion yaw extraction', () => {
    const { tags, fieldLengthM, fieldWidthM } = parseAprilTagLayout(layout);
    expect(tags).toHaveLength(2);
    expect(tags[0]!.id).toBe(1);
    expect(tags[0]!.x).toBeCloseTo(15.08, 6);
    expect(tags[0]!.rotRad).toBeCloseTo(Math.PI / 2, 3);
    expect(tags[1]!.id).toBe(2);
    expect(tags[1]!.rotRad).toBeUndefined();
    expect(fieldLengthM).toBeCloseTo(16.5417, 4);
    expect(fieldWidthM).toBeCloseTo(8.0137, 4);
  });

  it('rejects non-JSON and empty layouts with clear errors', () => {
    expect(() => parseAprilTagLayout('{oops')).toThrow(AprilTagParseError);
    expect(() => parseAprilTagLayout('{"hello":1}')).toThrow(/no usable tags/);
  });

  it('custom-field session round-trip keeps aprilTags', () => {
    const { tags } = parseAprilTagLayout(layout);
    const field = makeCustomField({
      lengthM: 16.5417, widthM: 8.0137, ppm: 200, marginM: 0,
      pixelWidth: 3308, pixelHeight: 1603, aprilTags: tags,
    });
    const text = serializeSession([], 'custom', field);
    const back = deserializeSession(text);
    expect(back.field?.aprilTags).toHaveLength(2);
    expect(back.field?.aprilTags?.[0]!.rotRad).toBeCloseTo(Math.PI / 2, 3);
  });
});
