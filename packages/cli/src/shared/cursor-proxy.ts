// cursor-proxy.ts — The Grid proxy for Cursor CLI
// Deploys a local translation proxy that intercepts Cursor's proprietary
// ConnectRPC/protobuf protocol and translates it to The Grid OpenAI-compatible chat API.
//
// Architecture:
//   Cursor CLI → Caddy (HTTPS/H2, port 443) → split routing:
//     /agent.v1.AgentService/* → H2C Node.js (port 18645, BiDi streaming)
//     everything else          → HTTP/1.1 Node.js (port 18644, unary RPCs)
//
// /etc/hosts spoofs api2.cursor.sh → 127.0.0.1 so Cursor's hardcoded
// streaming endpoint routes to the local proxy.

import type { CloudRunner } from "./agent-setup.js";

import { homedir } from "node:os";
import { join } from "node:path";
import { wrapSshCall } from "./agent-setup.js";
import { asyncTryCatchIf, isOperationalError } from "./result.js";
import { logInfo, logStep, logWarn } from "./ui.js";
import { resolveAgentGridModelId } from "./grid-instruments.js";
import { GRID_INFERENCE_DEFAULT_MODEL_ID } from "./vendor-routing.js";
import { gridInferenceChatCompletionsUrl } from "./grid-api.js";

