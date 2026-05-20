import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createCloudAgents, type CloudRunner } from "../../shared/agent-setup.js";
import { listAgentModuleSlugs } from "../../shared/agent-module-registry.js";
import { listCloudProviderSlugs } from "../../shared/cloud-provider-registry.js";
import { E2E_AGENT_SLUGS } from "./e2e-agents.js";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..", "..");
const COMMON_SH = join(REPO_ROOT, "sh", "e2e", "lib", "common.sh");
const VERIFY_SH = join(REPO_ROOT, "sh", "e2e", "lib", "verify.sh");
const MANIFEST_JSON = join(REPO_ROOT, "manifest.json");

const noopRunner: CloudRunner = {
  runServer: async () => {},
  uploadFile: async () => {},
  downloadFile: async () => {},
};

function sorted(values: readonly string[]): string[] {
  return [...values].sort();
}

function parseAllAgentsFromCommonSh(content: string): string[] {
  const match = /^ALL_AGENTS="([^"]+)"/m.exec(content);
  if (!match?.[1]) {
    throw new Error("Failed to parse ALL_AGENTS from sh/e2e/lib/common.sh");
  }
  return match[1].split(/\s+/).filter(Boolean);
}

function parseFunctionSlugs(content: string, prefix: string): string[] {
  const re = new RegExp(`^${prefix}_([a-z0-9_]+)\\s*\\(\\)\\s*\\{`, "gm");
  const slugs: string[] = [];
  for (const hit of content.matchAll(re)) {
    if (hit[1]) {
      slugs.push(hit[1]);
    }
  }
  return slugs;
}

describe("agent/cloud parity guards", () => {
  it("locks E2E agent slugs against common.sh and verify handlers", () => {
    const e2eSlugs = sorted(E2E_AGENT_SLUGS);
    const commonSh = readFileSync(COMMON_SH, "utf-8");
    const verifySh = readFileSync(VERIFY_SH, "utf-8");
    const commonSlugs = sorted(parseAllAgentsFromCommonSh(commonSh));
    const e2eSlugSet = new Set(E2E_AGENT_SLUGS);
    const verifySlugs = sorted(parseFunctionSlugs(verifySh, "verify").filter((slug) => e2eSlugSet.has(slug)));
    const inputTestSlugs = sorted(parseFunctionSlugs(verifySh, "input_test").filter((slug) => e2eSlugSet.has(slug)));

    expect(commonSlugs).toEqual(e2eSlugs);
    expect(verifySlugs).toEqual(e2eSlugs);
    expect(inputTestSlugs).toEqual(e2eSlugs);
  });

  it("locks implemented manifest agents against module and config registries", () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_JSON, "utf-8")) as {
      agents: Record<string, unknown>;
      clouds: Record<string, unknown>;
      matrix: Record<string, string>;
    };

    const implementedAgents = sorted(
      Object.keys(manifest.agents).filter((slug) =>
        Object.keys(manifest.clouds).every((cloud) => manifest.matrix[`${cloud}/${slug}`] === "implemented"),
      ),
    );

    const moduleSlugs = sorted(listAgentModuleSlugs());
    const configSlugs = sorted(Object.keys(createCloudAgents(noopRunner).agents));
    const e2eSlugs = sorted(E2E_AGENT_SLUGS);

    expect(moduleSlugs).toEqual(implementedAgents);
    expect(configSlugs).toEqual(implementedAgents);
    expect(e2eSlugs).toEqual(implementedAgents);
  });

  it("locks cloud provider registry slugs to manifest clouds", () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_JSON, "utf-8")) as {
      clouds: Record<string, unknown>;
    };
    expect(sorted(listCloudProviderSlugs())).toEqual(sorted(Object.keys(manifest.clouds)));
  });
});
