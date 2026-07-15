import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { registryUrl, runCommand } from "./lib/package-consumer-smoke.mjs";

const repoRoot = resolve(import.meta.dirname, "..");
const clientPackage = "mcp";
const clientVersion = "1.28.1";
const serverPackage = "@modelcontextprotocol/server-filesystem";
const serverVersion = "2026.7.4";
const fixturePath = "fixtures/compatibility/external-filesystem-python-stdio.summary.json";
const update = process.argv.includes("--update");
const pythonCommand = process.env.MSP_PYTHON || (process.platform === "win32" ? "python" : "python3");
const tempDir = mkdtempSync(join(tmpdir(), "msp-external-python-fixture-"));

try {
  installFilesystemServer(tempDir);
  const venvPython = installPythonClient(tempDir);
  const actual = runExternalFixture(tempDir, venvPython);
  const expectedPath = join(repoRoot, fixturePath);
  if (update || !existsSync(expectedPath)) {
    writeFileSync(expectedPath, `${JSON.stringify(actual, null, 2)}\n`, "utf8");
    process.exit(0);
  }

  const expected = JSON.parse(readFileSync(expectedPath, "utf8"));
  if (stableJson(forCompatibilityComparison(actual)) !== stableJson(forCompatibilityComparison(expected))) {
    console.error(`${fixturePath}: external Python MCP fixture drifted from current implementation`);
    console.error("Run `node scripts/check-external-python-mcp-fixture.mjs --update` after reviewing the drift.");
    process.exit(1);
  }
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

function forCompatibilityComparison(summary) {
  const comparable = structuredClone(summary);
  if (comparable?.scenarios?.audit) {
    delete comparable.scenarios.audit.stderrLineCount;
  }
  return comparable;
}

function installFilesystemServer(cwd) {
  const userConfigPath = join(cwd, ".npmrc");
  const globalConfigPath = join(cwd, ".npmrc-global");
  writeFileSync(userConfigPath, "", "utf8");
  writeFileSync(globalConfigPath, "", "utf8");
  writeFileSync(
    join(cwd, "package.json"),
    `${JSON.stringify(
      {
        private: true,
        type: "module",
        dependencies: {
          [serverPackage]: serverVersion
        }
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  const npmCommand = process.platform === "win32" ? process.execPath : "npm";
  const npmCommandPrefix =
    process.platform === "win32" ? [join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js")] : [];
  runCommand(
    npmCommand,
    [
      ...npmCommandPrefix,
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      `${serverPackage}@${serverVersion}`,
      `--registry=${registryUrl}`
    ],
    cwd,
    {
      NODE_AUTH_TOKEN: "",
      NPM_TOKEN: "",
      NPM_CONFIG_AUDIT: "false",
      NPM_CONFIG_FUND: "false",
      NPM_CONFIG_GLOBALCONFIG: globalConfigPath,
      NPM_CONFIG_REGISTRY: registryUrl,
      NPM_CONFIG_USERCONFIG: userConfigPath
    }
  );
}

function installPythonClient(cwd) {
  const venvRoot = join(cwd, ".venv");
  const pipConfigPath = join(cwd, "pip.conf");
  writeFileSync(pipConfigPath, "", "utf8");
  runCommand(pythonCommand, ["-m", "venv", venvRoot], cwd);
  const venvPython =
    process.platform === "win32" ? join(venvRoot, "Scripts", "python.exe") : join(venvRoot, "bin", "python");
  runCommand(
    venvPython,
    [
      "-m",
      "pip",
      "install",
      "--disable-pip-version-check",
      "--no-input",
      "--only-binary=:all:",
      `--index-url=https://pypi.org/simple`,
      `${clientPackage}==${clientVersion}`
    ],
    cwd,
    {
      PIP_CONFIG_FILE: pipConfigPath,
      PIP_DISABLE_PIP_VERSION_CHECK: "1",
      PIP_EXTRA_INDEX_URL: "",
      PIP_INDEX_URL: "https://pypi.org/simple",
      PIP_NO_INPUT: "1",
      PIP_TRUSTED_HOST: ""
    }
  );
  return venvPython;
}

