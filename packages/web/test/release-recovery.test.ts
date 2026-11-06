import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { it, expect } from 'vitest';
it('recovers incomplete drafts but never replaces incomplete published assets', () => {
  const root=mkdtempSync(join(tmpdir(),'pb-recovery-'));
  const script=resolve(__dirname,'../../../scripts/check-existing-release.mjs');
  try {
    const assets=join(root,'assets'); mkdirSync(assets); writeFileSync(join(assets,'setup.exe'),'candidate');
    const file=join(root,'release.json');
    const run=(data: object)=>{writeFileSync(file,JSON.stringify(data)); return execFileSync(process.execPath,[script,file,assets,'v1.0.1-beta.1'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();};
    expect(run({tagName:'v1.0.1-beta.1',isDraft:true,assets:[]})).toBe('draft');
    expect(()=>run({tagName:'v1.0.1-beta.1',isDraft:false,assets:[]})).toThrow();
    expect(run({tagName:'v1.0.1-beta.1',isDraft:false,assets:[{name:'setup.exe',state:'uploaded',size:9}]})).toBe('published');
    expect(()=>run({tagName:'v1.0.1-beta.2',isDraft:true,assets:[]})).toThrow();
    expect(()=>run({tagName:'v1.0.1-beta.1',isDraft:true,assets:[{name:'unknown.zip'}]})).toThrow();
  } finally { rmSync(root,{recursive:true,force:true}); }
});
