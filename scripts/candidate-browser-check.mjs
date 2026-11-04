import { spawn } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';
const server = spawn(process.execPath,['scripts/serve-dist.mjs','4173'],{stdio:'inherit'});
const run = file => new Promise((resolve,reject) => {
  const child=spawn(process.execPath,[file],{stdio:'inherit',env:{...process.env,WALK_CHROME:'0'}});
  child.on('error',reject);
  child.on('exit',code=>code===0?resolve():reject(new Error(`${file} failed: ${code}`)));
});
try {
  let ready=false;
  for(let i=0;i<30;i++) {
    if(server.exitCode!==null) throw new Error('Preview server exited');
    try { if((await fetch('http://127.0.0.1:4173/')).ok) {ready=true;break;} } catch {}
    await setTimeout(500);
  }
  if(!ready) throw new Error('Preview server did not become ready');
  await run('scripts/browser-walkthrough.mjs');
  await run('scripts/keyboard-walkthrough.mjs');
} finally { server.kill(); }
