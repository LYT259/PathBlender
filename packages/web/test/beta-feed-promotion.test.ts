import { describe, expect, it } from 'vitest';
// @ts-expect-error repository scripts are plain JavaScript
import { compareVersions, planPromotion } from '../../../scripts/promote-beta-feed.mjs';

function release(tag: string, assets: string[]) {
  return {
    tag_name: tag,
    draft: false,
    prerelease: tag.includes('-beta.'),
    assets: assets.map(name => ({ name, state: 'uploaded', size: 100 })),
  };
}

describe('beta feed promotion recovery', () => {
  it('repairs the actual latest stable even when its beta feed disappeared', () => {
    const latest = release('v0.1.9', ['latest.json']);
    const plan = planPromotion([
      release('v0.1.8', ['latest.json', 'latest-beta.json']),
      latest,
      release('v0.1.10-beta.5', ['latest-beta.json']),
    ], latest);
    expect(plan).toEqual({
      sourceTag: 'v0.1.10-beta.5',
      sourceAsset: 'latest-beta.json',
      destinationTag: 'v0.1.9',
    });
  });

  it('uses the canonical stable feed and the API-selected latest destination', () => {
    const latest = release('v0.1.9', ['latest.json']);
    expect(planPromotion([
      latest,
      release('v0.1.10', ['latest.json', 'latest-beta.json']),
      release('v0.1.10-beta.12', ['latest-beta.json']),
    ], latest)).toEqual({
      sourceTag: 'v0.1.10', sourceAsset: 'latest.json', destinationTag: 'v0.1.9',
    });
    expect(compareVersions('0.1.10-beta.12', '0.1.10-beta.9')).toBe(1);
  });

  it('ignores draft or incomplete sources and rejects an invalid destination', () => {
    const stable = release('v0.1.9', ['latest.json']);
    expect(planPromotion([
      stable,
      { ...release('v0.1.10-beta.6', ['latest-beta.json']), draft: true },
      release('v0.1.10-beta.5', []),
      { ...release('v0.1.10-beta.4', []), assets: [{ name: 'latest-beta.json', state: 'new', size: 0 }] },
    ], stable).sourceTag).toBe('v0.1.9');
    expect(() => planPromotion([], stable)).toThrow('No completed');
    expect(() => planPromotion([stable], { ...stable, prerelease: true })).toThrow('stable');
  });
});
