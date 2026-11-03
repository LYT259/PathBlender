# WPILOG samples

Real `.wpilog` files used by the regression suite. Provenance and license:

- `WPILIB_TBD_aba74b981a582b4b.wpilog` — a real robot-side DataLog written by
  DogLog with NetworkTables data (DriverStation table, `NT:/.schema/*` struct
  schemas, telemetry units). Source: the MIT-licensed
  [wpilog-parser](https://github.com/jonahsnider/wpilog-parser) fixture set
  (`packages/wpilog-parser/tests/fixtures/logs/`, fetched 2026-11-03). Copied
  unmodified. License basis: the npm package and the repo's
  `packages/wpilog-parser/package.json` both declare `MIT`; the repository
  root itself carries no LICENSE file, so the grant rests on the package
  declaration.

The larger real match logs from the same fixture set (FRC DS logs 10–15 MB,
`FRC_*.wpilog`) are intentionally NOT committed; fetch them into a local
directory and point `WPILog_FIXTURE_DIR` there to run the large-log
integration checks (`packages/core/test/wpilog.test.ts` skips them when the
files are absent):

```sh
curl -LO https://raw.githubusercontent.com/jonahsnider/wpilog-parser/main/packages/wpilog-parser/tests/fixtures/logs/FRC_20241110_165657__Q68.wpilog
# …same for FRC_20250727_235138__E14.wpilog and FRC_20251109_211045__E2.wpilog
```

Synthetic boundary logs (truncation, corruption, empty logs, pose resets,
time gaps, multiple auto intervals) are built byte-by-byte inside the test
suite itself — see the writer helper in `packages/core/test/wpilog.test.ts`.
