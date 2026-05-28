/**
 * Single source of truth for the "Why Grid Spawn?" feature cards rendered
 * on both `/` and `/cli` (launch view). Update copy here; both surfaces
 * pick it up.
 */
export interface WhyCard {
  title: string;
  body: string;
}

export const WHY_GRID_SPAWN_CARDS: WhyCard[] = [
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
    body: "Each spawn is an isolated VM and credential boundary — no cross-talk between sessions.",
  },
  {
    title: "The Grid inference",
    body: "Inference routes through the Grid API (OpenAI-compatible) — budgets, keys, and usage on-platform.",
  },
];
