import { describe, expect, it } from "bun:test";
import { validateGridConsumptionApiKeyFormat } from "../shared/oauth.js";

const VALID_KEY = `sk-or-v1-${"a".repeat(64)}`;

describe("validateGridConsumptionApiKeyFormat", () => {
  it("accepts a well-formed consumption key", () => {
    expect(validateGridConsumptionApiKeyFormat(VALID_KEY)).toEqual({ valid: true });
  });

  it("accepts keys with 32+ hex characters after sk-or-v1-", () => {
    const key = `sk-or-v1-${"b".repeat(32)}`;
    expect(validateGridConsumptionApiKeyFormat(key)).toEqual({ valid: true });
  });

  it("rejects empty and whitespace-only input", () => {
    expect(validateGridConsumptionApiKeyFormat("")).toMatchObject({ valid: false });
    expect(validateGridConsumptionApiKeyFormat("   ")).toMatchObject({ valid: false });
  });

  it("rejects keys with internal or surrounding whitespace", () => {
    const result = validateGridConsumptionApiKeyFormat(` ${VALID_KEY}`);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.message).toContain("whitespace");
    }
  });

  it("rejects obvious placeholders", () => {
    for (const placeholder of ["test", "changeme", "sk-or-v1-xxxxx", "your-api-key-here"]) {
      const result = validateGridConsumptionApiKeyFormat(placeholder);
      expect(result.valid).toBe(false);
    }
  });

  it("rejects keys that are too short", () => {
    const result = validateGridConsumptionApiKeyFormat("sk-or-v1-abcd");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.message).toContain("Invalid format");
    }
  });

  it("accepts base64 consumption keys from app.thegrid.ai", () => {
    const base64Key = "WoqALXMfSU2l2yf+Z3W6MMa5XmQCpYQfZvXkD4gbv1c";
    expect(validateGridConsumptionApiKeyFormat(base64Key)).toEqual({ valid: true });
  });

  it("accepts base64 keys with + and / in the body", () => {
    const key = "AXqjS4Yy6wTly+jw4G/dzZc7OCg36uzmJ8fDXczZfZg";
    expect(validateGridConsumptionApiKeyFormat(key)).toEqual({ valid: true });
  });

  it("rejects other sk- prefixes (OpenAI, Anthropic, etc.)", () => {
    const result = validateGridConsumptionApiKeyFormat("sk-ant-api03-abcdefghijklmnopqrstuvwxyz");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.message).toContain("app.thegrid.ai");
    }
  });

  it("rejects non-hex characters in the sk-or-v1 suffix", () => {
    const result = validateGridConsumptionApiKeyFormat(`sk-or-v1-${"g".repeat(64)}`);
    expect(result.valid).toBe(false);
  });
});
