import { afterEach, describe, expect, it } from "bun:test";
import {
  AGENTSEA_GRID_OAUTH_BASE_URL_ENV,
  DEFAULT_GRID_INFERENCE_API_BASE,
  THEGRID_API_URL_ENV,
  gridInferenceChatCompletionsUrl,
  gridInferenceModelsUrl,
  gridInferenceOverrideEnvLine,
  normalizeGridInferenceApiBase,
  resolveCortexExchangeApiOrigin,
  resolveGridAnthropicMessagesClientBase,
  resolveGridExchangeApiOrigin,
  resolveGridInferenceApiBase,
  resolveGridOpenClawMessagesBase,
  resolveGridWebAppOrigin,
} from "../shared/grid-api.js";

describe("grid-api", () => {
  afterEach(() => {
    delete process.env[THEGRID_API_URL_ENV];
    delete process.env[AGENTSEA_GRID_OAUTH_BASE_URL_ENV];
  });

  it("defaults to production when THEGRID_API_URL is unset", () => {
    expect(resolveGridInferenceApiBase()).toBe(DEFAULT_GRID_INFERENCE_API_BASE);
    expect(gridInferenceModelsUrl()).toBe(`${DEFAULT_GRID_INFERENCE_API_BASE}/models`);
    expect(gridInferenceChatCompletionsUrl()).toBe(`${DEFAULT_GRID_INFERENCE_API_BASE}/chat/completions`);
    expect(gridInferenceOverrideEnvLine()).toBeUndefined();
  });

  it("uses THEGRID_API_URL override and trims trailing slashes", () => {
    process.env[THEGRID_API_URL_ENV] = "https://dev.example.com/v1/";
    expect(resolveGridInferenceApiBase()).toBe("https://dev.example.com/v1");
    expect(gridInferenceModelsUrl()).toBe("https://dev.example.com/v1/models");
    expect(gridInferenceOverrideEnvLine()).toBe("THEGRID_API_URL=https://dev.example.com/v1");
  });

  it("normalizeGridInferenceApiBase trims whitespace and slashes", () => {
    expect(normalizeGridInferenceApiBase("  https://x.test/v1///  ")).toBe("https://x.test/v1");
  });

  it("maps dev consumption API to dev app and cortex origins", () => {
    process.env[THEGRID_API_URL_ENV] = "https://api.dev.thegrid.ai/v1";
    expect(resolveGridWebAppOrigin()).toBe("https://app.dev.thegrid.ai");
    expect(resolveCortexExchangeApiOrigin()).toBe("https://cortex.dev.thegrid.ai");
    expect(resolveGridExchangeApiOrigin()).toBe("https://cortex.dev.thegrid.ai");
    expect(resolveGridAnthropicMessagesClientBase()).toBe("https://messages-beta.api.dev.thegrid.ai");
    expect(resolveGridOpenClawMessagesBase()).toBe("https://messages-beta.api.dev.thegrid.ai/v1");
  });

  it("defaults OAuth/exchange origin to cortex production", () => {
    expect(resolveGridExchangeApiOrigin()).toBe("https://cortex.thegrid.ai");
  });

  it("uses explicit AGENTSEA_GRID_OAUTH_BASE_URL override", () => {
    process.env[AGENTSEA_GRID_OAUTH_BASE_URL_ENV] = "https://example.test///";
    expect(resolveGridExchangeApiOrigin()).toBe("https://example.test");
  });
});
