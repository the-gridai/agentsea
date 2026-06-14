// Interactive verification for the Grid API key prompt's hidden-input reader.
//
// This exercises the REAL `readHiddenLine` from src/shared/oauth.ts (the same code
// the CLI uses) so testers on macOS can confirm the paste hang is gone without
// running a full provision.
//
//   Run:   npm run verify:key-prompt   (from packages/cli)
//   or:    bun run scripts/verify-key-prompt.ts
//
// What to check on the affected machine (e.g. macOS Terminal / iTerm):
//   1. PASTE a consumption key, press Enter  -> it reports the captured length and
//      that the format is valid. Input must NOT be echoed while pasting.
//   2. Re-run and press Ctrl-C               -> the process aborts immediately
//      (exit code 130). It must never hang.
//   3. Re-run and wait                       -> after the timeout it prints guidance
//      and exits rather than hanging. (Set AGENTSEA_KEY_PROMPT_TIMEOUT_MS=3000 to
//      make this quick.)

import { readHiddenLine, validateGridConsumptionApiKeyFormat } from "../src/shared/oauth.js";

process.stderr.write("Paste your consumption key and press Enter (input is hidden), or press Ctrl-C to abort.\n");
process.stderr.write("Grid API key: ");

const line = await readHiddenLine();

if (line === null) {
  process.stderr.write("No input captured (timeout). The prompt exited cleanly instead of hanging — PASS.\n");
  process.exit(0);
}

const trimmed = line.trim();
const format = validateGridConsumptionApiKeyFormat(trimmed);
process.stderr.write(`Captured ${trimmed.length} characters.\n`);
process.stderr.write(
  format.valid
    ? "Format valid — paste was received correctly. PASS.\n"
    : `Format check: ${format.message}\n(If you pasted a real key and see escape characters in the length, report it.)\n`,
);
process.exit(0);
