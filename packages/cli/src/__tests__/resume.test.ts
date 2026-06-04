import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { recoverProvisionCheckpoints } from "../commands/resume.js";
import {
  isProvisioningIncomplete,
  loadHistory,
  upsertAgentseaRecord,
  writeProvisionCheckpoint,
} from "../history.js";
import type { CloudOrchestrator } from "../shared/orchestrate.js";
import { resumeOrchestrationFromRecord } from "../shared/orchestrate.js";
import { createMockManifest } from "./test-helpers";

describe("resume / provision recovery", () => {
  let testDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    testDir = join(process.env.HOME ?? "", `.agentsea-resume-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    originalEnv = { ...process.env };
    process.env.AGENTSEA_HOME = testDir;
    process.env.THEGRID_API_KEY = "sk-test-resume";
    process.env.AGENTSEA_TELEMETRY = "0";
    process.env.AGENTSEA_NON_INTERACTIVE = "1";
    process.env.AGENTSEA_HEADLESS = "1";
    process.env.NODE_ENV = "test";
  });

  afterEach(() => {
    process.env = originalEnv;
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("isProvisioningIncomplete", () => {
    it("returns false for legacy complete-looking records", () => {
      expect(
        isProvisioningIncomplete({
          connection: {
            ip: "1.2.3.4",
            user: "root",
          },
        }),
      ).toBe(false);
    });

    it("returns true for failed status", () => {
      expect(
        isProvisioningIncomplete({
          connection: {
            ip: "1.2.3.4",
            user: "root",
          },
          provision_status: "failed",
        }),
      ).toBe(true);
    });

    it("returns true when phase is not complete", () => {
      expect(
        isProvisioningIncomplete({
          connection: {
            ip: "1.2.3.4",
            user: "root",
          },
          provision_phase: "agent_installing",
        }),
      ).toBe(true);
    });

    it("returns false when deleted", () => {
      expect(
        isProvisioningIncomplete({
          connection: {
            ip: "1.2.3.4",
            user: "root",
            deleted: true,
          },
          provision_phase: "vm_ready",
        }),
      ).toBe(false);
    });
  });

  describe("recoverProvisionCheckpoints", () => {
    it("imports a checkpoint with connection into history when history is empty", () => {
      const id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
      const record = {
        id,
        agent: "claude",
        cloud: "digitalocean",
        timestamp: "2026-01-01T00:00:00.000Z",
        connection: {
          ip: "10.0.0.5",
          user: "root",
          server_id: "99",
          cloud: "digitalocean",
        },
        provision_phase: "vm_created" as const,
        provision_status: "in_progress" as const,
      };
      writeProvisionCheckpoint(record);

      const n = recoverProvisionCheckpoints();
      expect(n).toBe(1);

      const history = loadHistory();
      expect(history).toHaveLength(1);
      expect(history[0].id).toBe(id);
      expect(history[0].connection?.ip).toBe("10.0.0.5");
    });

    it("skips checkpoint when that id is already in history", () => {
      const id = "bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee";
      upsertAgentseaRecord({
        id,
        agent: "claude",
        cloud: "digitalocean",
        timestamp: "2026-01-02T00:00:00.000Z",
        connection: {
          ip: "10.0.0.1",
          user: "root",
          cloud: "digitalocean",
        },
      });
      writeProvisionCheckpoint({
        id,
        agent: "claude",
        cloud: "digitalocean",
        timestamp: "2026-01-02T00:00:00.000Z",
        connection: {
          ip: "10.0.0.9",
          user: "root",
          cloud: "digitalocean",
        },
      });

      const n = recoverProvisionCheckpoints();
      expect(n).toBe(0);
      const history = loadHistory();
      expect(history[0].connection?.ip).toBe("10.0.0.1");
    });
  });

  describe("resumeOrchestrationFromRecord (injected cloud)", () => {
    it("runs vm wait + tarball install + env inject then stops before post-install when test hook set", async () => {
      process.env.AGENTSEA_FAST = "1";
      let waitForReadyCalls = 0;
      let tarballCalls = 0;

      const fakeCloud: CloudOrchestrator = {
        cloudName: "digitalocean",
        cloudLabel: "DigitalOcean",
        skipAgentInstall: false,
        runner: {
          runServer: async () => {},
          uploadFile: async () => {},
          downloadFile: async () => {},
        },
        authenticate: async () => {},
        promptSize: async () => {},
        createServer: async () => ({
          ip: "10.0.0.2",
          user: "root",
        }),
        getServerName: async () => "srv",
        async waitForReady() {
          waitForReadyCalls++;
        },
        interactiveSession: async () => 0,
      };

      const manifest = createMockManifest();
      manifest.clouds.digitalocean = {
        ...manifest.clouds.hetzner,
        name: "DigitalOcean",
      };
      manifest.matrix["digitalocean/claude"] = "implemented";

      const recordId = "cccccccc-cccc-cccc-cccc-cccccccccccc";
      upsertAgentseaRecord({
        id: recordId,
        agent: "claude",
        cloud: "digitalocean",
        timestamp: "2026-01-03T00:00:00.000Z",
        connection: {
          ip: "10.0.0.2",
          user: "root",
          cloud: "digitalocean",
        },
        provision_phase: "pending",
        provision_status: "in_progress",
      });

      await resumeOrchestrationFromRecord(
        {
          id: recordId,
          agent: "claude",
          cloud: "digitalocean",
          timestamp: "2026-01-03T00:00:00.000Z",
          connection: {
            ip: "10.0.0.2",
            user: "root",
            cloud: "digitalocean",
          },
          provision_phase: "pending",
          provision_status: "in_progress",
        },
        manifest,
        {
          getApiKey: async () => "sk-test",
          testResumeCloud: fakeCloud,
          tryTarball: async () => {
            tarballCalls++;
            return true;
          },
          testResumeStopBeforePostInstall: true,
        },
      );

      expect(waitForReadyCalls).toBe(1);
      expect(tarballCalls).toBe(1);

      const updated = loadHistory().find((r) => r.id === recordId);
      expect(updated?.provision_phase).toBe("post_install");
      expect(updated?.provision_status).toBe("in_progress");
    });

    it("skips vm wait when phase is already vm_ready", async () => {
      let waitForReadyCalls = 0;

      const fakeCloud: CloudOrchestrator = {
        cloudName: "digitalocean",
        cloudLabel: "DigitalOcean",
        skipAgentInstall: false,
        runner: {
          runServer: async () => {},
          uploadFile: async () => {},
          downloadFile: async () => {},
        },
        authenticate: async () => {},
        promptSize: async () => {},
        createServer: async () => ({
          ip: "10.0.0.3",
          user: "root",
        }),
        getServerName: async () => "srv",
        async waitForReady() {
          waitForReadyCalls++;
        },
        interactiveSession: async () => 0,
      };

      const manifest = createMockManifest();
      manifest.clouds.digitalocean = {
        ...manifest.clouds.hetzner,
        name: "DigitalOcean",
      };
      manifest.matrix["digitalocean/claude"] = "implemented";

      const recordId = "dddddddd-dddd-dddd-dddd-dddddddddddd";
      upsertAgentseaRecord({
        id: recordId,
        agent: "claude",
        cloud: "digitalocean",
        timestamp: "2026-01-04T00:00:00.000Z",
        connection: {
          ip: "10.0.0.3",
          user: "root",
          cloud: "digitalocean",
        },
        provision_phase: "vm_ready",
        provision_status: "in_progress",
      });

      await resumeOrchestrationFromRecord(
        {
          id: recordId,
          agent: "claude",
          cloud: "digitalocean",
          timestamp: "2026-01-04T00:00:00.000Z",
          connection: {
            ip: "10.0.0.3",
            user: "root",
            cloud: "digitalocean",
          },
          provision_phase: "vm_ready",
          provision_status: "in_progress",
        },
        manifest,
        {
          getApiKey: async () => "sk-test",
          testResumeCloud: fakeCloud,
          tryTarball: async () => true,
          testResumeStopBeforePostInstall: true,
        },
      );

      expect(waitForReadyCalls).toBe(0);
    });
  });
});
