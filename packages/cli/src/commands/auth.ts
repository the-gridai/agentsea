import pc from "picocolors";
import { getGridOAuthStatus, loginWithGridOAuthAndKey, logoutGridOAuth } from "../shared/oauth.js";
import { logAlwaysInfo, logAlwaysStep } from "../shared/ui.js";

function showAuthUsage(): void {
  console.log(
    [
      `Usage: ${pc.cyan("agentsea auth <login|status|logout>")}`,
      "",
      `  ${pc.cyan("agentsea auth login")}   Authenticate with Grid OAuth and create/reuse a consumption key`,
      `  ${pc.cyan("agentsea auth status")}  Show OAuth session and saved-key state`,
      `  ${pc.cyan("agentsea auth logout")}  Revoke session tokens and clear local auth state`,
    ].join("\n"),
  );
}

export async function cmdAuth(args: string[]): Promise<void> {
  const subcommand = args[0]?.trim() ?? "";
  if (!subcommand || subcommand === "help" || subcommand === "--help" || subcommand === "-h") {
    showAuthUsage();
    return;
  }

  if (subcommand === "login") {
    await loginWithGridOAuthAndKey();
    logAlwaysStep("Grid OAuth login complete.");
    logAlwaysInfo("Saved OAuth session + consumption API key for future AgentSea runs.");
    return;
  }

  if (subcommand === "status") {
    const status = getGridOAuthStatus();
    console.log(`${pc.bold("Grid OAuth status")}`);
    console.log(`  session: ${status.sessionPresent ? pc.green("present") : pc.yellow("missing")}`);
    console.log(`  keys:manage scope: ${status.hasKeysManageScope ? pc.green("yes") : pc.yellow("no")}`);
    console.log(`  saved API key: ${status.hasSavedApiKey ? pc.green("present") : pc.yellow("missing")}`);
    if (status.oauthBaseUrl) {
      console.log(`  oauth base: ${status.oauthBaseUrl}`);
    }
    if (status.expiresAt) {
      console.log(`  token expires: ${status.expiresAt}`);
    }
    if (status.scopes.length > 0) {
      console.log(`  scopes: ${status.scopes.join(", ")}`);
    }
    console.log(`  provisioning OAuth auto-attempt: ${status.oauthConfigured ? "enabled" : "disabled"}`);
    if (status.oauthConfigured) {
      console.log(`    ${pc.dim("Set AGENTSEA_GRID_OAUTH=0 to disable OAuth auto-acquisition in provisioning.")}`);
    } else {
      console.log(`    ${pc.dim("Set AGENTSEA_GRID_OAUTH=1 to re-enable OAuth auto-acquisition in provisioning.")}`);
    }
    return;
  }

  if (subcommand === "logout") {
    await logoutGridOAuth();
    logAlwaysInfo("Cleared local Grid OAuth session and saved key.");
    return;
  }

  console.error(pc.red(`Unknown auth subcommand: ${pc.bold(subcommand)}`));
  console.error(pc.dim(`Use ${pc.cyan("agentsea auth help")} for usage.`));
  showAuthUsage();
  process.exit(1);
}
