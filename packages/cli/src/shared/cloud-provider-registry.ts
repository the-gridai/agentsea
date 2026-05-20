import type { CloudProvider } from "./cloud-provider.js";

const CLOUD_PROVIDERS: CloudProvider[] = [
  {
    slug: "local",
    label: "Local Machine",
    localMainEntrypoint: "local/main.ts",
  },
  {
    slug: "hetzner",
    label: "Hetzner Cloud",
    localMainEntrypoint: "hetzner/main.ts",
    buildResumeOrchestrator: async (record) => {
      const mod = await import("../hetzner/provider.js");
      return mod.buildHetznerResumeOrchestrator(record);
    },
  },
  {
    slug: "aws",
    label: "AWS Lightsail",
    localMainEntrypoint: "aws/main.ts",
  },
  {
    slug: "digitalocean",
    label: "DigitalOcean",
    localMainEntrypoint: "digitalocean/main.ts",
    capabilities: {
      skipInteractivePreflightCredentialCheck: true,
    },
    buildResumeOrchestrator: async (record) => {
      const mod = await import("../digitalocean/provider.js");
      return mod.buildDigitalOceanResumeOrchestrator(record);
    },
  },
  {
    slug: "gcp",
    label: "GCP Compute Engine",
    localMainEntrypoint: "gcp/main.ts",
  },
  {
    slug: "daytona",
    label: "Daytona",
    localMainEntrypoint: "daytona/main.ts",
  },
  {
    slug: "sprite",
    label: "Sprite",
    localMainEntrypoint: "sprite/main.ts",
  },
];

const providersBySlug: Record<string, CloudProvider> = (() => {
  const bySlug: Record<string, CloudProvider> = {};
  for (const provider of CLOUD_PROVIDERS) {
    if (bySlug[provider.slug]) {
      throw new Error(`Duplicate cloud provider slug: ${provider.slug}`);
    }
    bySlug[provider.slug] = provider;
  }
  return bySlug;
})();

export function listCloudProviderSlugs(): string[] {
  return Object.keys(providersBySlug);
}

export function getCloudProvider(slug: string): CloudProvider | undefined {
  return providersBySlug[slug];
}

export function requireCloudProvider(slug: string): CloudProvider {
  const provider = providersBySlug[slug];
  if (!provider) {
    throw new Error(`Unknown cloud provider: ${slug}`);
  }
  return provider;
}
