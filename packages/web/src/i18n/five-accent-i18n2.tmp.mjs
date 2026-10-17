import { readFileSync, writeFileSync, existsSync, unlinkSync, renameSync } from 'node:fs';

const NAMES = JSON.parse(readFileSync('/tmp/accent-names.json', 'utf8'));
const FILES = {
  en: 'en.ts', ar: 'ar.ts', az: 'az.ts', bg: 'bg.ts', bs: 'bs.ts', cs: 'cs.ts',
  da: 'da.ts', de: 'de.ts', el: 'el.ts', es: 'es.ts', fil: 'fil.ts', fr: 'fr.ts',
  he: 'he.ts', hi: 'hi.ts', hr: 'hr.ts', hu: 'hu.ts', hy: 'hy.ts', id: 'id.ts',
  it: 'it.ts', ja: 'ja.ts', ko: 'ko.ts', mk: 'mk.ts', mr: 'mr.ts', ms: 'ms.ts',
  nb: 'nb.ts', nl: 'nl.ts', nn: 'nn.ts', pl: 'pl.ts', 'pt-br': 'pt-br.ts',
  ro: 'ro.ts', rw: 'rw.ts', sq: 'sq.ts', sr: 'sr.ts', sv: 'sv.ts', ta: 'ta.ts',
  tr: 'tr.ts', uk: 'uk.ts', vi: 'vi.ts', zh: 'zh.ts', 'zh-tw': 'zh-tw.ts',
};
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

for (const [code, file] of Object.entries(FILES)) {
  let text = readFileSync(file, 'utf8');
  const q = code === 'rw' || code === 'bs' ? '"' : "'";
  const [azure, crimson, steel, bronze, silver] = NAMES[code];
  const rename = (key, val) => {
    const re = new RegExp(`(  '${key}': )${q}[^\\n]*?${q},`);
    if (!re.test(text)) throw new Error(`${file}: ${key} not found`);
    text = text.replace(re, `$1${q}${val}${q},`);
  };
  rename('accent.blue', azure);
  rename('accent.red', crimson);
  rename('accent.silver', silver);
  if (code === 'en') text = text.replace(`'prefs.accent': 'Accent color',`, `'prefs.accent': 'Accent Color',`);
  if (text.includes("'accent.steel'")) { writeFileSync(file, text); console.log(`skip-insert ${file}`); continue; }
  const bump = text.match(/'robots\.bumperDefault': ["']([^"']*)["'],/);
  if (!bump) throw new Error(`${file}: bumperDefault not found`);
  const def = /[\u0400-\u04FF\u0590-\u05FF\u0600-\u06FF\u0900-\u097F\u10A0-\u10FF\u1200-\u137F\u3040-\u30FF\uAC00-\uD7AF\u4E00-\u9FFF]/.test(bump[1]) ? bump[1] : cap(bump[1]);
  const silverLine = new RegExp(`^(  'accent\\.silver': ${q}[^\\n]*\\n)`, 'm');
  if (!silverLine.test(text)) throw new Error(`${file}: silver line not found`);
  text = text.replace(silverLine, `$1  'accent.steel': ${q}${steel}${q},\n  'accent.bronze': ${q}${bronze}${q},\n  'accent.default': ${q}${def}${q},\n`);
  writeFileSync(file, text);
  console.log(`ok ${file} (default=${def})`);
}
