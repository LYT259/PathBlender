import { spawn } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';

const base = 'http://127.0.0.1:4173/';
const server = spawn(process.execPath, ['scripts/serve-dist.mjs', '4173'], { stdio: 'inherit' });
const run = file => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [file], {
    stdio: 'inherit',
    env: { ...process.env, WALK_BASE: base },
  });
  child.on('error', reject);
  child.on('exit', code => {
    if (code === 0) resolve();
    else reject(new Error(`${file} failed: ${code}`));
  });
});

try {
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    if (server.exitCode !== null) throw new Error('Preview server exited');
    try {
      if ((await fetch(base)).ok) {
        ready = true;
        break;
      }
    } catch {
      // The child may still be binding its listener.
    }
    await setTimeout(500);
  }
  if (!ready) throw new Error('Preview server did not become ready');
  await run('scripts/browser-walkthrough.mjs');
  await run('scripts/keyboard-walkthrough.mjs');
} finally {
  server.kill();
}
