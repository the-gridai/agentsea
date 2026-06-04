/**
 * Regression: Codex LiteLLM wrapper/unit scripts are base64-encoded for remote
 * install. validateScriptTemplate() rejects "${" to avoid accidental JS interpolation.
 */
import { describe, expect, it } from "bun:test";
import { validateScriptTemplate } from "../../shared/agent-setup.js";

const CODEX_LITELLM_PORT = 4141;

const wrapperScript = [
  "#!/bin/bash",
  'source "$HOME/.agentsearc" 2>/dev/null',
  'export PATH="$HOME/.local/bin:$HOME/.litellm-venv/bin:$PATH"',
  'export PYTHONPATH="$HOME/.codex"',
  "export THEGRID_API_KEY",
  `exec "$HOME/.litellm-venv/bin/litellm" --config "$HOME/.codex/litellm.yaml" --host 127.0.0.1 --port ${CODEX_LITELLM_PORT}`,
].join("\n");

const unitFile = [
  "[Unit]",
  "Description=Codex LiteLLM proxy for The Grid",
  "After=network.target",
  "",
  "[Service]",
  "Type=simple",
  "ExecStart=/usr/local/bin/codex-litellm-wrapper",
  "Restart=always",
  "RestartSec=3",
  "User=__USER__",
  "Environment=HOME=__HOME__",
  "StandardOutput=append:/tmp/codex-litellm.log",
  "StandardError=append:/tmp/codex-litellm.log",
  "",
  "[Install]",
  "WantedBy=multi-user.target",
].join("\n");

const litellmYaml = `model_list:
  - model_name: "agent-standard"
    litellm_params:
      model: "openai/agent-standard"
      api_base: "https://api.thegrid.ai/v1"
      api_key: "os.environ/THEGRID_API_KEY"
      use_chat_completions_api: true
      drop_params: true

litellm_settings:
  drop_params: true
  callbacks: codex_litellm_callbacks.proxy_handler_instance
`;

const callbacksPy = `from litellm.integrations.custom_logger import CustomLogger
import json

class DropEmptyToolsHandler(CustomLogger):
    def _downgrade_json_schema(self, data: dict) -> dict:
        text = data.get("text")
        if isinstance(text, dict):
            fmt = text.get("format")
            if isinstance(fmt, dict) and fmt.get("type") == "json_schema":
                text["format"] = {"type": "json_object"}
        return data

    def _normalize_upstream_request(self, data: dict) -> dict:
        if not isinstance(data, dict):
            return data
        if data.get("tools") == []:
            data.pop("tools", None)
        if "tools" not in data and data.get("tool_choice") in ("none", "auto"):
            data.pop("tool_choice", None)
        data.pop("reasoning_effort", None)
        reasoning = data.get("reasoning")
        if isinstance(reasoning, dict):
            reasoning.pop("effort", None)
            reasoning.pop("summary", None)
            if not reasoning:
                data.pop("reasoning", None)
        return self._downgrade_json_schema(data)

    def _message_reasoning(self, msg) -> str | None:
        reasoning = getattr(msg, "reasoning_content", None)
        if reasoning:
            return reasoning
        fields = getattr(msg, "provider_specific_fields", None)
        if isinstance(fields, dict):
            nested = fields.get("reasoning_content")
            if nested:
                return nested
        return None

    def _normalize_upstream_response(self, response):
        try:
            choices = getattr(response, "choices", None)
            if not choices:
                return response
            for choice in choices:
                msg = getattr(choice, "message", None)
                if msg is None:
                    continue
                content = getattr(msg, "content", None)
                reasoning = self._message_reasoning(msg)
                if (content is None or content == "") and reasoning:
                    msg.content = reasoning
        except Exception:
            pass
        return response

    async def async_pre_call_hook(self, user_api_key_dict, cache, data, call_type):
        return self._normalize_upstream_request(data)

    async def async_pre_call_deployment_hook(self, kwargs, call_type):
        return self._normalize_upstream_request(kwargs)

    async def async_post_call_success_hook(self, data, user_api_key_dict, response):
        return self._normalize_upstream_response(response)

proxy_handler_instance = DropEmptyToolsHandler()
`;

describe("codex LiteLLM templates (wrapper encode safety + bridge config)", () => {
  it("wrapper passes validateScriptTemplate (no ${ in remote script)", () => {
    expect(() => validateScriptTemplate(wrapperScript, "codex-litellm-wrapper")).not.toThrow();
    expect(wrapperScript).not.toMatch(/\$\{/);
  });

  it("systemd unit passes validateScriptTemplate", () => {
    expect(() => validateScriptTemplate(unitFile, "codex-litellm-unit")).not.toThrow();
    expect(unitFile).not.toMatch(/\$\{/);
  });

  it("litellm.yaml wires responses?chat bridge and empty-tools callback", () => {
    expect(litellmYaml).toContain("use_chat_completions_api: true");
    expect(litellmYaml).toContain("drop_params: true");
    expect(litellmYaml).toContain("callbacks: codex_litellm_callbacks.proxy_handler_instance");
  });

  it("callback module drops empty tools and Grid-incompatible reasoning params", () => {
    expect(callbacksPy).toContain('data.get("tools") == []');
    expect(callbacksPy).toContain('data.pop("reasoning_effort", None)');
    expect(callbacksPy).toContain('fmt.get("type") == "json_schema"');
    expect(callbacksPy).toContain("async_post_call_success_hook(self, data, user_api_key_dict, response)");
  });
});
