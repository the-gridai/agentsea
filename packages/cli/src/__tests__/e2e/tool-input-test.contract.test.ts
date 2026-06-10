import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  TOOL_E2E_FILE,
  TOOL_E2E_MARKER,
  assertToolE2eFileCmd,
  toolE2ePrompt,
} from "../../shared/headless-prompts.js";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..", "..");
const VERIFY_SH = join(REPO_ROOT, "sh", "e2e", "lib", "verify.sh");
const COMMON_LOCAL_SH = join(REPO_ROOT, "sh", "e2e", "local", "lib", "common-local.sh");

describe("tool input E2E contract", () => {
  it("exports tool file constants aligned with verify.sh", () => {
    const verifySh = readFileSync(VERIFY_SH, "utf-8");
    expect(verifySh).toContain(`TOOL_INPUT_TEST_FILE="${TOOL_E2E_FILE}"`);
    expect(verifySh).toContain(`TOOL_INPUT_TEST_MARKER="${TOOL_E2E_MARKER}"`);
    expect(toolE2ePrompt()).toContain(TOOL_E2E_FILE);
    expect(toolE2ePrompt()).toContain(TOOL_E2E_MARKER);
    expect(assertToolE2eFileCmd()).toContain(TOOL_E2E_FILE);
    expect(assertToolE2eFileCmd()).toContain(TOOL_E2E_MARKER);
  });

  it("locks local E2E prompt to the same tool file path", () => {
    const commonLocal = readFileSync(COMMON_LOCAL_SH, "utf-8");
    expect(commonLocal).toContain(`TOOL_INPUT_TEST_FILE="${TOOL_E2E_FILE}"`);
    expect(commonLocal).toContain(`TOOL_INPUT_TEST_MARKER="${TOOL_E2E_MARKER}"`);
  });

  it("defaults input tests to tool mode unless USE_CHAT_INPUT_TEST=1", () => {
    const verifySh = readFileSync(VERIFY_SH, "utf-8");
    expect(verifySh).toContain('USE_CHAT_INPUT_TEST:-0}" = "1"');
    expect(verifySh).toContain("_assert_tool_file_remotely");
    expect(verifySh).toContain("input_test_hermes() {");
    expect(verifySh).not.toMatch(/input_test_hermes\(\)\s*\{\s*log_warn.*skipping/s);
  });

  it("covers tool input tests for all enabled E2E agents", () => {
    const verifySh = readFileSync(VERIFY_SH, "utf-8");
    const enabled = ["claude", "openclaw", "opencode", "kilocode", "hermes"] as const;
    for (const slug of enabled) {
      expect(verifySh).toContain(`input_test_${slug}()`);
      expect(verifySh).toContain("_assert_tool_file_remotely");
      expect(verifySh).not.toMatch(new RegExp(`input_test_${slug}\\(\\)\\s*\\{\\s*log_warn.*skipping`, "s"));
    }
  });

  it("enabled agent headless commands use doc-recommended tool permissions", () => {
    const verifySh = readFileSync(VERIFY_SH, "utf-8");
    expect(verifySh).toContain("--dangerously-skip-permissions");
    expect(verifySh).toContain("hermes -z");
    expect(verifySh).toContain("--yolo");
    expect(verifySh).toContain("--agent main --session-key agentsea-e2e");
    expect(verifySh).toContain("--model thegrid/");
  });

  it("cursor input test requires real file write via --print headless flags", () => {
    const verifySh = readFileSync(VERIFY_SH, "utf-8");
    expect(verifySh).toContain("input_test_cursor()");
    expect(verifySh).toContain("--print --trust --force --sandbox disabled");
    expect(verifySh).toContain("_assert_tool_file_remotely");
    expect(verifySh).not.toMatch(/input_test_cursor\(\)\s*\{\s*log_warn.*skipping/s);
  });
});
