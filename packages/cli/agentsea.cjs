#!/usr/bin/env node
/**
 * npm `bin` shim — the bundle is produced for the Bun runtime (`bun build`).
 * If `bun` is not globally installed, delegate to the same pinned Bun `npx` uses in `npm run build`.
 */
// Preflight: refuse to run on an unsupported Node version. Older runtimes
// (notably Node 18) appear to work and then fail in confusing ways further
// down the flow. This shim only uses Node to spawn `npx bun run cli.js` — the
// CLI itself runs under Bun — so the runtime floor is the Node 20 LTS baseline
// (20.9.0), NOT the stricter ">=20.19.0" in the root package.json "engines"
// field. That stricter floor exists for the dev/build toolchain (eslint), which
// is irrelevant to end users running the installed CLI.
//
// This runs before any require() — including the `node:`-scheme built-ins
// below, which themselves fail on very old runtimes — so the guard always
// produces a clear message instead of an opaque loader error.
const MIN_NODE = [20, 9];
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < MIN_NODE[0] || (major === MIN_NODE[0] && minor < MIN_NODE[1])) {
  console.error(
    `\nagentsea requires Node >= ${MIN_NODE[0]}.${MIN_NODE[1]} (you have ${process.versions.node}).\n` +
      "Switch to a supported version, e.g.:\n" +
      "  nvm install --lts && nvm use --lts\n",
  );
  process.exit(1);
}

const { spawnSync } = require("node:child_process");
const path = require("node:path");

const cliJs = path.join(__dirname, "cli.js");
const args = ["--yes", "bun@1.3.9", "run", cliJs, ...process.argv.slice(2)];

const r = spawnSync("npx", args, { stdio: "inherit", shell: process.platform === "win32" });
process.exit(r.status === null ? 1 : r.status);
