import pc from "picocolors";
import { REPO, SPAWN_CDN } from "../manifest.js";

function getHelpUsageSection(): string {
  return `${pc.bold("USAGE")}
  grid-spawn                              Interactive agent + cloud picker
  grid-spawn <agent> <cloud>              Launch agent on cloud directly
  grid-spawn <agent> <cloud> --dry-run    Preview what would be provisioned (or -n)
  grid-spawn <agent> <cloud> --zone <zone>  Set zone/region (works for all clouds)
  grid-spawn <agent> <cloud> --size <type>  Set instance size/type (works for all clouds)
  grid-spawn <agent> <cloud> --model <id>  Set the LLM model (e.g. openai/gpt-5.3-codex)
  grid-spawn <agent> <cloud> --custom      Show interactive size/region pickers
  grid-spawn <agent> <cloud> --fast        Enable all speed optimizations (images, tarballs, parallel)
  grid-spawn <agent> <cloud> --verbose     Full provisioning logs (default is minimal stderr)
  grid-spawn <agent> <cloud> --headless   Provision and exit (no interactive session)
  grid-spawn <agent> <cloud> --output json
                                     Headless mode with structured JSON on stdout
  grid-spawn <agent> <cloud> --prompt "text"
                                     Execute agent with prompt (non-interactive)
  grid-spawn <agent> <cloud> --prompt-file <file>  (or -f)
                                     Execute agent with prompt from file
  grid-spawn <agent> <cloud> --config <file>
                                     Load all options from a JSON config file
  grid-spawn <agent> <cloud> --steps <list>
                                     Comma-separated setup steps to enable
  grid-spawn <agent>                      Interactive cloud picker for agent
  grid-spawn <cloud>                      Show available agents for cloud
  grid-spawn list                         Browse and rerun previous spawns (aliases: ls, history)
  grid-spawn list <filter>                Filter history by agent or cloud name
  grid-spawn list -a <agent>              Filter spawn history by agent (or --agent)
  grid-spawn list -c <cloud>              Filter spawn history by cloud (or --cloud)
  grid-spawn list --flat                  Show flat list (disable tree view)
  grid-spawn list --json                  Output history as JSON
  grid-spawn list --clear                 Clear all spawn history (requires --yes non-interactively)
  grid-spawn delete                       Delete a previously spawned server (aliases: rm, destroy, kill)
  grid-spawn delete -a <agent>            Filter servers by agent
  grid-spawn delete -c <cloud>            Filter servers by cloud
  grid-spawn delete --name <name> --yes   Headless delete by name (no prompts)
  grid-spawn status                       Show live state of cloud servers (aliases: ps)
  grid-spawn status -a <agent>            Filter status by agent (or --agent)
  grid-spawn status -c <cloud>            Filter status by cloud (or --cloud)
  grid-spawn status --prune               Remove gone servers from history
  grid-spawn fix                          Full VM recovery (credentials, install, config, daemons)
  grid-spawn fix <spawn-id>               Fix a specific spawn by name or ID
  grid-spawn link <ip>                    Register an existing VM by IP (alias: reconnect)
  grid-spawn link <ip> --agent <agent>    Specify the agent running on the VM
  grid-spawn link <ip> --cloud <cloud>    Specify the cloud provider
  grid-spawn export                       Export a claude spawn to a github repo (re-spawn via --repo)
  grid-spawn export <name>                Export a specific spawn by name or ID
  grid-spawn last                         Instantly rerun the most recent spawn (alias: rerun)
  grid-spawn matrix                       Full availability matrix (alias: m)
  grid-spawn agents                       List all agents with descriptions
  grid-spawn clouds                       List all cloud providers
  grid-spawn tree                         Show recursive spawn tree (parent/child relationships)
  grid-spawn tree --json                  Output spawn tree as JSON
  grid-spawn history export               Dump history as JSON to stdout
  grid-spawn feedback "message"            Send feedback to the Grid Spawn team
  grid-spawn uninstall                    Uninstall grid-spawn CLI and optionally remove data
  grid-spawn update                       Check for CLI updates
  grid-spawn version                      Show version (or --version, -v)
  grid-spawn help                         Show this help message (or --help, -h)`;
}

function getHelpExamplesSection(): string {
  return `${pc.bold("EXAMPLES")}
  grid-spawn                              ${pc.dim("# Pick interactively")}
  grid-spawn openclaw sprite              ${pc.dim("# Launch OpenClaw on Sprite")}
  grid-spawn codex hetzner                ${pc.dim("# Launch Codex CLI on Hetzner Cloud")}
  grid-spawn kilocode digitalocean        ${pc.dim("# Launch Kilo Code on DigitalOcean")}
  grid-spawn claude sprite --prompt "Fix all linter errors"
                                     ${pc.dim("# Execute Claude with prompt and exit")}
  grid-spawn codex sprite -p "Add tests"  ${pc.dim("# Short form of --prompt")}
  grid-spawn openclaw aws -f instructions.txt
                                     ${pc.dim("# Read prompt from file (short for --prompt-file)")}
  grid-spawn claude gcp --zone us-east1-b  ${pc.dim("# Use a specific GCP zone")}
  grid-spawn claude gcp --size e2-standard-4
                                     ${pc.dim("# Use a specific machine type")}
  grid-spawn codex gcp --model openai/gpt-5.3-codex
                                     ${pc.dim("# Override the default LLM model")}
  grid-spawn claude sprite --fast           ${pc.dim("# Fastest provisioning (images + tarballs + parallel)")}
  grid-spawn opencode gcp --dry-run       ${pc.dim("# Preview without provisioning")}
  grid-spawn claude hetzner --headless    ${pc.dim("# Provision, print connection info, exit")}
  grid-spawn claude hetzner --output json ${pc.dim("# Structured JSON output on stdout")}
  grid-spawn codex gcp --config setup.json --headless --output json
                                     ${pc.dim("# Config file with headless JSON output")}
  grid-spawn openclaw gcp --steps github,browser --headless
                                     ${pc.dim("# Only run specific setup steps")}
  grid-spawn claude                       ${pc.dim("# Show which clouds support Claude")}
  grid-spawn hetzner                      ${pc.dim("# Show which agents run on Hetzner")}
  grid-spawn list                         ${pc.dim("# Browse history and pick one to rerun")}
  grid-spawn list codex                   ${pc.dim("# Filter history by agent name")}
  grid-spawn last                         ${pc.dim("# Instantly rerun the most recent spawn")}
  grid-spawn matrix                       ${pc.dim("# See the full agent x cloud matrix")}`;
}

