// shared/shell.ts — Platform-aware shell execution utilities
// Enables agentsea CLI to work natively on Windows (PowerShell) without requiring bash.

import { existsSync, readFileSync } from "node:fs";

/**
 * Check if the current platform is Windows.
 * Accepts an optional override for testability (process.platform is read-only).
 */
export function isWindows(platform?: string): boolean {
  return (platform ?? process.platform) === "win32";
}

/** True when Node/Bun runs under WSL/Linux (loopback differs from Edge/Chrome on Windows host). */
export function isWslLinux(platform?: string): boolean {
  if ((platform ?? process.platform) !== "linux") {
    return false;
  }
  try {
    return existsSync("/proc/version") && readFileSync("/proc/version", "utf8").toLowerCase().includes("microsoft");
  } catch {
    return false;
  }
}

/**
 * Get the local shell executable and its command flag for the current platform.
 * - Windows: ["powershell.exe", "-Command"]
 * - macOS/Linux: ["bash", "-c"]
 *
 * Accepts an optional platform override for testability.
 */
export function getLocalShell(platform?: string): [
  string,
  string,
] {
  if (isWindows(platform)) {
    return [
      "powershell.exe",
      "-Command",
    ];
  }
  return [
    "bash",
    "-c",
  ];
}

/**
 * Get the install script URL for the current platform.
 * - Windows: install.ps1
 * - macOS/Linux: install.sh
 */
export function getInstallScriptUrl(cdnBase: string, platform?: string): string {
  if (isWindows(platform)) {
    return `${cdnBase}/cli/install.ps1`;
  }
  return `${cdnBase}/cli/install.sh`;
}

/**
 * Get the command to display for manual update instructions.
 * - Windows: PowerShell download + execute
 * - macOS/Linux: curl | bash
 */
export function getInstallCmd(cdnBase: string, platform?: string): string {
  if (isWindows(platform)) {
    const url = `${cdnBase}/cli/install.ps1`;
    return `irm ${url} | iex`;
  }
  const url = `${cdnBase}/cli/install.sh`;
  return `curl --proto '=https' -fsSL ${url} | bash`;
}

/**
 * Get the command name to locate executables on the current platform.
 * - Windows: "where"
 * - macOS/Linux: "which"
 */
export function getWhichCommand(platform?: string): string {
  if (isWindows(platform)) {
    return "where";
  }
  return "which";
}
