#!/usr/bin/env node
// Obstacle footprint generator CLI.
//   node scripts/field-obstacles/extract-footprints.mjs           extract → validate → write
//   node scripts/field-obstacles/extract-footprints.mjs --check   extract → validate only
//                                                  (also diffs against the committed file)
//   node scripts/field-obstacles/extract-footprints.mjs --list <fieldId>|all
//
// Prerequisite: npm run build -w @pathblender/core (field constants + tag
// layouts are read from the built workspace package).
import { readFileSync, writeFileSync } from 'node:fs';
import { SEASONS, extractSeason, renderDataFile, listGroups, DATA_OUT, configMirrorAxis, configPath, glbPath } from './seasons.mjs';
import { parseGlb } from './extract.mjs';
import * as core from '@pathblender/core';

const args = process.argv.slice(2);

function seasonFor(id) {
  const s = SEASONS.find((x) => x.fieldId === id);
  if (!s) {
    console.error(`unknown fieldId ${id}; configured: ${SEASONS.map((x) => x.fieldId).join(', ')}`);
    process.exit(1);
  }
  return s;
}

function fieldFor(id) {
  const f = core.FIELDS.find((x) => x.id === id);
  if (!f) {
    console.error(`@pathblender/core has no field ${id} — run npm run build -w @pathblender/core`);
    process.exit(1);
  }
  return f;
}

function runList(id) {
  const ids = id === 'all' || !id ? SEASONS.map((s) => s.fieldId) : [seasonFor(id).fieldId];
  for (const fid of ids) {
    const season = seasonFor(fid);
    const field = fieldFor(fid);
    const cfg = JSON.parse(readFileSync(configPath(season.glbDir.welded), 'utf8'));
    const mirror = configMirrorAxis(cfg.rotations);
    console.log(`\n== ${fid} (${season.glbDir.welded}, mirror ${mirror}, field ${field.lengthM}×${field.widthM} m) ==`);
    const seen = new Map();
    const rows = listGroups(season.glbDir.welded, mirror, field.lengthM / 2, field.widthM / 2);
    for (const r of rows) {
      seen.set(r.name, (seen.get(r.name) ?? 0) + 1);
    }
    for (const [name, count] of [...seen.entries()].sort()) {
      const first = rows.find((r) => r.name === name);
      if (!first) continue;
      console.log(
        `${String(count).padStart(4)}x ${JSON.stringify(name)}  meshes ${first.meshNodes}` +
          `  AABB x[${first.aabb.lo[0]},${first.aabb.hi[0]}] y[${first.aabb.lo[1]},${first.aabb.hi[1]}] z[${first.aabb.lo[2]},${first.aabb.hi[2]}]`,
      );
    }
    console.log(`groups total: ${rows.length}`);
  }
}

async function main() {
  if (args[0] === '--list') {
    runList(args[1]);
    return;
  }
  const checkOnly = args.includes('--check');
  const ids = args.filter((a) => !a.startsWith('--'));
  if (ids.length > 0) {
    console.error('regeneration always runs every configured season (no partial selection) — use --list <fieldId> to inspect one season');
    process.exit(1);
  }
  const seasons = SEASONS;

  const results = {};
  for (const season of seasons) {
    fieldFor(season.fieldId); // dist presence check
    console.log(`extracting ${season.fieldId} …`);
    const t0 = Date.now();
    results[season.fieldId] = await extractSeason(season);
    const n = Object.values(results[season.fieldId]).flat().length;
    console.log(`  ok: ${n} obstacles (${Date.now() - t0} ms)`);
  }

  const content = readFileSync(DATA_OUT, 'utf8');
  if (checkOnly) {
    const rendered = renderDataFile(results);
    if (rendered !== content) {
      console.error('--check FAILED: rendered data differs from the committed file (regenerate without --check)');
      process.exit(1);
    }
    console.log('--check passed: extraction reproduces the committed data');
    return;
  }
  writeFileSync(DATA_OUT, renderDataFile(results));
  console.log(`wrote ${DATA_OUT}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
