import fs from "node:fs";
import path from "node:path";
import * as p from "@clack/prompts";
import pc from "picocolors";
import {
  getCacheDir,
  getAgentseaDir,
  getUserHome,
  RC_MARKER_END,
  RC_MARKER_LEGACY,
  RC_MARKER_START,
} from "../shared/paths.js";
import { AGENTSEA_CLI } from "../shared/cli-invocation.js";
import { tryCatch } from "../shared/result.js";
import { getErrorMessage } from "./shared.js";

/** Shell RC files that the installer may have patched. */
const RC_FILES = [
  ".bashrc",
  ".bash_profile",
  ".profile",
  ".zshrc",
];

/** Remove agentsea-related PATH blocks from an RC file.
 *  Handles both the new start/end marker format and the legacy single-comment format. */
function cleanRcFile(rcPath: string): boolean {
  const readResult = tryCatch(() => fs.readFileSync(rcPath, "utf-8"));
  if (!readResult.ok) {
    return false;
  }
  const content = readResult.data;

  const lines = content.split("\n");
  const cleaned: string[] = [];
  let changed = false;
  let insideBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // New format: skip everything between start/end markers (inclusive)
    if (line === RC_MARKER_START) {
      // Remove preceding blank line if present
      if (cleaned.length > 0 && cleaned[cleaned.length - 1] === "") {
        cleaned.pop();
      }
      insideBlock = true;
      changed = true;
      continue;
    }
    if (insideBlock) {
      if (line === RC_MARKER_END) {
        insideBlock = false;
      }
      continue;
    }

    // Legacy format: "# Added by agentsea installer" followed by a PATH export
    if (line === RC_MARKER_LEGACY) {
      const next = lines[i + 1] ?? "";
      if (next.includes(".local/bin") || next.includes(".bun/bin")) {
        if (cleaned.length > 0 && cleaned[cleaned.length - 1] === "") {
          cleaned.pop();
        }
        i++; // skip the PATH line too
        changed = true;
        continue;
      }
    }

    cleaned.push(line);
  }

  // Safety: if insideBlock is still true, the end marker is missing.
  // Abort to avoid truncating the user's shell config.
  if (insideBlock) {
    p.log.warn(`Agentsea block in ${rcPath} is missing end marker — skipping to avoid data loss.`);
    p.log.warn(`Manually remove the line "${RC_MARKER_START}" and the agentsea PATH export from ${rcPath}.`);
    return false;
  }

  if (changed) {
    fs.writeFileSync(rcPath, cleaned.join("\n"));
  }
  return changed;
}

/** Check if a path is a symlink pointing to the agentsea binary. */
function isAgentseaSymlink(linkPath: string, binaryPath: string): boolean {
  const result = tryCatch(() => fs.readlinkSync(linkPath));
  if (!result.ok) {
    return false;
  }
  return result.data === binaryPath;
}

export async function cmdUninstall(): Promise<void> {
  p.intro(pc.bold("Uninstall agentsea"));

  const home = getUserHome();
  const binaryPath = path.join(home, ".local", "bin", "agentsea");
  const symlinkPath = "/usr/local/bin/agentsea";
  const cacheDir = getCacheDir();
  const agentseaDir = getAgentseaDir();
  const configDir = path.join(home, ".config", "agentsea");

  // Show what exists
  const binaryExists = fs.existsSync(binaryPath);
  const symlinkExists = isAgentseaSymlink(symlinkPath, binaryPath);
  const cacheExists = fs.existsSync(cacheDir);
  const agentseaDirExists = fs.existsSync(agentseaDir);
  const configDirExists = fs.existsSync(configDir);

  if (!binaryExists && !symlinkExists && !cacheExists && !agentseaDirExists && !configDirExists) {
    p.log.info("Nothing to uninstall — agentsea does not appear to be installed.");
    p.outro("Done");
    return;
  }

  // Optional data removal
  const options: {
    value: string;
    label: string;
    hint: string;
  }[] = [];
  if (agentseaDirExists) {
    options.push({
      value: "history",
      label: "Remove agentsea history",
      hint: agentseaDir,
    });
  }
  if (configDirExists) {
    options.push({
      value: "config",
      label: "Remove config and saved keys",
      hint: configDir,
    });
  }

  let removeHistory = false;
  let removeConfig = false;

  if (options.length > 0) {
    const selected = await p.multiselect({
      message: "Also remove data? (space to toggle, enter to continue)",
      options,
      required: false,
    });
    if (p.isCancel(selected)) {
      p.outro("Cancelled");
      process.exit(0);
    }
    const selections = selected;
    removeHistory = selections.includes("history");
    removeConfig = selections.includes("config");
  }

  // Summary of what will be removed
  p.log.step("The following will be removed:");
  if (binaryExists) {
    p.log.info(`  Binary:    ${binaryPath}`);
  }
  if (symlinkExists) {
    p.log.info(`  Symlink:   ${symlinkPath}`);
  }
  if (cacheExists) {
    p.log.info(`  Cache:     ${cacheDir}`);
  }
  p.log.info("  Shell RC:  agentsea PATH entries");
  if (removeHistory) {
    p.log.info(`  History:   ${agentseaDir}`);
  }
  if (removeConfig) {
    p.log.info(`  Config:    ${configDir}`);
  }

  const confirmed = await p.confirm({
    message: "Are you sure you want to uninstall agentsea?",
    initialValue: false,
  });
  if (p.isCancel(confirmed) || !confirmed) {
    p.outro("Cancelled");
    process.exit(0);
  }

  // --- Perform removal ---
  const removed: string[] = [];

  // Binary
  if (binaryExists) {
    const result = tryCatch(() => fs.unlinkSync(binaryPath));
    if (result.ok) {
      removed.push(`Binary: ${binaryPath}`);
    } else {
      p.log.warn(`Could not remove binary: ${binaryPath} (${getErrorMessage(result.error)})`);
    }
  }

  // Symlink (only if it points to our binary)
  if (symlinkExists) {
    const result = tryCatch(() => fs.unlinkSync(symlinkPath));
    if (result.ok) {
      removed.push(`Symlink: ${symlinkPath}`);
    } else {
      p.log.warn(`Could not remove symlink: ${symlinkPath} (may need sudo)`);
    }
  }

  // Cache
  if (cacheExists) {
    fs.rmSync(cacheDir, {
      recursive: true,
      force: true,
    });
    removed.push(`Cache: ${cacheDir}`);
  }

  // Shell RC files
  const cleanedFiles: string[] = [];
  for (const rcFile of RC_FILES) {
    const rcPath = path.join(home, rcFile);
    if (cleanRcFile(rcPath)) {
      cleanedFiles.push(rcFile);
    }
  }
  if (cleanedFiles.length > 0) {
    removed.push(`Shell RC: ${cleanedFiles.join(", ")}`);
  }

  // Optional: history
  if (removeHistory && agentseaDirExists) {
    fs.rmSync(agentseaDir, {
      recursive: true,
      force: true,
    });
    removed.push(`History: ${agentseaDir}`);
  }

  // Optional: config
  if (removeConfig && configDirExists) {
    fs.rmSync(configDir, {
      recursive: true,
      force: true,
    });
    removed.push(`Config: ${configDir}`);
  }

  // Summary
  p.log.success("Removed:");
  for (const item of removed) {
    p.log.info(`  ${item}`);
  }

  if (cleanedFiles.length > 0) {
    p.log.info(`\nRestart your shell or run ${pc.cyan("exec $SHELL")} to apply PATH changes.`);
  }

  p.outro(`${AGENTSEA_CLI} has been uninstalled`);
}
