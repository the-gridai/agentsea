import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getCacheDir,
  getCacheFile,
  getHistoryPath,
  getAgentseaCloudConfigPath,
  getAgentseaDir,
  getSshDir,
  getTmpDir,
  getUpdateFailedPath,
  getUserHome,
} from "../shared/paths.js";

describe("paths", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = {
      ...process.env,
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("getUserHome", () => {
    it("returns HOME env var when set", () => {
      process.env.HOME = "/custom/home";
      expect(getUserHome()).toBe("/custom/home");
    });

    it("falls back to a non-empty string when HOME is unset", () => {
      delete process.env.HOME;
      const result = getUserHome();
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe("getAgentseaDir", () => {
    it("returns ~/.config/agentsea by default", () => {
      delete process.env.AGENTSEA_HOME;
      delete process.env.AGENTSEA_HOME;
      expect(getAgentseaDir()).toBe(join(getUserHome(), ".config", "agentsea"));
    });

    it("uses AGENTSEA_HOME when set to valid absolute path", () => {
      const testPath = join(getUserHome(), ".custom-agentsea");
      delete process.env.AGENTSEA_HOME;
      process.env.AGENTSEA_HOME = testPath;
      expect(getAgentseaDir()).toBe(testPath);
    });

    it("uses AGENTSEA_HOME when AGENTSEA_HOME unset (legacy)", () => {
      delete process.env.AGENTSEA_HOME;
      const testPath = join(getUserHome(), ".legacy-agentsea");
      process.env.AGENTSEA_HOME = testPath;
      expect(getAgentseaDir()).toBe(testPath);
    });

    it("rejects relative AGENTSEA_HOME", () => {
      delete process.env.AGENTSEA_HOME;
      process.env.AGENTSEA_HOME = "relative/path";
      expect(() => getAgentseaDir()).toThrow("must be an absolute path");
    });

    it("rejects dot-relative AGENTSEA_HOME", () => {
      delete process.env.AGENTSEA_HOME;
      process.env.AGENTSEA_HOME = "./local/dir";
      expect(() => getAgentseaDir()).toThrow("must be an absolute path");
    });

    it("resolves .. segments in absolute AGENTSEA_HOME within home", () => {
      delete process.env.AGENTSEA_HOME;
      const pathWithDots = join(getUserHome(), "foo", "..", "bar");
      process.env.AGENTSEA_HOME = pathWithDots;
      expect(getAgentseaDir()).toBe(join(getUserHome(), "bar"));
    });

    it("rejects AGENTSEA_HOME outside home directory", () => {
      delete process.env.AGENTSEA_HOME;
      process.env.AGENTSEA_HOME = "/tmp/agentsea";
      expect(() => getAgentseaDir()).toThrow("must be within your home directory");
    });

    it("accepts home directory itself as AGENTSEA_HOME", () => {
      delete process.env.AGENTSEA_HOME;
      process.env.AGENTSEA_HOME = getUserHome();
      expect(getAgentseaDir()).toBe(getUserHome());
    });
  });

  describe("getHistoryPath", () => {
    it("returns history.json inside agentsea dir", () => {
      delete process.env.AGENTSEA_HOME;
      delete process.env.AGENTSEA_HOME;
      expect(getHistoryPath()).toBe(join(getUserHome(), ".config", "agentsea", "history.json"));
    });
  });

  describe("getAgentseaCloudConfigPath", () => {
    it("returns ~/.config/agentsea/{cloud}.json", () => {
      delete process.env.AGENTSEA_HOME;
      delete process.env.AGENTSEA_HOME;
      delete process.env.AGENTSEA_HOME;
      expect(getAgentseaCloudConfigPath("aws")).toBe(join(getUserHome(), ".config", "agentsea", "aws.json"));
    });

    it("works for different cloud names", () => {
      delete process.env.AGENTSEA_HOME;
      delete process.env.AGENTSEA_HOME;
      delete process.env.AGENTSEA_HOME;
      expect(getAgentseaCloudConfigPath("hetzner")).toBe(join(getUserHome(), ".config", "agentsea", "hetzner.json"));
    });
  });

  describe("getCacheDir", () => {
    it("returns XDG_CACHE_HOME/agentsea when XDG_CACHE_HOME is set", () => {
      process.env.XDG_CACHE_HOME = "/custom/cache";
      expect(getCacheDir()).toBe("/custom/cache/agentsea");
    });

    it("falls back to ~/.cache/agentsea", () => {
      delete process.env.XDG_CACHE_HOME;
      expect(getCacheDir()).toBe(join(getUserHome(), ".cache", "agentsea"));
    });
  });

  describe("getCacheFile", () => {
    it("returns manifest.json inside cache dir", () => {
      delete process.env.XDG_CACHE_HOME;
      expect(getCacheFile()).toBe(join(getUserHome(), ".cache", "agentsea", "manifest.json"));
    });
  });

  describe("getUpdateFailedPath", () => {
    it("returns ~/.config/agentsea/.update-failed", () => {
      delete process.env.AGENTSEA_HOME;
      delete process.env.AGENTSEA_HOME;
      delete process.env.AGENTSEA_HOME;
      expect(getUpdateFailedPath()).toBe(join(getUserHome(), ".config", "agentsea", ".update-failed"));
    });
  });

  describe("getSshDir", () => {
    it("returns ~/.ssh", () => {
      expect(getSshDir()).toBe(join(getUserHome(), ".ssh"));
    });
  });

  describe("getTmpDir", () => {
    it("returns os.tmpdir()", () => {
      expect(getTmpDir()).toBe(tmpdir());
    });
  });
});
