import { generateKeyPairSync, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createAppJwt,
  createPullRequest,
  parseArgs,
  validateInstallation,
} from '../../../scripts/create-pr-as-app.mjs';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const appId = '5549130';
const installationId = '177059739';
const now = new Date('2026-10-31T00:00:00Z');
const nowSeconds = Math.floor(now.getTime() / 1000);

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('GitHub App JWT', () => {
  it('signs a short-lived RS256 token with the app ID as issuer', () => {
    const jwt = createAppJwt({ appId, privateKey, now });
    const [header, payload, signature] = jwt.split('.');
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));

    expect(JSON.parse(Buffer.from(header, 'base64url').toString('utf8'))).toEqual({
      alg: 'RS256',
      typ: 'JWT',
    });
    expect(claims).toEqual({ iat: nowSeconds - 60, exp: nowSeconds + 540, iss: appId });
    expect(verify(
      'RSA-SHA256',
      `${header}.${payload}`,
      publicKey,
      Buffer.from(signature, 'base64url'),
    )).toBe(true);
  });
});

describe('read-only installation validation', () => {
  it('checks required permissions and direct repository access without creating a PR', async () => {
    const calls: Array<{ url: string; options: RequestInit }> = [];
    const fetchImpl = async (url: string | URL | Request, options: RequestInit = {}) => {
      calls.push({ url: String(url), options });
      if (calls.length === 1) {
        return jsonResponse({
          app_id: Number(appId),
          permissions: { contents: 'read', pull_requests: 'write', metadata: 'read' },
        });
      }
      if (calls.length === 2) {
        return jsonResponse({ token: 'installation-token', expires_at: '2026-10-31T01:00:00Z' });
      }
      return jsonResponse({ full_name: 'LYT259/PathBlender' });
    };

    const result = await validateInstallation({
      appId,
      installationId,
      privateKey,
      now,
      fetchImpl,
    });

    expect(calls.map((call) => `${call.options.method} ${call.url}`)).toEqual([
      `GET https://api.github.com/app/installations/${installationId}`,
      `POST https://api.github.com/app/installations/${installationId}/access_tokens`,
      'GET https://api.github.com/repos/LYT259/PathBlender',
    ]);
    expect(JSON.parse(String(calls[1].options.body))).toEqual({
      repositories: ['PathBlender'],
      permissions: { contents: 'read', pull_requests: 'write' },
    });
    expect(calls[2].options.headers).toMatchObject({
      Authorization: 'Bearer installation-token',
    });
    expect(result).toMatchObject({
      repository: 'LYT259/PathBlender',
      permissions: { pull_requests: 'write', contents: 'read' },
    });
  });

  it('stops before requesting an installation token when PR write permission is absent', async () => {
    let callCount = 0;
    const fetchImpl = async () => {
      callCount += 1;
      return jsonResponse({
        app_id: Number(appId),
        permissions: { contents: 'read', pull_requests: 'read', metadata: 'read' },
      });
    };

    await expect(validateInstallation({
      appId,
      installationId,
      privateKey,
      now,
      fetchImpl,
    })).rejects.toThrow(/pull requests write permission/i);
    expect(callCount).toBe(1);
  });

  it('stops before requesting an installation token when contents read permission is absent', async () => {
    let callCount = 0;
    const fetchImpl = async () => {
      callCount += 1;
      return jsonResponse({
        app_id: Number(appId),
        permissions: { pull_requests: 'write', metadata: 'read' },
      });
    };

    await expect(validateInstallation({
      appId,
      installationId,
      privateKey,
      now,
      fetchImpl,
    })).rejects.toThrow(/contents read permission/i);
    expect(callCount).toBe(1);
  });
});

describe('PR creation', () => {
  it('posts the requested base, head, title and body as the app installation', async () => {
    let request: { url: string; options: RequestInit } | undefined;
    const fetchImpl = async (url: string | URL | Request, options: RequestInit = {}) => {
      request = { url: String(url), options };
      return jsonResponse({
        number: 123,
        html_url: 'https://github.com/LYT259/PathBlender/pull/123',
      }, 201);
    };

    const result = await createPullRequest({
      installationToken: 'installation-token',
      base: 'beta',
      head: 'feat/example',
      title: 'Example PR',
      body: 'Summary\n- example',
      fetchImpl,
    });

    expect(request?.url).toBe('https://api.github.com/repos/LYT259/PathBlender/pulls');
    expect(request?.options.method).toBe('POST');
    expect(request?.options.headers).toMatchObject({
      Authorization: 'Bearer installation-token',
    });
    expect(JSON.parse(String(request?.options.body))).toEqual({
      base: 'beta',
      head: 'feat/example',
      title: 'Example PR',
      body: 'Summary\n- example',
    });
    expect(result).toEqual({
      number: 123,
      url: 'https://github.com/LYT259/PathBlender/pull/123',
    });
  });
});

describe('CLI safety', () => {
  it('distinguishes dry-run from explicit PR creation', () => {
    expect(parseArgs([
      '--dry-run', '--base', 'beta', '--head', 'feat/example', '--title', 'Example PR',
    ])).toMatchObject({
      mode: 'dry-run',
      base: 'beta',
      head: 'feat/example',
      title: 'Example PR',
      body: '',
    });
    expect(parseArgs([
      '--create', '--base', 'stable', '--head', 'feat/example', '--title', 'Example PR',
    ]).mode).toBe('create');
    expect(parseArgs(['--check']).mode).toBe('check');
  });

  it('rejects incomplete PR arguments before any credential or network use', () => {
    expect(() => parseArgs(['--create', '--base', 'beta'])).toThrow(/--head/);
    expect(() => parseArgs(['--dry-run', '--base', 'beta', '--head', 'feat/example'])).toThrow(/--title/);
  });
});
