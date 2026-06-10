import { describe, expect, it } from "bun:test";
import { buildHermesDashboardStartScript, HERMES_DASHBOARD_PORT } from "../shared/hermes-dashboard.js";

describe("hermes-dashboard", () => {
  it("waits on /health not just an open TCP port", () => {
    const script = buildHermesDashboardStartScript(90);
    expect(script).toContain(`/health`);
    expect(script).toContain(`--port ${HERMES_DASHBOARD_PORT}`);
    expect(script).toContain("seq 1 90");
    expect(script).not.toContain("/dev/tcp");
  });
});
