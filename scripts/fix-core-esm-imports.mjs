// Rewrites extensionless relative import/export specifiers in the compiled
// core dist so the published ESM package loads under real Node resolution
// (repo source uses bundler-style extensionless imports; tsc preserves them).
// Directory imports (`./parsers` -> parsers/index.js) are resolved against the
// actual dist layout; a specifier that cannot be resolved fails the build.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SPECIFIER_WITH_EXTENSION = /\.(js|mjs|cjs|json|css|wasm)$/;

export function makeFsResolver(baseDir) {
  return (specifier) => {
    if (!specifier.startsWith('.') || SPECIFIER_WITH_EXTENSION.test(specifier)) return null;
    const asFile = `${specifier}.js`;
    const asIndex = `${specifier}/index.js`;
    if (existsSync(join(baseDir, asFile))) return asFile;
    if (existsSync(join(baseDir, asIndex))) return asIndex;
    throw new Error(`fix-core-esm-imports: cannot resolve relative specifier '${specifier}' under ${baseDir}`);
  };
}

export function fixEsmImports(code, resolveSpecifier) {
  if (!resolveSpecifier) throw new Error('fixEsmImports requires a resolver');
  const resolved = [];
  const rewrite = (match, head, quote, specifier, tail) => {
    const fixed = resolveSpecifier(specifier);
    if (fixed === null) return match;
    resolved.push(`${specifier} -> ${fixed}`);
    return `${head}${quote}${fixed}${quote}${tail}`;
  };
  const next = code
    .replace(/(from\s+)(['"])(\.\.?\/[^'"]+)\2(\s*;?)/g, (m, h, q, s, t) => rewrite(m, h, q, s, t))
    .replace(/(import\s*\(\s*)(['"])(\.\.?\/[^'"]+)\2(\s*\))/g, (m, h, q, s, t) => rewrite(m, h, q, s, t));
  return { code: next, changed: resolved.length, resolved };
}

function listJsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listJsFiles(full));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

export function fixDirectory(distDir) {
  const files = listJsFiles(distDir);
  const results = [];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const { code, changed } = fixEsmImports(source, makeFsResolver(join(file, '..')));
    if (changed > 0) writeFileSync(file, code);
    results.push({ file, changed });
  }
  return results;
}

const target = process.argv[2];
if (target) {
  const results = fixDirectory(target);
  const total = results.reduce((sum, r) => sum + r.changed, 0);
  console.log(`fix-core-esm-imports: ${total} specifier(s) fixed across ${results.length} file(s)`);
  if (total === 0) console.log('fix-core-esm-imports: nothing to fix (already explicit)');
}
