import type { AgentModule } from "../agent-module.js";
import { claudeAgentModule } from "./claude.js";
import { codexAgentModule } from "./codex.js";
import { cursorAgentModule } from "./cursor.js";
import { hermesAgentModule } from "./hermes.js";
import { junieAgentModule } from "./junie.js";
import { kilocodeAgentModule } from "./kilocode.js";
import { openclawAgentModule } from "./openclaw.js";
import { opencodeAgentModule } from "./opencode.js";
import { piAgentModule } from "./pi.js";
import { t3codeAgentModule } from "./t3code.js";

export const AGENT_MODULES: AgentModule[] = [
  claudeAgentModule,
  openclawAgentModule,
  codexAgentModule,
  opencodeAgentModule,
  kilocodeAgentModule,
  hermesAgentModule,
  junieAgentModule,
  cursorAgentModule,
  piAgentModule,
  t3codeAgentModule,
];
