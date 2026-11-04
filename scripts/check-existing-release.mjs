import { readFileSync, readdirSync } from 'node:fs';
const [metadata, dir, tag] = process.argv.slice(2);
const release = JSON.parse(readFileSync(metadata,'utf8'));
if(release.tagName!==tag || release.isDraft) throw new Error('Existing release does not match the expected published tag');
const names=new Set(release.assets.filter(a=>a.state==='uploaded' && a.size>0).map(a=>a.name));
for(const name of readdirSync(dir)) if(!names.has(name)) throw new Error(`Existing release is incomplete: ${name}; manual recovery required`);
console.log('Existing published release has all expected assets; preserving installers');
