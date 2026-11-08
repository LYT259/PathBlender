/** Generate the Homebrew Cask body for the self-maintained
 * LYT259/homebrew-tap repository (Casks/pathblender.rb).
 *
 * Usage: node scripts/gen-homebrew-cask.mjs <version> <sha256>
 *
 * Prints the cask to stdout from the validated inputs — writes no files,
 * runs no git, contacts no network. The sha256 is the digest of the
 * published PathBlender_<version>_universal.dmg (compute it against the
 * real release asset with `shasum -a 256`). Creating, pushing or
 * publishing the tap repository itself is a separate user-authorized
 * step — see docs/releasing.md ("Homebrew cask 发布" / Homebrew cask
 * publication).
 */
const [version, sha256] = process.argv.slice(2);
if (process.argv.length !== 4) {
  console.error('usage: gen-homebrew-cask.mjs <version> <sha256>');
  process.exit(1);
}
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error(`invalid version (expected semver like 0.1.10): ${version}`);
  process.exit(1);
}
if (!/^[0-9a-f]{64}$/.test(sha256)) {
  console.error(`invalid sha256 (expected 64 lowercase hex chars): ${sha256}`);
  process.exit(1);
}
console.log(`cask "pathblender" do
  version "${version}"
  sha256 "${sha256}"

  url "https://github.com/LYT259/pathblender/releases/download/v#{version}/PathBlender_#{version}_universal.dmg",
      verified: "github.com/LYT259/pathblender/"
  name "PathBlender"
  desc "Free, open-source FRC autonomous path viewer"
  homepage "https://github.com/LYT259/pathblender"

  depends_on macos: ">= :ventura"

  app "PathBlender.app"
end
`);
