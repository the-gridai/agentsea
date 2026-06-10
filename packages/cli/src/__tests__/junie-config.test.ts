import { describe, expect, it } from "bun:test";
import {
  JUNIE_GRID_CUSTOM_MODEL,
  JUNIE_GRID_PROFILE_ID,
  JUNIE_GRID_UPSTREAM_BASE,
  JUNIE_LAUNCH_SHELL_PREFIX,
  JUNIE_GRID_CHAT_URL,
  JUNIE_GRID_CHAT_PROXY_PORT,
  buildJunieGridConfig,
  buildJunieGridModelProfile,
  resolveJunieGridModelId,
} from "../shared/junie-config.js";

describe("junie-config", () => {
  it("defaults model id to code-prime", () => {
    expect(resolveJunieGridModelId()).toBe("code-prime");
    expect(resolveJunieGridModelId("")).toBe("code-prime");
    expect(resolveJunieGridModelId("bad id!")).toBe("code-prime");
  });

  it("accepts validated catalogue model ids", () => {
    expect(resolveJunieGridModelId("openai/gpt-5")).toBe("openai/gpt-5");
  });

  it("routes Junie custom profile through local grid-chat-proxy", () => {
    const profile = buildJunieGridModelProfile("test-key", "code-prime");
    expect(profile.baseUrl).toBe(JUNIE_GRID_CHAT_URL);
    expect(profile.baseUrl).toBe(`http://127.0.0.1:${JUNIE_GRID_CHAT_PROXY_PORT}/v1/chat/completions`);
    expect(profile.id).toBe("code-prime");
    expect(profile.apiType).toBe("OpenAICompletion");
    expect(profile.apiKey).toBe("test-key");
    expect(profile.fasterModel).toEqual({ id: "code-prime" });
  });

  it("upstream base targets production Grid inference API", () => {
    expect(JUNIE_GRID_UPSTREAM_BASE).toBe("https://api.thegrid.ai/v1");
  });

  it("points config.json at the custom profile id", () => {
    expect(buildJunieGridConfig()).toEqual({ model: JUNIE_GRID_CUSTOM_MODEL });
    expect(JUNIE_GRID_PROFILE_ID).toBe("thegrid");
  });

  it("exports launch shell prefix with JUNIE_MODEL for BYOK skip", () => {
    expect(JUNIE_LAUNCH_SHELL_PREFIX.includes("source ~/.agentsearc")).toBe(true);
    expect(JUNIE_LAUNCH_SHELL_PREFIX.includes(`JUNIE_MODEL=${JUNIE_GRID_CUSTOM_MODEL}`)).toBe(true);
  });
});
