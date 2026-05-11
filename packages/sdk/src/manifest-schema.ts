/** Manifest schema (Grid Spawn–compatible manifest shape) used by `@grid-spawn/cli` + marketing UI. */

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
  stars_updated?: string;
  language?: string;
  runtime?: string;
  category?: string;
  tagline?: string;
  tags?: string[];
  disabled?: boolean;
  disabled_reason?: string;
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
