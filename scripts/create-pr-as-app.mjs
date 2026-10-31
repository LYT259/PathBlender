import { sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const API_ROOT = 'https://api.github.com';
const API_VERSION = '2026-03-10';
const REPOSITORY = 'LYT259/PathBlender';

const USAGE = `Usage:
  node scripts/create-pr-as-app.mjs --check
  node scripts/create-pr-as-app.mjs --dry-run --base <branch> --head <branch> --title <title> [--body <body>]
  node scripts/create-pr-as-app.mjs --create --base <branch> --head <branch> --title <title> [--body <body>]

Environment for --check and --create:
  GITHUB_APP_ID
  GITHUB_APP_INSTALLATION_ID
  GITHUB_APP_PRIVATE_KEY_PATH

--check only validates app permissions and repository access.
--dry-run performs no credential or network operations.
--create is the only mode that creates a pull request.`;

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

export function createAppJwt({ appId, privateKey, now = new Date() }) {
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({
    iat: nowSeconds - 60,
    exp: nowSeconds + 540,
    iss: String(appId),
  })}`;
  const signature = sign('RSA-SHA256', unsigned, privateKey).toString('base64url');
  return `${unsigned}.${signature}`;
}

export async function githubRequest({
  path,
  token,
  method = 'GET',
  body,
  fetchImpl = fetch,
}) {
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'User-Agent': 'pathblender-pr-bot',
    'X-GitHub-Api-Version': API_VERSION,
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const response = await fetchImpl(`${API_ROOT}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let payload = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(`GitHub API ${method} ${path} returned non-JSON content (${response.status})`);
    }
  }
  if (!response.ok) {
    const message = payload.message || response.statusText || 'unknown error';
    throw new Error(`GitHub API ${method} ${path} failed (${response.status}): ${message}`);
  }
  return payload;
}

export async function validateInstallation({
  appId,
  installationId,
  privateKey,
  now = new Date(),
  fetchImpl = fetch,
}) {
  const jwt = createAppJwt({ appId, privateKey, now });
  const installation = await githubRequest({
    path: `/app/installations/${installationId}`,
    token: jwt,
    fetchImpl,
  });
  if (String(installation.app_id) !== String(appId)) {
    throw new Error('GitHub App installation does not belong to the configured App ID');
  }

  const permissions = installation.permissions || {};
  if (permissions.pull_requests !== 'write') {
    throw new Error('GitHub App needs pull requests write permission');
  }
  if (!['read', 'write'].includes(permissions.contents)) {
    throw new Error('GitHub App needs contents read permission');
  }

  const tokenResponse = await githubRequest({
    path: `/app/installations/${installationId}/access_tokens`,
    method: 'POST',
    token: jwt,
    body: {
      repositories: ['PathBlender'],
      permissions: { contents: 'read', pull_requests: 'write' },
    },
    fetchImpl,
  });
  const repository = await githubRequest({
    path: `/repos/${REPOSITORY}`,
    token: tokenResponse.token,
    fetchImpl,
  });

  return {
    repository: repository.full_name,
    permissions,
    token: tokenResponse.token,
    tokenExpiresAt: tokenResponse.expires_at,
  };
}

export async function createPullRequest({
  installationToken,
  base,
  head,
  title,
  body = '',
  fetchImpl = fetch,
}) {
  const pullRequest = await githubRequest({
    path: `/repos/${REPOSITORY}/pulls`,
    method: 'POST',
    token: installationToken,
    body: { base, head, title, body },
    fetchImpl,
  });
  return { number: pullRequest.number, url: pullRequest.html_url };
}

export function parseArgs(argv) {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    return { mode: 'help' };
  }
  if (argv.length === 1 && argv[0] === '--check') return { mode: 'check' };
  if (argv[0] !== '--dry-run' && argv[0] !== '--create') {
    throw new Error('Choose --check, --dry-run, or --create');
  }

  const options = { mode: argv[0].slice(2), body: '' };
  for (let index = 1; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!['--base', '--head', '--title', '--body'].includes(flag)) {
      throw new Error(`Unknown argument: ${flag}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`${flag} needs a value`);
    }
    options[flag.slice(2)] = value;
    index += 1;
  }
  for (const flag of ['--base', '--head', '--title']) {
    if (!options[flag.slice(2)]) throw new Error(`${flag} is required`);
  }
  return options;
}

function loadCredentials(env) {
  const names = [
    'GITHUB_APP_ID',
    'GITHUB_APP_INSTALLATION_ID',
    'GITHUB_APP_PRIVATE_KEY_PATH',
  ];
  for (const name of names) {
    if (!env[name]) throw new Error(`${name} is required`);
  }
  return {
    appId: env.GITHUB_APP_ID,
    installationId: env.GITHUB_APP_INSTALLATION_ID,
    privateKey: readFileSync(env.GITHUB_APP_PRIVATE_KEY_PATH, 'utf8'),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.mode === 'help') {
    console.log(USAGE);
    return;
  }
  if (options.mode === 'dry-run') {
    console.log(JSON.stringify({
      base: options.base,
      head: options.head,
      title: options.title,
      body: options.body,
    }, null, 2));
    return;
  }

  const credentials = loadCredentials(process.env);
  const installation = await validateInstallation(credentials);
  if (options.mode === 'check') {
    console.log(`GitHub App authentication OK for ${installation.repository}`);
    console.log('Pull requests permission: write');
    console.log(`Contents permission: ${installation.permissions.contents || 'not granted'}`);
    return;
  }

  const pullRequest = await createPullRequest({
    installationToken: installation.token,
    base: options.base,
    head: options.head,
    title: options.title,
    body: options.body,
  });
  console.log(`Created PR #${pullRequest.number}: ${pullRequest.url}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`create-pr-as-app: ${error.message}`);
    process.exitCode = 1;
  });
}
