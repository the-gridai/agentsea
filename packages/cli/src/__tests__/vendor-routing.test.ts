import { describe, expect, it } from "bun:test";
import {
  GRID_INFERENCE_DEFAULT_MODEL_ID,
  LEGACY_SAVED_API_KEY_CONFIG_STEM,
  OPENCLAW_GRID_MODEL_CONTEXT_WINDOW,
  OPENCLAW_GRID_MODEL_MAX_TOKENS,
  OPENCLAW_GRID_PROVIDER_ID,
  VENDOR_AGENT_IMAGE_REGISTRY,
  VENDOR_CHAT_MODEL_DEFAULT,
  KILO_GRID_PROVIDER_ID,
  VENDOR_CODEX_MODEL_PROVIDER_KEY,
  digitalOceanAgentSeaImageSlug,
} from "../shared/vendor-routing.js";

describe("vendor-routing", () => {
  it("Grid-default chat model ids align", () => {
    expect(VENDOR_CHAT_MODEL_DEFAULT).toBe(GRID_INFERENCE_DEFAULT_MODEL_ID);
    expect(GRID_INFERENCE_DEFAULT_MODEL_ID).toBe("agent-standard");
  });

  it("OpenClaw Grid provider slug is stable", () => {
    expect(OPENCLAW_GRID_PROVIDER_ID).toBe("thegrid");
    expect(OPENCLAW_GRID_MODEL_MAX_TOKENS).toBeGreaterThan(0);
    expect(OPENCLAW_GRID_MODEL_CONTEXT_WINDOW).toBeGreaterThan(0);
  });

  it("decodes routing constants used by upstream CLIs", () => {
    expect(KILO_GRID_PROVIDER_ID).toBe("thegrid");
    expect(VENDOR_CODEX_MODEL_PROVIDER_KEY).toBe("thegrid");
    expect(LEGACY_SAVED_API_KEY_CONFIG_STEM).toBe("opentouter");
    expect(VENDOR_AGENT_IMAGE_REGISTRY).toBe("ghcr.io/openrouterteam");
    expect(digitalOceanAgentSeaImageSlug("claude")).toBe("openrouter-spawnclaude");
  });
});
