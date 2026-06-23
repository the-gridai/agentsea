import pc from "picocolors";
import {
  createGridConsumptionKeyViaOAuth,
  getGridOAuthStatus,
  listGridConsumptionKeysViaOAuth,
  loginWithGridOAuthAndKey,
  logoutGridOAuth,
  revokeGridConsumptionKeyViaOAuth,
} from "../shared/oauth.js";
import { logAlwaysInfo, logAlwaysStep } from "../shared/ui.js";

function showAuthUsage(): void {
  console.log(
    [
      `Usage: ${pc.cyan("agentsea auth <login|status|logout|keys>")}`,
      "",
      `  ${pc.cyan("agentsea auth login")}              Authenticate with Grid OAuth and create/reuse a consumption key`,
      `  ${pc.cyan("agentsea auth status")}             Show OAuth session and saved-key state`,
      `  ${pc.cyan("agentsea auth logout")}             Revoke session tokens and clear local auth state`,
      `  ${pc.cyan("agentsea auth keys")}               List the consumption API keys on your Grid account`,
      `  ${pc.cyan("agentsea auth keys create [name]")} Create a new consumption API key`,
      `  ${pc.cyan("agentsea auth keys revoke <id>")}   Revoke a consumption API key by id`,
    ].join("\n"),
  );
}

function buildDefaultKeyName(): string {
  return `agentsea-cli-${Date.now().toString(36)}`;
}

async function cmdAuthKeys(args: string[]): Promise<void> {
  const action = args[0]?.trim() ?? "list";

  if (action === "list" || action === "ls") {
    const keys = await listGridConsumptionKeysViaOAuth();
    if (keys.length === 0) {
      logAlwaysInfo("No consumption API keys found on this Grid account.");
      return;
    }
    console.log(pc.bold("Grid consumption API keys"));
    for (const key of keys) {
      const state = key.is_active ? pc.green("active") : pc.dim("inactive");
      const expires = key.expires_at ? ` ${pc.dim(`· expires ${key.expires_at}`)}` : "";
      console.log(`  ${key.name}  [${state}]${expires}`);
      console.log(`    ${pc.dim(`prefix ${key.key_prefix}… · id ${key.id}`)}`);
    }
    return;
  }

  if (action === "create") {
    const name = args.slice(1).join(" ").trim() || buildDefaultKeyName();
    const key = await createGridConsumptionKeyViaOAuth(name);
    logAlwaysStep(`Created consumption API key ${pc.bold(key.name)}.`);
    if (key.key) {
      console.log("");
      console.log(`  ${pc.bold(key.key)}`);
      console.log("");
      logAlwaysInfo("Copy this key now — the full secret is shown only once.");
    } else {
      logAlwaysInfo("Key created, but the API did not return the secret. Manage it at app.thegrid.ai.");
    }
    return;
  }

  if (action === "revoke" || action === "rm" || action === "delete") {
    const keyId = args[1]?.trim() ?? "";
    if (!keyId) {
      console.error(pc.red(`Usage: ${pc.cyan("agentsea auth keys revoke <key-id>")}`));
      console.error(pc.dim(`Run ${pc.cyan("agentsea auth keys")} to list key ids.`));
      process.exit(1);
    }
    await revokeGridConsumptionKeyViaOAuth(keyId);
    logAlwaysStep(`Revoked consumption API key ${pc.bold(keyId)}.`);
    return;
  }

  console.error(pc.red(`Unknown keys action: ${pc.bold(action)}`));
  console.error(pc.dim(`Use ${pc.cyan("agentsea auth keys <list|create|revoke>")}.`));
  process.exit(1);
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

  if (subcommand === "keys" || subcommand === "key") {
    await cmdAuthKeys(args.slice(1));
    return;
  }

  console.error(pc.red(`Unknown auth subcommand: ${pc.bold(subcommand)}`));
  console.error(pc.dim(`Use ${pc.cyan("agentsea auth help")} for usage.`));
  showAuthUsage();
  process.exit(1);
}
