/** Manifest schema (AgentSea–compatible manifest shape) used by `@agentsea/cli` + marketing UI. */

/** Optional external doc link shown with a next-step bullet. */
export interface NextStepLink {
  label: string;
  url: string;
}

/** One actionable post-install guidance bullet for techsumers. */
export interface NextStep {
  /** Plain-language guidance (shown as a bullet). */
  text: string;
  /** Optional doc link appended after the bullet text. */
  link?: NextStepLink;
}

export interface AgentDef {
  name: string;
  description: string;
  url: string;
  install: string;
  launch: string;
  env: Record<string, string>;
  pre_launch?: string;
  deps?: string[];
  config_files?: Record<string, unknown>;
  interactive_prompts?: Record<
    string,
    {
      prompt: string;
      default: string;
    }
  >;
  dotenv?: {
    path: string;
    values: Record<string, string>;
  };
  notes?: string;
  icon?: string;
  featured_cloud?: string[];
  creator?: string;
  repo?: string;
  license?: string;
  created?: string;
  added?: string;
  github_stars?: number;
  /** Lower values surface first in homepage “Recommended” sort (Grid-friendly agents). */
  sort_priority?: number;
  stars_updated?: string;
  language?: string;
  runtime?: string;
  category?: string;
  tagline?: string;
  tags?: string[];
  disabled?: boolean;
  disabled_reason?: string;
  /** 3–5 actionable bullets shown after a successful AgentSea install. */
  next_steps?: NextStep[];
}

export interface CloudDef {
  name: string;
  description: string;
  price: string;
  url: string;
  type: string;
  auth: string;
  provision_method: string;
  exec_method: string;
  interactive_method: string;
  defaults?: Record<string, unknown>;
  notes?: string;
  icon?: string;
}

export interface McpServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface SkillAgentConfig {
  mcp_config?: McpServerConfig;
  instruction_path?: string;
  default: boolean;
}

export interface SkillDef {
  name: string;
  description: string;
  type: "mcp" | "instruction" | "config";
  package?: string;
  content?: string;
  env_vars?: string[];
  prerequisites?: {
    apt?: string[];
    commands?: string[];
    env_vars?: string[];
  };
  headless_compatible?: boolean;
  agents: Record<string, SkillAgentConfig>;
}

export interface Manifest {
  agents: Record<string, AgentDef>;
  clouds: Record<string, CloudDef>;
  matrix: Record<string, string>;
  skills?: Record<string, SkillDef>;
}