function getHelpAuthSection(): string {
  return `${pc.bold("AUTHENTICATION")}
  All agents use The Grid platform for LLM access. Get your API key at:
  ${pc.cyan("https://thegrid.ai (API keys dashboard)")}

  For non-interactive use, set environment variables:
  ${pc.dim("THEGRID_API_KEY")}=sk-or-v1-... grid-spawn claude sprite

  Each cloud provider has its own auth requirements.
  Run ${pc.cyan("grid-spawn <cloud>")} to see setup instructions for a specific provider.`;
}

function getHelpInstallSection(): string {
  return `${pc.bold("INSTALL")}
  curl -fsSL ${SPAWN_CDN}/cli/install.sh | bash`;
}

function getHelpTroubleshootingSection(): string {
  return `${pc.bold("TROUBLESHOOTING")}
  ${pc.dim("*")} Script not found: Run ${pc.cyan("grid-spawn matrix")} to verify the combination exists
  ${pc.dim("*")} Missing credentials: Run ${pc.cyan("grid-spawn <cloud>")} to see setup instructions
  ${pc.dim("*")} Update issues: Try ${pc.cyan("grid-spawn update")} or reinstall manually
  ${pc.dim("*")} Garbled unicode: Set ${pc.cyan("SPAWN_NO_UNICODE=1")} for ASCII-only output
  ${pc.dim("*")} Missing unicode over SSH: Set ${pc.cyan("SPAWN_UNICODE=1")} to force unicode on
  ${pc.dim("*")} OpenClaw dashboard on WSL shows "origin not allowed": the CLI opens ${pc.cyan("http://127.0.0.1:…")} in Windows so the origin matches the gateway; if that fails, use the logged ${pc.cyan("http://172.x…")} URL and set ${pc.cyan("SPAWN_WSL_OPEN_BROWSER_LAN_IP=1")} if needed (you may need matching gateway.controlUi.allowedOrigins for the LAN host).
  ${pc.dim("*")} Slow startup: Set ${pc.cyan("SPAWN_NO_UPDATE_CHECK=1")} to skip auto-update`;
}

function getHelpEnvVarsSection(): string {
  return `${pc.bold("ENVIRONMENT VARIABLES")}
  ${pc.cyan("THEGRID_API_KEY")}        The Grid platform API key (all agents require this)
  ${pc.cyan("MODEL_ID")}                  Override agent's default LLM model (or use --model flag; skips catalogue picker)
  ${pc.cyan("SPAWN_SKIP_MODEL_PROMPT=1")} Skip interactive model picker (${pc.cyan("--headless")} already implies no prompts)
  ${pc.cyan("SPAWN_NO_UPDATE_CHECK=1")}   Skip auto-update check on startup
  ${pc.cyan("SPAWN_NO_UNICODE=1")}        Force ASCII output (no unicode symbols)
  ${pc.cyan("SPAWN_UNICODE=1")}           Force Unicode output (override auto-detection)
  ${pc.cyan("SPAWN_HOME")}                Override spawn data directory (default: ~/.spawn)
  ${pc.cyan("SPAWN_DEBUG=1")}             Show debug output (unicode detection, etc.)
  ${pc.cyan("SPAWN_VERBOSE=1")}           Verbose provisioning logs (same effect as ${pc.cyan("--verbose")})
  ${pc.cyan("SPAWN_ENABLED_STEPS")}       Comma-separated setup steps (set by --steps/--config)
  ${pc.cyan("SPAWN_SETUP_PROMPT=1")}     Show setup multiselect on direct \`agent cloud\` runs (or use --setup-prompt)
  ${pc.cyan("SPAWN_PROMPT_FOR_NAME=1")}  Ask for spawn name even on direct runs (default is an auto-generated name)
  ${pc.cyan("TELEGRAM_BOT_TOKEN")}       Telegram bot token for non-interactive setup
  ${pc.cyan("SPAWN_HEADLESS=1")}          Set automatically in --headless mode (for scripts)
  ${pc.cyan("SPAWN_CUSTOM=1")}           Set automatically in --custom mode (show size/region pickers)`;
}

function getHelpFooterSection(): string {
  return `${pc.bold("MORE INFO")}
  Repository:  https://github.com/${REPO}
  The Grid:    https://thegrid.ai`;
}

export function cmdHelp(): void {
  const sections = [
    "",
    `${pc.bold("grid-spawn")} -- Launch any AI coding agent on any cloud`,
    "",
    getHelpUsageSection(),
    "",
    getHelpExamplesSection(),
    "",
    getHelpAuthSection(),
    "",
    getHelpInstallSection(),
    "",
    getHelpTroubleshootingSection(),
    "",
    getHelpEnvVarsSection(),
    "",
    getHelpFooterSection(),
  ];
  console.log(sections.join("\n"));
}
