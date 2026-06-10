import { describe, expect, it } from "bun:test";
import type { Manifest } from "../manifest-schema.js";
import {
  agentKeys,
  allAgentKeys,
  cloudKeys,
  compareAgentSlugs,
  countImplemented,
  matrixStatus,
  sortAgentSlugs,
} from "../manifest-utils.js";

const baseManifest = (): Manifest => ({
  agents: {
    zzz: {
      name: "Zzz Agent",
      description: "z",
      url: "https://z.example",
      install: "true",
      launch: "z",
      env: {},
      github_stars: 10,
    },
    aaa: {
      name: "Aaa Agent",
      description: "a",
      url: "https://a.example",
      install: "true",
      launch: "a",
      env: {},
      github_stars: 100,
    },
    disabled_agent: {
      name: "Off",
      description: "off",
      url: "https://off.example",
      install: "true",
      launch: "off",
      env: {},
      disabled: true,
      github_stars: 500,
    },
    featured: {
      name: "Featured",
      description: "featured",
      url: "https://featured.example",
      install: "true",
      launch: "featured",
      env: {},
      github_stars: 5,
      sort_priority: 1,
    },
  },
  clouds: {
    c2: {
      name: "Cloud Two",
      description: "",
      price: "",
      url: "https://c2.example",
      type: "cloud",
      auth: "TOKEN",
      provision_method: "api",
      exec_method: "ssh",
      interactive_method: "ssh",
    },
    c1: {
      name: "Cloud One",
      description: "",
      price: "",
      url: "https://c1.example",
      type: "cloud",
      auth: "TOKEN",
      provision_method: "api",
      exec_method: "ssh",
      interactive_method: "ssh",
    },
  },
  matrix: {
    "c1/zzz": "implemented",
    "c1/aaa": "missing",
    "c2/zzz": "implemented",
    "c2/aaa": "implemented",
    "c2/disabled_agent": "implemented",
  },
});

describe("manifest-utils", () => {
  it("agentKeys excludes disabled and sorts by github_stars descending", () => {
    const m = baseManifest();
    expect(agentKeys(m)).toEqual([
      "aaa",
      "zzz",
      "featured",
    ]);
  });

  it("allAgentKeys includes disabled agents after enabled ones", () => {
    const m = baseManifest();
    expect(allAgentKeys(m, "github-stars")).toEqual([
      "aaa",
      "zzz",
      "featured",
      "disabled_agent",
    ]);
  });

  it("recommended sort uses sort_priority before github stars", () => {
    const m = baseManifest();
    expect(allAgentKeys(m, "recommended")).toEqual([
      "featured",
      "aaa",
      "zzz",
      "disabled_agent",
    ]);
  });

  it("compareAgentSlugs sorts by name when mode is name", () => {
    const m = baseManifest();
    expect(sortAgentSlugs(m, ["zzz", "aaa", "featured"], "name")).toEqual([
      "aaa",
      "featured",
      "zzz",
    ]);
  });

  it("compareAgentSlugs keeps disabled agents last regardless of stars", () => {
    const m = baseManifest();
    expect(compareAgentSlugs(m, "disabled_agent", "aaa", "github-stars")).toBeGreaterThan(0);
  });

  it("cloudKeys returns object keys (unordered)", () => {
    const m = baseManifest();
    expect(cloudKeys(m).sort()).toEqual([
      "c1",
      "c2",
    ]);
  });

  it("matrixStatus returns implemented or missing default", () => {
    const m = baseManifest();
    expect(matrixStatus(m, "c1", "zzz")).toBe("implemented");
    expect(matrixStatus(m, "c1", "aaa")).toBe("missing");
    expect(matrixStatus(m, "nope", "zzz")).toBe("missing");
  });

  it("countImplemented counts every implemented matrix cell", () => {
    const m = baseManifest();
    expect(countImplemented(m)).toBe(4);
  });
});
