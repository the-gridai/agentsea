import { describe, expect, it } from "bun:test";
import {
  agentSupportsHeartbeatModel,
  resolveHarnessGridInstruments,
} from "../shared/grid-instruments.js";

describe("grid-instruments harness plan", () => {
  it("registers Hermes defaults when user has not picked models", () => {
    const plan = resolveHarnessGridInstruments("hermes");
    expect(plan.primary).toBe("agent-prime");
    expect(plan.utility).toBe("agent-standard");
    expect(plan.registered).toEqual(["agent-prime", "agent-standard", "agent-max", "code-prime"]);
  });

  it("honours separate user picks for thinking and heartbeat", () => {
    const plan = resolveHarnessGridInstruments("hermes", "agent-max", "code-standard");
    expect(plan.primary).toBe("agent-max");
    expect(plan.utility).toBe("code-standard");
    expect(plan.registered).toEqual(["agent-max", "code-standard", "code-prime"]);
  });

  it("reads heartbeat model from AGENTSEA_HEARTBEAT_MODEL_ID", () => {
    const prev = process.env.AGENTSEA_HEARTBEAT_MODEL_ID;
    process.env.AGENTSEA_HEARTBEAT_MODEL_ID = "code-standard";
    try {
      const plan = resolveHarnessGridInstruments("openclaw", "code-prime");
      expect(plan.utility).toBe("code-standard");
    } finally {
      if (prev === undefined) {
        delete process.env.AGENTSEA_HEARTBEAT_MODEL_ID;
      } else {
        process.env.AGENTSEA_HEARTBEAT_MODEL_ID = prev;
      }
    }
  });

  it("flags agents that need a heartbeat picker", () => {
    expect(agentSupportsHeartbeatModel("hermes")).toBe(true);
    expect(agentSupportsHeartbeatModel("openclaw")).toBe(true);
    expect(agentSupportsHeartbeatModel("junie")).toBe(false);
  });
});