function runExternalFixture(cwd, venvPython) {
  const runnerRoot = join(cwd, "python-client");
  mkdirSync(runnerRoot, { recursive: true });
  const configPath = join(runnerRoot, "config.json");
  const runnerPath = join(runnerRoot, "runner.py");
  const outputPath = join(runnerRoot, "summary.json");
  const config = {
    repoRoot,
    nodeExecutable: process.execPath,
    clientPackage,
    clientVersion,
    serverPackage,
    serverVersion,
    serverEntry: join(cwd, "node_modules", "@modelcontextprotocol", "server-filesystem", "dist", "index.js"),
    outputPath
  };
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  writeFileSync(runnerPath, runnerSource(), "utf8");
  execFileSync(venvPython, [runnerPath, configPath], {
    cwd: runnerRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  return JSON.parse(readFileSync(outputPath, "utf8"));
}

function runnerSource() {
  return String.raw`import asyncio
import json
import os
import sys
from pathlib import Path

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

config = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
fixture_root = Path.cwd() / "fixture-root"
public_dir = fixture_root / "public"
private_dir = fixture_root / "private"
public_file = public_dir / "hello.txt"
private_file = private_dir / "secret.txt"
policy_path = Path.cwd() / "external-policy.json"
audit_log = Path.cwd() / "external-audit.jsonl"
proxy_entry = Path(config["repoRoot"]) / "packages" / "cli" / "dist" / "main.js"

public_dir.mkdir(parents=True, exist_ok=True)
private_dir.mkdir(parents=True, exist_ok=True)
public_file.write_text("hello from external fixture\n", encoding="utf-8")
private_file.write_text("private fixture value\n", encoding="utf-8")


def normalize_path(value):
    return str(value).replace("\\", "/")


policy_path.write_text(
    json.dumps(
        {
            "schemaVersion": "msp.policy.v1",
            "defaultAction": "deny",
            "methodPolicy": {
                "allowedMethods": ["initialize", "notifications/initialized", "ping", "tools/list", "tools/call"],
                "denyUnsupported": True,
            },
            "profiles": [
                {
                    "id": "external-filesystem",
                    "defaultAction": "deny",
                    "rules": [
                        {
                            "id": "deny-private-external-fixture",
                            "action": "deny",
                            "tools": ["read_text_file"],
                            "paths": {"deniedRoots": [normalize_path(private_dir)]},
                        },
                        {
                            "id": "allow-public-external-fixture",
                            "action": "allow",
                            "tools": ["read_text_file"],
                            "paths": {"allowedRoots": [normalize_path(public_dir)]},
                        },
                        {"id": "deny-file-write-external-fixture", "action": "deny", "capabilities": ["file-write"]},
                        {"id": "deny-shell-external-fixture", "action": "deny", "capabilities": ["shell"]},
                    ],
                    "audit": {
                        "destination": "file",
                        "path": str(audit_log),
                        "onFailure": "fail_closed",
                        "includeRawArguments": False,
                        "includeFullPaths": False,
                    },
                }
            ],
            "redaction": {
                "detectors": [
                    {
                        "id": "external-fixture-redaction-marker",
                        "kind": "secret_like",
                        "replacement": "[REDACTED_VALUE]",
                    }
                ]
            },
        },
        indent=2,
    )
    + "\n",
    encoding="utf-8",
)


def model_value(value):
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json", by_alias=True)
    if isinstance(value, dict):
        return value
    return None


async def call_tool(session, name, arguments):
    try:
        return {"ok": True, "result": await session.call_tool(name, arguments=arguments)}
    except Exception as error:
        payload = model_value(getattr(error, "error", None)) or model_value(error) or {}
        return {
            "ok": False,
            "error": {
                "code": payload.get("code", getattr(error, "code", None)),
                "data": payload.get("data", getattr(error, "data", None)),
            },
        }


def summarize_tools(result):
    names = sorted(tool.name for tool in (result.tools or []))
    return {
        "visibleToolNames": names,
        "visibleCount": len(names),
        "includesReadTextFile": "read_text_file" in names,
        "includesListAllowedDirectories": "list_allowed_directories" in names,
    }


def summarize_call(call):
    if call["ok"]:
        content = call["result"].content or []
        text = "".join(getattr(item, "text", "") for item in content if getattr(item, "type", None) == "text")
        return {
            "ok": True,
            "textDigest": "external-public-hello" if text.rstrip("\r\n") == "hello from external fixture" else "unexpected-text",
            "contentTypes": sorted(getattr(item, "type", "") for item in content),
        }
    data = call["error"].get("data") or {}
    decision = data.get("decision") or {}
    return {
        "ok": False,
        "errorCode": call["error"].get("code"),
        "decisionAction": decision.get("action"),
        "evidenceCodes": sorted(item.get("code") for item in decision.get("evidence", []) if item.get("code")),
    }


def read_audit_events():
    return [json.loads(line) for line in audit_log.read_text(encoding="utf-8").splitlines() if line]


def summarize_audit(events):
    return {
        "eventKinds": sorted(event.get("kind") for event in events),
        "evidenceCodes": sorted(
            item.get("code")
            for event in events
            for item in (event.get("decision") or {}).get("evidence", [])
            if item.get("code")
        ),
        "redactionAppliedCount": sum(1 for event in events if (event.get("redaction") or {}).get("applied")),
        "stderrLineCount": sum((event.get("redaction") or {}).get("counts", {}).get("stderr_line", 0) for event in events),
        "containsRawFixtureRoot": str(fixture_root) in json.dumps(events),
    }


async def run():
    safe_env = {
        key: value
        for key, value in os.environ.items()
        if key.upper() in {"HOME", "PATH", "SYSTEMROOT", "TEMP", "TMP", "WINDIR"}
    }
    server_params = StdioServerParameters(
        command=config["nodeExecutable"],
        args=[
            str(proxy_entry),
            "run",
            "--policy",
            str(policy_path),
            "--profile",
            "external-filesystem",
            "--audit-log",
            str(audit_log),
            "--shutdown-grace-ms",
            "2000",
            "--",
            config["nodeExecutable"],
            config["serverEntry"],
            str(fixture_root),
        ],
        env=safe_env,
    )
    client_closed = False
    async with stdio_client(server_params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            tools = await session.list_tools()
            allowed_read = await call_tool(session, "read_text_file", {"path": str(public_file)})
            denied_read = await call_tool(session, "read_text_file", {"path": str(private_file)})
            hidden_call = await call_tool(session, "list_allowed_directories", {})
    client_closed = True

    events = read_audit_events()
    summary = {
        "schemaVersion": "msp.external-fixture-summary.v1",
        "target": "external-filesystem-python-stdio",
        "transport": "stdio",
        "fixtureSource": "external-mcp",
        "client": {"package": config["clientPackage"], "version": config["clientVersion"]},
        "server": {"package": config["serverPackage"], "version": config["serverVersion"]},
        "normalization": {
            "fixtureRoot": "<external-fixture-root>",
            "elapsedMs": 0,
            "timestamps": "<timestamp>",
        },
        "scenarios": {
            "initialize": {"connected": True},
            "initialized": {"accepted": True},
            "toolsListFiltering": summarize_tools(tools),
            "allowedPublicRead": summarize_call(allowed_read),
            "deniedPrivateRead": summarize_call(denied_read),
            "hiddenToolDirectCall": summarize_call(hidden_call),
            "shutdown": {"clientClosed": client_closed},
            "audit": summarize_audit(events),
        },
    }
    Path(config["outputPath"]).write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")


asyncio.run(run())
`;
}

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
