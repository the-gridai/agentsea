/** Single source of truth for "Why AgentSea?" feature cards on `/why-agentsea`. */
export interface WhyCard {
  title: string;
  body: string;
}

export const WHY_AGENTSEA_CARDS: WhyCard[] = [
  {
    title: "Agent-agnostic",
    body: "Start with OpenClaw, Codex, or OpenCode, and switch with a single command as more agents land.",
  },
  {
    title: "Bring your own cloud",
    body: "Your provider account, your keys — we orchestrate, you own the bill and the data plane.",
  },
  {
    title: "Fully sandboxed",
    body: "Each agent runs in an isolated VM and credential boundary — no cross-talk between sessions.",
  },
  {
    title: "The Grid inference",
    body: "Inference routes through the Grid API (OpenAI-compatible) — budgets, keys, and usage on-platform.",
  },
];
