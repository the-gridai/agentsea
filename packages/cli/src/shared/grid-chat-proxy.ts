// Minimal local HTTP proxy: forwards OpenAI chat/completions to The Grid with redirect follow.

import { resolveGridInferenceApiBase } from "./grid-api.js";
import { asyncTryCatchIf, isOperationalError } from "./result.js";
import { logInfo, logStep, logWarn } from "./ui.js";

type GridChatProxyRunner = {
  runServer: (cmd: string, timeoutSec?: number) => Promise<unknown>;
  startService?: (cmd: string, logPath: string) => Promise<void>;
};

export const GRID_CHAT_PROXY_DEFAULT_PORT = 4143;

export function gridChatProxyListenUrl(port: number): string {
  return `http://127.0.0.1:${port}`;
}

export function gridChatProxyCompletionsUrl(port: number): string {
  return `${gridChatProxyListenUrl(port)}/v1/chat/completions`;
}

export function gridChatProxyHealthCheck(port: number): string {
  return `curl -sf "${gridChatProxyListenUrl(port)}/health" >/dev/null 2>&1`;
}

export function buildGridChatProxyScript(upstreamBase = resolveGridInferenceApiBase()): string {
  const upstream = upstreamBase.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `import http from "node:http";
const UPSTREAM="${upstream}";
const PORT=Number(process.env.GRID_CHAT_PROXY_PORT||"${GRID_CHAT_PROXY_DEFAULT_PORT}");
const KEY=process.env.THEGRID_API_KEY||"";
http.createServer(async(req,res)=>{
  if(req.method==="GET"&&req.url==="/health"){res.writeHead(200);res.end("ok");return;}
  if(req.method!=="POST"||!req.url?.startsWith("/v1/chat/completions")){res.writeHead(404);res.end();return;}
  const chunks=[];for await(const c of req)chunks.push(c);
  try{
    const r=await fetch(UPSTREAM+"/chat/completions",{method:"POST",headers:{Authorization:"Bearer "+KEY,"Content-Type":req.headers["content-type"]||"application/json"},body:Buffer.concat(chunks).toString("utf8"),redirect:"follow"});
    const out=Buffer.from(await r.arrayBuffer());
    res.writeHead(r.status,{"content-type":r.headers.get("content-type")||"application/json"});
    res.end(out);
  }catch(e){res.writeHead(502);res.end("proxy error: "+(e?.message||e));}
}).listen(PORT,"127.0.0.1",()=>console.log("grid-chat-proxy:"+PORT));
`;
}

export async function deployGridChatProxy(
  runner: GridChatProxyRunner,
  opts: { scriptPath: string },
): Promise<void> {
  const b64 = Buffer.from(buildGridChatProxyScript()).toString("base64");
  const path = opts.scriptPath.replace(/^~/, "$HOME");
  await runner.runServer(
    `mkdir -p "$(dirname ${path})" && printf '%s' '${b64}' | base64 -d > ${path} && chmod 600 ${path}`,
  );
}

export async function startGridChatProxy(
  runner: GridChatProxyRunner,
  opts: { name: string; port: number; scriptPath: string; logPath: string; wrapperName: string },
): Promise<void> {
  logStep(`Starting ${opts.name} Grid chat proxy on :${opts.port}...`);
  const wrapper = [
    "#!/bin/bash",
    'source "$HOME/.agentsearc" 2>/dev/null',
    "export THEGRID_API_KEY",
    `export GRID_CHAT_PROXY_PORT=${opts.port}`,
    'NODE=$(command -v node 2>/dev/null || find "$HOME/.local/share/cursor-agent" -name node -type f 2>/dev/null | head -1)',
    '[ -z "$NODE" ] && exit 1',
    'exec "$NODE" "$HOME/.junie/grid-chat-proxy.mjs"',
  ].join("\n");
  const b64 = Buffer.from(wrapper).toString("base64");
  const health = gridChatProxyHealthCheck(opts.port);
  const prep = [
    "source ~/.agentsearc 2>/dev/null",
    'test -n "$THEGRID_API_KEY" || exit 1',
    "printf '%s' '" + b64 + "' | base64 -d > /tmp/w.tmp && chmod +x /tmp/w.tmp",
    'mkdir -p "$HOME/.local/bin" && mv /tmp/w.tmp "$HOME/.local/bin/' + opts.wrapperName + '"',
    `_old=$(lsof -ti tcp:${opts.port} 2>/dev/null); [ -n "$_old" ] && kill $_old 2>/dev/null || true`,
    "sleep 1",
  ].join("\n");

  if (runner.startService) {
    await runner.runServer(prep, 60);
    await runner.startService(`exec "$HOME/.local/bin/${opts.wrapperName}"`, opts.logPath);
  } else {
    await runner.runServer(
      [
        prep,
        `setsid "$HOME/.local/bin/${opts.wrapperName}" >> ${opts.logPath} 2>&1 < /dev/null &`,
        "elapsed=0; while [ $elapsed -lt 60 ]; do",
        `  if ${health}; then exit 0; fi`,
        "  sleep 1; elapsed=$((elapsed + 1)); done; exit 1",
      ].join("\n"),
      90,
    );
  }
  const ready = await asyncTryCatchIf(isOperationalError, () =>
    runner.runServer(
      `elapsed=0; while [ $elapsed -lt 60 ]; do if ${health}; then exit 0; fi; sleep 1; elapsed=$((elapsed+1)); done; exit 1`,
      70,
    ),
  );
  if (ready.ok) logInfo(`${opts.name} Grid chat proxy on :${opts.port}`);
  else logWarn(`${opts.name} grid-chat-proxy health check failed`);
}
