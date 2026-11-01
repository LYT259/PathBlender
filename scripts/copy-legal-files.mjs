import { copyFile, cp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = resolve(root, 'packages/web/dist');

await Promise.all([
  copyFile(resolve(root, 'LICENSE'), resolve(dist, 'LICENSE')),
  copyFile(resolve(root, 'NOTICE.md'), resolve(dist, 'NOTICE.md')),
  cp(resolve(root, 'licenses'), resolve(dist, 'licenses'), { recursive: true }),
]);
