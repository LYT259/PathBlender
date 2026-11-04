import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const gh = args => execFileSync('gh',args,{encoding:'utf8'});
const repo=process.env.GITHUB_REPOSITORY;
if(!/^[\w.-]+\/[\w.-]+$/.test(repo??'')) throw new Error('Missing repository');
export function compareVersions(a,b) {
  const parse=v=>{const m=/^v?(\d+)\.(\d+)\.(\d+)(?:-beta\.(\d+))?$/.exec(v); return m ? [Number(m[1]),Number(m[2]),Number(m[3]),m[4]===undefined?Infinity:Number(m[4])] : null;};
  const x=parse(a), y=parse(b);
  if(!x||!y) throw new Error('Unsupported release version');
  for(let i=0;i<4;i++) if(x[i]!==y[i]) return x[i]>y[i]?1:-1;
  return 0;
}
const pages=JSON.parse(gh(['api','--paginate','--slurp',`repos/${repo}/releases?per_page=100`]));
const releases=pages.flat().filter(r=>!r.draft && /^v\d+\.\d+\.\d+(?:-beta\.\d+)?$/.test(r.tag_name) && r.assets.some(a=>a.name==='latest-beta.json'));
releases.sort((a,b)=>compareVersions(b.tag_name,a.tag_name));
const newest=releases[0], stable=releases.find(r=>!r.prerelease);
if(!stable || !newest) {console.log('No stable release to host the beta feed'); process.exit(0);}
const dir=mkdtempSync(join(tmpdir(),'pb-feed-'));
try {
  gh(['release','download',newest.tag_name,'--repo',repo,'--pattern','latest-beta.json','--dir',dir]);
  const file=join(dir,'latest-beta.json');
  const feed=JSON.parse(readFileSync(file,'utf8'));
  if(compareVersions(feed.version,newest.tag_name)!==0) throw new Error('Newest release feed has an unexpected version');
  gh(['release','upload',stable.tag_name,file,'--repo',repo,'--clobber']);
  console.log(`Promoted ${feed.version} onto ${stable.tag_name}`);
} finally {rmSync(dir,{recursive:true,force:true});}
