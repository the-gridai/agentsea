export interface HoodStep {
  title: string;
  body: string;
}

/** Per-environment pipeline steps shown on the How it works reference page. */
export function hoodStepsForCloud(cloudSlug: string): HoodStep[] {
  if (cloudSlug === "local") {
    return [
      {
        title: "Install",
        body: "Installs the agent and dependencies on this machine. No cloud account needed.",
      },
      {
        title: "Authenticate",
        body: "Prompts for your The Grid API key and saves it under ~/.config/agentsea/ when you confirm.",
      },
      {
        title: "Configure",
        body: "Wires environment variables, Grid API endpoints, and model routing.",
      },
      {
        title: "Connect",
        body: "Launches the agent in your terminal with full TTY support.",
      },
    ];
  }

  return [
    {
      title: "Provision",
      body: "Spins up a fresh VM in your cloud account. No Terraform or YAML configs.",
    },
    {
      title: "Install",
      body: "Cloud-init installs the agent and dependencies on the new server.",
    },
    {
      title: "Authenticate",
      body: "Injects your The Grid API key and cloud credentials into the VM.",
    },
    {
      title: "Configure",
      body: "Sets environment, OpenAI-compatible endpoints, and model routing to The Grid.",
    },
    {
      title: "Connect",
      body: "Opens an SSH session. Drive the interactive agent from your terminal.",
    },
  ];
}
