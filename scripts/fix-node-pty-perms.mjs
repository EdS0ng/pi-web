import { chmodSync, existsSync, statSync } from 'node:fs';

// node-pty ships a prebuilt `spawn-helper` binary that it posix_spawn()s to set
// up the PTY. On macOS, npm strips the executable bit from this file on install
// (a known node-pty/npm issue), so pty.spawn() then fails with
// "posix_spawnp failed". Restore the bit after every install.
if (process.platform !== 'darwin') {
  process.exit(0);
}

const helpers = [
  'node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper',
  'node_modules/node-pty/prebuilds/darwin-x64/spawn-helper',
];

for (const helper of helpers) {
  if (!existsSync(helper)) continue;
  try {
    const mode = statSync(helper).mode;
    // Add u+x,g+x,o+x (0o111) so posix_spawn can execute it.
    chmodSync(helper, mode | 0o111);
    console.log(`Restored executable bit: ${helper}`);
  } catch (error) {
    console.warn(`Could not chmod ${helper}: ${error.message}`);
  }
}
