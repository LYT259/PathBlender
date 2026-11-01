import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
// @ts-expect-error TS7016 - untyped build script; behavior is covered by the runtime tests below
import { fixEsmImports, makeFsResolver } from '../../../scripts/fix-core-esm-imports.mjs';

const resolver = (specifier: string): string | null => {
  if (!specifier.startsWith('.') || specifier.endsWith('.js')) return null;
  if (specifier === './parsers') return './parsers/index.js';
  return `${specifier}.js`;
};

describe('core npm ESM import fixer', () => {
  it('appends .js to extensionless relative specifiers and counts the changes', () => {
    const { code, changed } = fixEsmImports("export { a } from './types';\nimport { b } from './parsers/traj';\n", resolver);
    expect(code).toContain("from './types.js'");
    expect(code).toContain("from './parsers/traj.js'");
    expect(changed).toBe(2);
  });

  it('resolves directory imports to their index.js', () => {
    const { code, changed } = fixEsmImports("export { parse } from './parsers';\n", resolver);
    expect(code).toContain("from './parsers/index.js'");
    expect(changed).toBe(1);
  });

  it('fixes parent-relative and dynamic import specifiers', () => {
    const { code, changed } = fixEsmImports("import { x } from '../util/units';\nconst m = await import('./lazy');\n", resolver);
    expect(code).toContain("from '../util/units.js'");
    expect(code).toContain("import('./lazy.js')");
    expect(changed).toBe(2);
  });

  it('leaves explicit extensions and package specifiers untouched', () => {
    const source = "import { y } from './types.js';\nimport { z } from 'some-package';\nimport 'side-effect';\n";
    const { code, changed } = fixEsmImports(source, resolver);
    expect(code).toBe(source);
    expect(changed).toBe(0);
  });

  it('propagates resolver errors so unresolved specifiers fail the build', () => {
    const throwing = (): never => {
      throw new Error('cannot resolve');
    };
    expect(() => fixEsmImports("import { a } from './missing';\n", throwing)).toThrow(/cannot resolve/);
  });

  it('fs resolver keeps the ./ prefix for directory imports', async () => {
    const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const base = mkdtempSync(join(tmpdir(), 'pb-esm-fix-'));
    mkdirSync(join(base, 'parsers'));
    writeFileSync(join(base, 'parsers', 'index.js'), '');
    writeFileSync(join(base, 'types.js'), '');
    const fsResolver = makeFsResolver(base);
    expect(fsResolver('./parsers')).toBe('./parsers/index.js');
    expect(fsResolver('./types')).toBe('./types.js');
    expect(fsResolver('./types.js')).toBeNull();
    expect(fsResolver('pkg')).toBeNull();
    expect(() => fsResolver('./missing')).toThrow(/cannot resolve/);
  });

  it('is wired into the core build so published dist always carries explicit extensions', () => {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf8'));
    expect(pkg.scripts.build).toContain('tsc -p tsconfig.build.json');
    expect(pkg.scripts.build).toContain('fix-core-esm-imports.mjs');
  });
});
