#!/usr/bin/env node
/**
 * npm `bin` shim — the bundle is produced for the Bun runtime (`bun build`).
 * If `bun` is not globally installed, delegate to the same pinned Bun `npx` uses in `npm run build`.
 */
// Preflight: refuse to run on an unsupported Node version. Older runtimes
// (notably Node 18) appear to work and then fail in confusing ways further
// down the flow (e.g. the Hermes dashboard build). Keep this in sync with the
// "engines.node" range in the root package.json (>=20.19.0, which is also the
// floor the dependency tree requires).
//
// This runs before any require() — including the `node:`-scheme built-ins
// below, which themselves fail on very old runtimes — so the guard always
// produces a clear message instead of an opaque loader error.
const MIN_NODE = [20, 19];
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < MIN_NODE[0] || (major === MIN_NODE[0] && minor < MIN_NODE[1])) {
  console.error(
    `\nagentsea requires Node >= ${MIN_NODE[0]}.${MIN_NODE[1]} (you have ${process.versions.node}).\n` +
      "Switch to a supported version, e.g.:\n" +
      "  nvm use            # uses the pinned version in .nvmrc\n" +
      "  nvm install 20.19.0 && nvm use 20.19.0\n",
  );
  process.exit(1);
}

const { spawnSync } = require("node:child_process");
const path = require("node:path");

const cliJs = path.join(__dirname, "cli.js");
const args = ["--yes", "bun@1.3.9", "run", cliJs, ...process.argv.slice(2)];

const r = spawnSync("npx", args, { stdio: "inherit", shell: process.platform === "win32" });
process.exit(r.status === null ? 1 : r.status);
