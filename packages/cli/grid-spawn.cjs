#!/usr/bin/env node
/**
 * npm `bin` shim — the bundle is produced for the Bun runtime (`bun build`).
 * If `bun` is not globally installed, delegate to the same pinned Bun `npx` uses in `npm run build`.
 */
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const cliJs = path.join(__dirname, "cli.js");
const args = ["--yes", "bun@1.3.9", "run", cliJs, ...process.argv.slice(2)];

const r = spawnSync("npx", args, { stdio: "inherit", shell: process.platform === "win32" });
process.exit(r.status === null ? 1 : r.status);
