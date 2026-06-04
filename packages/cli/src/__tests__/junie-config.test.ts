import { describe, expect, it } from "bun:test";
import {
  JUNIE_GRID_CUSTOM_MODEL,
  JUNIE_GRID_PROFILE_ID,
  JUNIE_GRID_UPSTREAM_BASE,
  JUNIE_LAUNCH_SHELL_PREFIX,
  JUNIE_LITELLM_CHAT_URL,
  JUNIE_LITELLM_PORT,
  buildJunieGridConfig,
  buildJunieGridModelProfile,
  buildJunieLiteLlmYaml,
  resolveJunieGridModelId,
} from "../shared/junie-config.js";

describe("junie-config", () => {
  it("defaults model id to agent-standard", () => {
    expect(resolveJunieGridModelId()).toBe("agent-standard");
    expect(resolveJunieGridModelId("")).toBe("agent-standard");
    expect(resolveJunieGridModelId("bad id!")).toBe("agent-standard");
  });

  it("accepts validated catalogue model ids", () => {
    expect(resolveJunieGridModelId("openai/gpt-5")).toBe("openai/gpt-5");
  });

  it("routes Junie custom profile through local LiteLLM full chat/completions URL", () => {
    const profile = buildJunieGridModelProfile("test-key", "agent-standard");
    expect(profile.baseUrl).toBe(JUNIE_LITELLM_CHAT_URL);
    expect(profile.baseUrl).toBe(`http://127.0.0.1:${JUNIE_LITELLM_PORT}/v1/chat/completions`);
    expect(profile.baseUrl.endsWith("/v1")).toBe(false);
    expect(profile.id).toBe("agent-standard");
    expect(profile.apiType).toBe("OpenAICompletion");
    expect(profile.apiKey).toBe("test-key");
    expect(profile.fasterModel).toEqual({ id: "agent-standard" });
  });

  it("litellm.yaml targets upstream Grid inference API for redirect handling", () => {
    const yaml = buildJunieLiteLlmYaml("agent-standard");
    expect(yaml.includes(JUNIE_GRID_UPSTREAM_BASE)).toBe(true);
    expect(yaml.includes("use_chat_completions_api: true")).toBe(true);
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