/** Human-readable label for Cursor's model picker footer (Grid catalogue id → display name). */
export function cursorGridModelDisplayName(modelId: string): string {
  const id = modelId.trim();
  if (!id) return "Agent Standard";
  if (id === GRID_INFERENCE_DEFAULT_MODEL_ID) return "Agent Standard";
  const tail = id.includes("/") ? id.slice(id.lastIndexOf("/") + 1) : id;
  return tail
    .split(/[-_.]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// ── Protobuf helpers (used in proxy scripts) ────────────────────────────────

// These are string-embedded in the proxy scripts that run on the VM.
// They implement minimal protobuf encoding for the specific message types
// Cursor CLI expects: AgentServerMessage, ModelDetails, etc.
// Model id/display are read from GRID_MODEL_ID (+ optional GRID_MODEL_DISPLAY_NAME) at runtime.

const PROTO_HELPERS = `
function ev(v){const b=[];while(v>0x7f){b.push((v&0x7f)|0x80);v>>>=7;}b.push(v&0x7f);return Buffer.from(b);}
function es(f,s){const sb=Buffer.from(s);return Buffer.concat([ev((f<<3)|2),ev(sb.length),sb]);}
function em(f,p){return Buffer.concat([ev((f<<3)|2),ev(p.length),p]);}
function cf(p){const f=Buffer.alloc(5+p.length);f[0]=0;f.writeUInt32BE(p.length,1);p.copy(f,5);return f;}
function ct(){const j=Buffer.from("{}");const t=Buffer.alloc(5+j.length);t[0]=2;t.writeUInt32BE(j.length,1);j.copy(t,5);return t;}
function tdf(t){return cf(em(1,em(1,es(1,t))));}
function tef(){return cf(em(1,em(14,Buffer.from([8,10,16,5]))));}
function bmd(id,n){return Buffer.concat([es(1,id),es(3,id),es(4,n),es(5,n)]);}
function formatGridModelDisplayName(id){
  if(!id)return"Agent Standard";
  if(id==="agent-standard")return"Agent Standard";
  const tail=id.includes("/")?id.slice(id.lastIndexOf("/")+1):id;
  return tail.split(/[-_.]/).filter(Boolean).map(function(w){return w.charAt(0).toUpperCase()+w.slice(1);}).join(" ");
}
const GRID_MODEL_ID=process.env.GRID_MODEL_ID||"code-prime";
const GRID_MODEL_DISPLAY=process.env.GRID_MODEL_DISPLAY_NAME||formatGridModelDisplayName(GRID_MODEL_ID);
function bmr(){return Buffer.concat([[GRID_MODEL_ID,GRID_MODEL_DISPLAY]].map(function(pair){return em(1,bmd(pair[0],pair[1]));}));}
function bdr(){return em(1,bmd(GRID_MODEL_ID,GRID_MODEL_DISPLAY));}
function xstr(buf,out){let o=0;while(o<buf.length){let t=0,s=0;while(o<buf.length){const b=buf[o++];t|=(b&0x7f)<<s;s+=7;if(!(b&0x80))break;}const wt=t&7;if(wt===0){while(o<buf.length&&buf[o++]&0x80);}else if(wt===2){let l=0,s=0;while(o<buf.length){const b=buf[o++];l|=(b&0x7f)<<s;s+=7;if(!(b&0x80))break;}const d=buf.slice(o,o+l);o+=l;const st=d.toString("utf8");if(/^[\\x20-\\x7e]+$/.test(st))out.push(st);else try{xstr(d,out);}catch(e){}}else break;}}
`.trim();

// ── Unary backend (HTTP/1.1, port 18644) ─────────────────────────────────────

function getUnaryScript(): string {
  return `import http from "node:http";
import { appendFileSync } from "node:fs";
const LOG=process.env.HOME+"/.cursor/proxy/unary.log";
function log(msg){try{appendFileSync(LOG,new Date().toISOString()+" "+msg+"\\n");}catch(e){}}

${PROTO_HELPERS}

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("error", (e) => log("REQ ERR: " + e.message));
  req.on("end", () => {
    try {
      const buf = Buffer.concat(chunks);
      const ct = req.headers["content-type"] || "";
      const url = req.url || "";
      log(req.method + " " + url + " [" + buf.length + "B]");

      // Auth — return fake JWT
      if (url === "/auth/exchange_user_api_key") {
        res.writeHead(200, {"content-type":"application/json"});
        res.end(JSON.stringify({
          accessToken: "eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJzcGF3bl9wcm94eSJ9.ok",
          refreshToken: "agentsea-proxy-refresh",
          authId: "user_agentsea_proxy",
        }));
        return;
      }

      // Analytics — accept silently
      if (url.includes("Analytics") || url.includes("TrackEvents") || url.includes("SubmitLogs")) {
        res.writeHead(200, {"content-type":"application/json"});
        res.end('{"success":true}');
        return;
      }

      // Model list
      if (url.includes("GetUsableModels")) {
        res.writeHead(200, {"content-type":"application/proto"});
        res.end(bmr());
        return;
      }

      // Default model
      if (url.includes("GetDefaultModelForCli")) {
        res.writeHead(200, {"content-type":"application/proto"});
        res.end(bdr());
        return;
      }

      // OTEL traces
      if (url.includes("/v1/traces")) {
        res.writeHead(200, {"content-type":"application/json"});
        res.end("{}");
        return;
      }

      // Other proto endpoints — empty response
      if (ct.includes("proto")) {
        res.writeHead(200, {"content-type": ct.includes("connect") ? "application/connect+proto" : "application/proto"});
        res.end();
        return;
      }

      res.writeHead(200);
      res.end("ok");
    } catch(e) {
      log("ERR: " + e.message);
      try { res.writeHead(500); res.end(); } catch(e2) {}
    }
  });
});
server.on("error", (e) => log("SVR: " + e.message));
server.listen(18644, "127.0.0.1", () => log("Cursor proxy (unary) on 18644"));
`;
}

// ── BiDi backend (H2C, port 18645) ──────────────────────────────────────────

function getBidiScript(gridChatCompletionsUrl: string): string {
  const gridChatUrl = gridChatCompletionsUrl.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `import http2 from "node:http2";
import { appendFileSync } from "node:fs";
const LOG=process.env.HOME+"/.cursor/proxy/bidi.log";
function log(msg){try{appendFileSync(LOG,new Date().toISOString()+" "+msg+"\\n");}catch(e){}}

${PROTO_HELPERS}

const GRID_API_KEY = process.env.THEGRID_API_KEY || "";

const server = http2.createServer();
server.on("stream", (stream, headers) => {
  const path = headers[":path"] || "";
  log("STREAM " + path);

  // BiDi: respond on first data frame, don't wait for stream end
  let gotData = false;
  stream.on("data", (chunk) => {
    if (gotData) return;
    gotData = true;
    log("  Data [" + chunk.length + "B]");

    // Extract user message from protobuf
    let msg = "hello";
    const strs = [];
    try { xstr(chunk.length > 5 ? chunk.slice(5) : chunk, strs); } catch(e) {}
    for (const s of strs) {
      if (s.length > 0 && s.length < 500 && !s.match(/^[a-f0-9]{8}-/)) { msg = s; break; }
    }
    log("  User: " + msg);

    stream.respond({":status": 200, "content-type": "application/connect+proto"});

    if (GRID_API_KEY) {
      forwardGridChatCompletion(msg, stream);
    } else {
      stream.write(tdf("Cursor proxy is working but THEGRID_API_KEY is not set. "));
      stream.write(tdf("Please configure the API key to connect to real models."));
      stream.write(tef());
      stream.end(ct());
    }
  });
  stream.on("error", (e) => {
    if (!e.message.includes("cancel")) log("  STREAM ERR: " + e.message);
  });
});

async function forwardGridChatCompletion(msg, stream) {
  try {
    const r = await fetch("${gridChatUrl}", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + GRID_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.GRID_MODEL_ID || "code-prime",
        messages: [{ role: "user", content: msg }],
        stream: true,
      }),
      redirect: "follow",
    });

    if (!r.ok) {
      const errText = await r.text().catch(() => "");
      stream.write(tdf("The Grid API error " + r.status + ": " + errText.slice(0, 200)));
      stream.write(tef());
      stream.end(ct());
      return;
    }

    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\\n");
      buf = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") continue;
        try {
          const json = JSON.parse(data);
          const content = json.choices?.[0]?.delta?.content;
          if (content) stream.write(tdf(content));
        } catch(e) {}
      }
    }

    stream.write(tef());
    stream.end(ct());
    log("  Grid chat stream complete");
  } catch(e) {
    log("  Grid chat error: " + e.message);
    try {
      stream.write(tdf("Proxy error: " + e.message));
      stream.write(tef());
      stream.end(ct());
    } catch(e2) {}
  }
}

server.on("error", (e) => log("SVR: " + e.message));
server.listen(18645, "127.0.0.1", () => log("Cursor proxy (bidi) on 18645"));
`;
}

// ── Caddyfile ───────────────────────────────────────────────────────────────

function getCaddyfile(): string {
  return `{
\tlocal_certs
\tauto_https disable_redirects
}

https://api2.cursor.sh,
https://api2geo.cursor.sh,
https://api2direct.cursor.sh,
https://agentn.api5.cursor.sh,
https://agent.api5.cursor.sh {
\ttls internal

\thandle /agent.v1.AgentService/* {
\t\treverse_proxy h2c://127.0.0.1:18645 {
\t\t\tflush_interval -1
\t\t}
\t}

\thandle {
\t\treverse_proxy http://127.0.0.1:18644 {
\t\t\tflush_interval -1
\t\t}
\t}
}
`;
}

// ── Hosts entries ───────────────────────────────────────────────────────────

/** HTTPS endpoint Cursor CLI uses once Caddy + /etc/hosts are configured. */
export const CURSOR_PROXY_HTTPS_ENDPOINT = "https://api2.cursor.sh";

export const CURSOR_PROXY_DOMAINS = [
  "api2.cursor.sh",
  "api2geo.cursor.sh",
  "api2direct.cursor.sh",
  "agentn.api5.cursor.sh",
  "agent.api5.cursor.sh",
] as const;

const CURSOR_DOMAINS = [...CURSOR_PROXY_DOMAINS];

/** Shell snippet: install Caddy to ~/.local/bin and grant CAP_NET_BIND_SERVICE for :443. */
export function cursorCaddyInstallScript(): string {
  return [
    'export PATH="$HOME/.local/bin:$PATH"',
    'if ! command -v caddy >/dev/null 2>&1; then',
    '  mkdir -p "$HOME/.local/bin"',
    '  echo "Installing Caddy to ~/.local/bin..."',
    '  curl -sf "https://caddyserver.com/api/download?os=linux&arch=amd64" -o "$HOME/.local/bin/caddy"',
    '  chmod +x "$HOME/.local/bin/caddy"',
    "fi",
    "caddy version",
    '_sudo=""; [ "$(id -u)" != "0" ] && _sudo="sudo"',
    'if $_sudo getcap "$HOME/.local/bin/caddy" 2>/dev/null | grep -q cap_net_bind_service; then',
    '  echo "caddy-setcap=ok"',
    'elif $_sudo setcap cap_net_bind_service=+ep "$HOME/.local/bin/caddy" 2>/dev/null; then',
    '  echo "caddy-setcap=ok"',
    "else",
    '  echo "caddy-setcap=skipped"',
    "fi",
  ].join("\n");
}

/** Shell snippet: map Cursor API hostnames to 127.0.0.1 in /etc/hosts (requires sudo). */
export function cursorHostsSetupScript(): string {
  return [
    '_sudo=""; [ "$(id -u)" != "0" ] && _sudo="sudo"',
    'if grep -q "api2\\.cursor\\.sh" /etc/hosts 2>/dev/null; then',
    '  echo "hosts-spoof=ok"',
    "  exit 0",
    "fi",
    'if ! $_sudo test -w /etc/hosts 2>/dev/null; then',
    '  echo "hosts-spoof=FAILED: /etc/hosts not writable (sudo required)" >&2',
    "  exit 1",
    "fi",
    '$_sudo sed -i "/cursor\\.sh/d" /etc/hosts 2>/dev/null || true',
    `$_sudo sh -c 'echo "127.0.0.1 ${CURSOR_DOMAINS.join(" ")}" >> /etc/hosts'`,
    'echo "hosts-spoof=ok"',
  ].join("\n");
}

function cursorCaddyStartScript(): string {
  const portCheck = (port: number) =>
    `ss -tln 2>/dev/null | grep -q ":${port} " || nc -z 127.0.0.1 ${port} 2>/dev/null`;
  return [
    'export PATH="$HOME/.local/bin:$PATH"',
    'export XDG_DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"',
    'export XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"',
    'mkdir -p "$HOME/.cursor/proxy"',
    `if ${portCheck(443)}; then echo "Caddy already running"; exit 0; fi`,
    'caddy stop --config "$HOME/.cursor/proxy/Caddyfile" 2>/dev/null || true',
    'if caddy start --config "$HOME/.cursor/proxy/Caddyfile" --adapter caddyfile >> "$HOME/.cursor/proxy/caddy.log" 2>&1; then',
    '  echo "caddy-start=ok"',
    "  exit 0",
    "fi",
    '_sudo=""; [ "$(id -u)" != "0" ] && _sudo="sudo"',
    'if $_sudo "$HOME/.local/bin/caddy" start --config "$HOME/.cursor/proxy/Caddyfile" --adapter caddyfile >> "$HOME/.cursor/proxy/caddy.log" 2>&1; then',
    '  echo "caddy-start=sudo-ok"',
    "  exit 0",
    "fi",
    'echo "caddy-start=FAILED" >&2; tail -20 "$HOME/.cursor/proxy/caddy.log" 2>/dev/null >&2 || true',
    "exit 1",
  ].join("\n");
}

// ── Deployment ──────────────────────────────────────────────────────────────

/**
 * Remote shell: materialize ~/.cursor/proxy/proxy.env from ~/.agentsearc.
 * .agentsearc uses `export KEY='value'` lines — never grep ^KEY= (misses the export prefix).
 */
export function cursorProxyEnvFileScript(): string {
  return [
    "mkdir -p ~/.cursor/proxy",
    "set -a",
    ". ~/.agentsearc 2>/dev/null || true",
    "set +a",
    'if [ -z "${THEGRID_API_KEY:-}" ]; then echo "THEGRID_API_KEY missing from ~/.agentsearc" >&2; exit 1; fi',
    'GRID_MODEL_ID="${GRID_MODEL_ID:-code-prime}"',
    'GRID_MODEL_DISPLAY_NAME="${GRID_MODEL_DISPLAY_NAME:-}"',
    "printf 'THEGRID_API_KEY=%s\\nGRID_MODEL_ID=%s\\nGRID_MODEL_DISPLAY_NAME=%s\\n' \\",
    '  "$THEGRID_API_KEY" "$GRID_MODEL_ID" "$GRID_MODEL_DISPLAY_NAME" > ~/.cursor/proxy/proxy.env',
    "chmod 600 ~/.cursor/proxy/proxy.env",
  ].join("\n");
}

/**
 * Deploy the Cursor proxy infrastructure onto the remote VM.
 * Installs Caddy, uploads proxy scripts, writes Caddyfile, configures /etc/hosts.
 * Proxy scripts read GRID_MODEL_ID from the environment (written to ~/.agentsearc during provision).
 */
export async function setupCursorProxy(runner: CloudRunner, modelId?: string): Promise<void> {
  logStep("Deploying Cursor→The Grid proxy...");
  const gridModel = resolveAgentGridModelId("cursor", modelId);
  logInfo(`Cursor proxy model: ${gridModel} (${cursorGridModelDisplayName(gridModel)})`);

  const caddyResult = await asyncTryCatchIf(isOperationalError, () =>
    wrapSshCall(runner.runServer(cursorCaddyInstallScript(), 60)),
  );
  if (!caddyResult.ok) {
    logWarn("Caddy install failed — Cursor proxy will not work");
    return;
  }
  logInfo("Caddy available");

  // 2. Upload proxy scripts via base64
  const unaryB64 = Buffer.from(getUnaryScript()).toString("base64");
  const bidiB64 = Buffer.from(getBidiScript(gridInferenceChatCompletionsUrl())).toString("base64");
  const caddyfileB64 = Buffer.from(getCaddyfile()).toString("base64");

  for (const b64 of [
    unaryB64,
    bidiB64,
    caddyfileB64,
  ]) {
    if (!/^[A-Za-z0-9+/=]+$/.test(b64)) {
      throw new Error("Unexpected characters in base64 output");
    }
  }

  const deployScript = [
    "mkdir -p ~/.cursor/proxy",
    `printf '%s' '${unaryB64}' | base64 -d > ~/.cursor/proxy/unary.mjs`,
    `printf '%s' '${bidiB64}' | base64 -d > ~/.cursor/proxy/bidi.mjs`,
    `printf '%s' '${caddyfileB64}' | base64 -d > ~/.cursor/proxy/Caddyfile`,
    "chmod 600 ~/.cursor/proxy/*.mjs",
    "chmod 644 ~/.cursor/proxy/Caddyfile",
  ].join(" && ");

  await wrapSshCall(runner.runServer(deployScript));
  logInfo("Proxy scripts deployed");

  const hostsResult = await asyncTryCatchIf(isOperationalError, () =>
    wrapSshCall(runner.runServer(cursorHostsSetupScript())),
  );
  if (hostsResult.ok) {
    logInfo("Hosts spoofing configured for api2.cursor.sh → 127.0.0.1");
  } else {
    logWarn(
      "Could not configure /etc/hosts — run: sudo sh -c 'echo \"127.0.0.1 api2.cursor.sh\" >> /etc/hosts'",
    );
  }

  // 4. Trust Caddy internal CA (user-level when possible)
  const trustScript = 'export PATH="$HOME/.local/bin:$PATH"; caddy trust 2>/dev/null || true';
  await wrapSshCall(runner.runServer(trustScript, 30));
  logInfo("Caddy CA trust attempted");

  // 5. Write Cursor CLI config (permissions + PATH)
  const configScript = [
    "mkdir -p ~/.cursor/rules",
    `cat > ~/.cursor/cli-config.json << 'CONF'
{"version":1,"permissions":{"allow":["Shell(*)","Read(*)","Write(*)","WebFetch(*)","Mcp(*)"],"deny":[]}}
CONF`,
    "chmod 600 ~/.cursor/cli-config.json",
    'grep -q ".local/bin" ~/.bashrc 2>/dev/null || printf \'\\nexport PATH="$HOME/.local/bin:$PATH"\\n\' >> ~/.bashrc',
    'grep -q ".local/bin" ~/.zshrc 2>/dev/null || printf \'\\nexport PATH="$HOME/.local/bin:$PATH"\\n\' >> ~/.zshrc',
  ].join(" && ");
  await wrapSshCall(runner.runServer(configScript));
  logInfo("Cursor CLI configured");
}

function cursorProxyWrapperScript(role: "unary" | "bidi" | "caddy"): string {
  if (role === "caddy") {
    return [
      "#!/bin/bash",
      'export PATH="$HOME/.local/bin:$PATH"',
      'export XDG_DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"',
      'export XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"',
      'exec caddy run --config "$HOME/.cursor/proxy/Caddyfile" --adapter caddyfile',
    ].join("\n");
  }
  const script = role === "unary" ? "unary.mjs" : "bidi.mjs";
  return [
    "#!/bin/bash",
    'set -a; . "$HOME/.cursor/proxy/proxy.env" 2>/dev/null; set +a',
    'NODE=$(find "$HOME/.local/share/cursor-agent" -name node -type f 2>/dev/null | head -1)',
    '[ -z "$NODE" ] && NODE=$(command -v node)',
    '[ -z "$NODE" ] && exit 1',
    `exec "$NODE" "$HOME/.cursor/proxy/${script}"`,
  ].join("\n");
}

/**
 * Start the Cursor proxy services (Caddy + two Node.js backends).
 * Local mode uses runner.startService so proxies survive the ephemeral shell.
 */
export async function startCursorProxy(runner: CloudRunner): Promise<void> {
  logStep("Starting Cursor proxy services...");

  const portCheck = (port: number) =>
    `ss -tln 2>/dev/null | grep -q ":${port} " || nc -z 127.0.0.1 ${port} 2>/dev/null`;

  const wrappers: { name: string; role: "unary" | "bidi" | "caddy"; log: string }[] = [
    { name: "cursor-proxy-unary", role: "unary", log: "$HOME/.cursor/proxy/unary.log" },
    { name: "cursor-proxy-bidi", role: "bidi", log: "$HOME/.cursor/proxy/bidi.log" },
    { name: "cursor-proxy-caddy", role: "caddy", log: "$HOME/.cursor/proxy/caddy.log" },
  ];

  const wrapperB64s = wrappers.map((w) => Buffer.from(cursorProxyWrapperScript(w.role)).toString("base64"));
  for (const b64 of wrapperB64s) {
    if (!/^[A-Za-z0-9+/=]+$/.test(b64)) {
      throw new Error("Unexpected characters in base64 output");
    }
  }

  const installWrappers = [
    cursorProxyEnvFileScript(),
    'mkdir -p "$HOME/.local/bin" "$HOME/.cursor/proxy"',
    ...wrappers.map(
      (w, i) =>
        `printf '%s' '${wrapperB64s[i]}' | base64 -d > /tmp/${w.name}.tmp && chmod +x /tmp/${w.name}.tmp && mv /tmp/${w.name}.tmp "$HOME/.local/bin/${w.name}"`,
    ),
  ].join("\n");

  if (runner.startService) {
    const home = process.env.HOME || homedir();
    await wrapSshCall(runner.runServer(installWrappers, 60));
    for (const w of wrappers) {
      const logPath = join(home, ".cursor/proxy", `${w.role}.log`);
      await runner.startService(`exec "$HOME/.local/bin/${w.name}"`, logPath);
    }
    const waitScript = [
      "elapsed=0; while [ $elapsed -lt 45 ]; do",
      `  if ${portCheck(443)} && ${portCheck(18644)} && ${portCheck(18645)}; then`,
      '    echo "Cursor proxy ready after ${elapsed}s"',
      "    exit 0",
      "  fi",
      "  sleep 1; elapsed=$((elapsed + 1))",
      "done",
      'echo "Cursor proxy failed to start"; exit 1',
    ].join("\n");
    const result = await asyncTryCatchIf(isOperationalError, () => wrapSshCall(runner.runServer(waitScript, 60)));
    if (result.ok) {
      logInfo("Cursor proxy started");
    } else {
      logWarn("Cursor proxy start failed — agent may not work");
    }
    return;
  }

  const script = [
    installWrappers,
    'export PATH="$HOME/.local/bin:$PATH"',
    `if ${portCheck(18644)}; then echo "Unary backend already running"; else`,
    '  setsid "$HOME/.local/bin/cursor-proxy-unary" >> "$HOME/.cursor/proxy/unary.log" 2>&1 < /dev/null &',
    "fi",
    `if ${portCheck(18645)}; then echo "BiDi backend already running"; else`,
    '  setsid "$HOME/.local/bin/cursor-proxy-bidi" >> "$HOME/.cursor/proxy/bidi.log" 2>&1 < /dev/null &',
    "fi",
    cursorCaddyStartScript(),
    "elapsed=0; while [ $elapsed -lt 45 ]; do",
    `  if ${portCheck(443)} && ${portCheck(18644)} && ${portCheck(18645)}; then`,
    '    echo "Cursor proxy ready after ${elapsed}s"',
    "    exit 0",
    "  fi",
    "  sleep 1; elapsed=$((elapsed + 1))",
    "done",
    'echo "Cursor proxy failed to start"; exit 1',
  ].join("\n");

  const result = await asyncTryCatchIf(isOperationalError, () => wrapSshCall(runner.runServer(script, 90)));
  if (result.ok) {
    logInfo("Cursor proxy started");
  } else {
    logWarn("Cursor proxy start failed — agent may not work");
  }
}
