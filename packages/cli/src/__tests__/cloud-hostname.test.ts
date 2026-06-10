import { describe, expect, it } from "bun:test";
import {
  defaultAgentseaLabel,
  defaultAgentseaName,
  defaultCloudHostnameBase,
  dropletNameWithUuidSuffix,
} from "../shared/ui.js";

describe("cloud hostname defaults", () => {
  it("uses agent slug as the primary droplet base", () => {
    expect(defaultCloudHostnameBase("hermes")).toBe("hermes");
    expect(defaultAgentseaLabel("hermes")).toBe("hermes");
  });

  it("appends uuid for unique cloud hostnames", () => {
    const name = defaultAgentseaName("hermes");
    expect(name.startsWith("hermes-")).toBe(true);
    expect(name).not.toContain("agentsea-hermes");
    expect(dropletNameWithUuidSuffix("hermes").startsWith("hermes-")).toBe(true);
  });

  it("falls back to agentsea when no agent slug", () => {
    expect(defaultCloudHostnameBase()).toBe("agentsea");
    expect(defaultAgentseaName()).toMatch(/^agentsea-/);
  });
});
