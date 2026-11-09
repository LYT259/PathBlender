# HOOT samples

Real CTRE Hoot material used by the local-only acceptance in
`packages/core/test/hoot-samples.test.ts`. Provenance and status:

- `sim_2025-02-27_16-16-47.hoot.wpilog` (98 MB) — a **real owlet-style
  conversion product** (`.hoot` → `.hoot.wpilog`, the same artifact shape the
  desktop import produces before entering the WPILOG pipeline). Source:
  Chief Delphi thread
  [Hoot Log For SysId Is Missing Data](https://www.chiefdelphi.com/t/hoot-log-for-sysid-is-missing-data/493424),
  attachment `sim_2025-02-27_16-16-47.hoot.zip` posted publicly by user
  `pgutkovi` for debugging (fetched 2026-11-09). A Phoenix 6 signal-logger
  simulation run; entries are `Phoenix6/TalonFX-0/...` signals in a WPILOG
  v0.1 container.
  - zip SHA256 `17d1319e1b8a42feaef0b441255bdf953248b927ed29b02cd3fc4938e63bd36b`
  - inner `.hoot.wpilog` SHA256 `b830e32bb1f7a516d5303046d731e4aa6184656b359877b8b362d76462073bcf`

Chief Delphi attachments carry no explicit license, so the file is **not
committed**. Fetch it locally to run the gated suite (tests skip when it is
absent):

```sh
curl -LO https://www.chiefdelphi.com/uploads/short-url/6OoR8IOIt3tuAaEzMAY2pBG4AHR.zip
unzip 6OoR8IOIt3tuAaEzMAY2pBG4AHR.zip   # → sim_2025-02-27_16-16-47.hoot.wpilog
HOOT_SAMPLE_DIR="$PWD" npx vitest run test/hoot-samples.test.ts -w packages/core
```

Verified with this sample (2026-11-09): the production WPILOG pipeline
parses a real CTRE-converted log end to end — 102,933,199 bytes, 1835
catalog entries, no corrupt-timestamp warnings, ~1.2 s (0 pose candidates
and 0 auto intervals, as expected for a SysId simulation log with no pose
data — reported, not asserted away).

Still NOT verified (honest boundary, unchanged by this sample):

- **A raw `.hoot` file** — this attachment is the *converted product*, not
  the container. The header probe facts in `packages/core/src/parsers/hoot.ts`
  (compliancy byte at offset 70, minimum 6) remain verified against CTRE
  sources only, not against a real file.
- **owlet download/conversion itself** — EULA-gated; not executed here.
- Gatekeeper behavior for the downloaded converter; compliancy endianness.
