import { readFileSync, writeFileSync } from 'node:fs';

// Display names per locale: [azure, crimson, steel blue, bronze, silver gray]
const NAMES = {
  en: ['Azure', 'Crimson', 'Steel Blue', 'Bronze', 'Silver Gray'],
  ar: ['أزرق سماوي', 'قرمزي', 'أزرق فولاذي', 'برونزي', 'رمادي فضي'],
  az: ['Səma mavisi', 'Al qırmızısı', 'Polad mavisi', 'Bürünc', 'Gümüşü boz'],
  bg: ['Небесносиньо', 'Алено', 'Стоманеносиньо', 'Бронзово', 'Сребристосиво'],
  bs: ['Nebesko plava', 'Grimizna', 'Čelično plava', 'Brončana', 'Srebrno siva'],
  cs: ['Azurová', 'Karmínová', 'Ocelová modř', 'Bronzová', 'Stříbrošedá'],
  da: ['Azurblå', 'Karmoisinrød', 'Stålblå', 'Bronce', 'Sølvgrå'],
  de: ['Azurblau', 'Karmesin', 'Stahlblau', 'Bronze', 'Silbergrau'],
  el: ['Αζούρ', 'Βυσσινί', 'Μπλε ατσάλι', 'Μπρονζέ', 'Ασημί γκρι'],
  es: ['Azul celeste', 'Carmesí', 'Azul acero', 'Bronce', 'Gris plata'],
  fil: ['Asul na langit', 'Karmesi', 'Asul na bakal', 'Bronse', 'Pilak na abo'],
  fr: ['Bleu azur', 'Cramoisi', 'Bleu acier', 'Bronze', 'Gris argent'],
  he: ['תכלת', 'ארגמן', 'כחול פלדה', 'ארד', 'אפור כסף'],
  hi: ['आसमानी', 'क्रिमसन', 'स्टील ब्लू', 'कांस्य', 'रुपहला स्लेटी'],
  hr: ['Nebesko plava', 'Grimizna', 'Čelično plava', 'Brončana', 'Srebrno siva'],
  hu: ['Azúrkék', 'Karmazsin', 'Acélkék', 'Bronz', 'Ezüstszürke'],
  hy: ['Ազուր', 'Մուգ կարմիր', 'Պողպատե կապույտ', 'Բրոնզ', 'Արծաթամոխրագույն'],
  id: ['Biru langit', 'Krimson', 'Biru baja', 'Perunggu', 'Abu keperakan'],
  it: ['Azzurro', 'Cremisi', 'Blu acciaio', 'Bronzo', 'Grigio argento'],
  ja: ['アズール', 'クリムゾン', 'スチールブルー', 'ブロンズ', 'シルバーグレー'],
  ko: ['하늘색', '진홍', '스틸 블루', '브론즈', '실버 그레이'],
  mk: ['Небесно сина', 'Гримизна', 'Челична сина', 'Бронзена', 'Сребрено сива'],
  mr: ['आसमनी', 'किरमिजी', 'स्टील ब्लू', 'ब्राँझ', 'सिल्व्हर ग्रे'],
  ms: ['Biru langit', 'Krimson', 'Biru keluli', 'Gangsa', 'Kelabu perak'],
  nb: ['Asurblå', 'Karminrød', 'Stålblå', 'Bronse', 'Sølvgrå'],
  nl: ['Azuurblauw', 'Karmozijn', 'Staalblauw', 'Brons', 'Zilvergrijs'],
  nn: ['Asurblå', 'Karminraud', 'Stålblå', 'Bronse', 'Sølvgrå'],
  pl: ['Azurowy', 'Karmazynowy', 'Stalowy błękit', 'Brąz', 'Srebrnoszary'],
  'pt-br': ['Azul-celeste', 'Carmim', 'Azul-aço', 'Bronze', 'Cinza-prateado'],
  ro: ['Azuriu', 'Stacojiu', 'Albastru oțel', 'Bronz', 'Gri argintiu'],
  rw: ['Bururu', 'Umutuku', 'Bururu bw’icyuma', 'Buronze', 'Ifeza'],
  sq: ['Blu i qiellit', 'Karmezin', 'Blu çeliku', 'Bronzi', 'Gri argjendi'],
  sr: ['Nebesko plava', 'Grimizna', 'Čelično plava', 'Bronzana', 'Srebrno siva'],
  sv: ['Azurblå', 'Karmosinröd', 'Stålblå', 'Brons', 'Silvergrå'],
  ta: ['வான் நீலம்', 'கருஞ்சிவப்பு', 'எஃகு நீலம்', 'வெங்கலம்', 'வெள்ளி சாம்பல்'],
  tr: ['Gök mavisi', 'Kızıl', 'Çelik mavisi', 'Bronz', 'Gümüş gri'],
  uk: ['Лазуровий', 'Багряний', 'Сталевий синій', 'Бронзовий', 'Сріблясто-сірий'],
  vi: ['Xanh da trời', 'Đỏ thẫm', 'Xanh thép', 'Đồng', 'Xám bạc'],
  zh: ['蔚蓝', '绛红', '钢蓝', '古铜', '银灰'],
  'zh-tw': ['蔚藍', '絳紅', '鋼藍', '古銅', '銀灰'],
};

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
  const q = code === 'rw' ? '"' : "'";
  const [azure, crimson, steel, bronze, silver] = NAMES[code];
  // 1) Rename the three existing display names (ids untouched).
  const rename = (key, val) => {
    const re = new RegExp(`(  '${key}': )${q}[^${q === '"' ? '"' : '\''}]*${q},`);
    if (!re.test(text)) throw new Error(`${file}: ${key} not found`);
    text = text.replace(re, `$1${q}${val}${q},`);
  };
  rename('accent.blue', azure);
  rename('accent.red', crimson);
  rename('accent.silver', silver);
  // 2) The settings title: en moves to title case (user spec); other locales
  //    already carry their own "accent color" wording.
  if (code === 'en') {
    text = text.replace(`'prefs.accent': 'Accent color',`, `'prefs.accent': 'Accent Color',`);
  }
  // 3) Insert steel/bronze/default after the silver row; "Default" reuses each
  //    locale's own robots.bumperDefault wording (capitalized).
  const bump = text.match(/'robots\.bumperDefault': '([^']*)',/) || text.match(/"robots\.bumperDefault": "([^"]*)",/);
  const rwBump = text.match(/"robots\.bumperDefault": "([^"]*)",/);
  const defRaw = code === 'rw' ? rwBump?.[1] : bump?.[1];
  if (!defRaw) throw new Error(`${file}: bumperDefault not found`);
  const def = /[\u0400-\u04FF\u0590-\u05FF\u0600-\u06FF\u0900-\u097F\u10A0-\u10FF\u1200-\u137F\u3040-\u30FF\uAC00-\uD7AF\u4E00-\u9FFF]/.test(defRaw) ? defRaw : cap(defRaw);
  if (text.includes("'accent.steel'")) throw new Error(`${file}: steel already present`);
  const silverLine = new RegExp(`^(  'accent\\.silver': ${q}[^\\n]*\\n)`, 'm');
  if (!silverLine.test(text)) throw new Error(`${file}: silver line not found`);
  text = text.replace(silverLine, `$1  'accent.steel': ${q}${steel}${q},\n  'accent.bronze': ${q}${bronze}${q},\n  'accent.default': ${q}${def}${q},\n`);
  writeFileSync(file, text);
  console.log(`ok ${file} (default=${def})`);
}
