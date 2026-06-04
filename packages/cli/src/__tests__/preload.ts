/**
 * Test preload script — filesystem isolation for CLI tests.
 *
 * Loaded before every test file via bunfig.toml `preload`.
 * Redirects HOME and XDG dirs to a temp directory so no test
 * can accidentally write to the real user's home directory.
 */

import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import os, { tmpdir } from "node:os";
import { join } from "node:path";
import { tryCatch } from "@agentsea/sdk";

const REAL_HOME = process.env.HOME ?? "";

function cleanupStrayTestFiles(): void {
  if (!REAL_HOME) {
    return;
  }
  tryCatch(() => {
    for (const f of readdirSync(REAL_HOME)) {
      if (f.startsWith("subprocess-test-") && f.endsWith(".txt")) {
        rmSync(join(REAL_HOME, f), {
          force: true,
        });
      }
    }
  });
}

cleanupStrayTestFiles();

const TEST_HOME = mkdtempSync(join(tmpdir(), "agentsea-test-home-"));

process.env.HOME = TEST_HOME;
process.env.XDG_CACHE_HOME = join(TEST_HOME, ".cache");
process.env.XDG_CONFIG_HOME = join(TEST_HOME, ".config");
process.env.XDG_DATA_HOME = join(TEST_HOME, ".local", "share");

os.homedir = () => TEST_HOME;

process.env.AGENTSEA_HOME = join(TEST_HOME, ".agentsea");

/** Sandbox repo root — no manifest.json unless a test writes one */
const SANDBOX_GRID_ROOT = join(TEST_HOME, "agentsea-root");
mkdirSync(SANDBOX_GRID_ROOT, {
  recursive: true,
});
process.env.AGENTSEA_ROOT = SANDBOX_GRID_ROOT;
delete process.env.AGENTSEA_MANIFEST;

process.env.THEGRID_API_KEY ??= "test-thegrid-api-key";

/** cwd isolation — prevents resolveBundledShRepoRoot from finding the real repo via walk-up */
process.chdir(SANDBOX_GRID_ROOT);

mkdirSync(join(TEST_HOME, ".agentsea"), {
  recursive: true,
});
mkdirSync(join(TEST_HOME, ".cache"), {
  recursive: true,
});
mkdirSync(join(TEST_HOME, ".config"), {
  recursive: true,
});
mkdirSync(join(TEST_HOME, ".config", "agentsea"), {
  recursive: true,
});
mkdirSync(join(TEST_HOME, ".claude"), {
  recursive: true,
});
mkdirSync(join(TEST_HOME, ".ssh"), {
  recursive: true,
});
mkdirSync(join(TEST_HOME, ".local", "share"), {
  recursive: true,
});

process.on("exit", () => {
  tryCatch(() =>
    rmSync(TEST_HOME, {
      recursive: true,
      force: true,
    }),
  );
  cleanupStrayTestFiles();
});
