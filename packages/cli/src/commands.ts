import {
  knownSchemaVersions,
  parsePolicyDocumentJson,
  validateNormalizedToolCall,
  validateToolListCapture,
  type PolicyDocument
} from "@0disoft/mcp-security-proxy-contracts";
import {
  classifyToolDescriptor,
  evaluateToolCall,
  formatAuditEventJsonLine,
  toolHasNonDenyPolicyCoverage
} from "@0disoft/mcp-security-proxy-core";
import {
  formatStdioOpsEventJsonLine,
  runStdioProxy,
  type UpstreamCommand,
  type UpstreamProcess
} from "@0disoft/mcp-security-proxy-runtime";
import type { Readable, Writable } from "node:stream";
import type { OpsFeatureFlagController, OpsFeatureFlagControllerOptions } from "./ops-feature-flags.js";
import type { PolicyFileReloadOptions } from "./policy-file-reloader.js";

export type CommandName = "run" | "config-snippet" | "check-policy" | "inspect-tools" | "eval-call";

export interface CommandContract {
  readonly name: CommandName;
  readonly description: string;
  readonly forwardsToolCalls: boolean;
}

export interface CliIo {
  readonly readTextFile: (path: string) => string;
  readonly stdout: (line: string) => void;
  readonly stderr: (line: string) => void;
}

export interface CliRunIo extends CliIo {
  readonly clientInput: Readable;
  readonly mcpOutput: Writable;
  readonly appendTextFile: (path: string, text: string) => void | Promise<void>;
  readonly spawnUpstream: (command: UpstreamCommand) => UpstreamProcess;
  readonly createPolicyReloadSource?: (
    options: PolicyFileReloadOptions
  ) => import("@0disoft/mcp-security-proxy-runtime").PolicyReloadSource;
  readonly createOpsFeatureFlagController?: (
    options: OpsFeatureFlagControllerOptions
  ) => Promise<OpsFeatureFlagController>;
}

export interface CliResult {
  readonly exitCode: number;
}

interface ParsedArgs {
  readonly command?: string;
  readonly flags: Readonly<Record<string, string | true>>;
  readonly positionals: readonly string[];
  readonly separatorSeen: boolean;
}

const maximumShutdownGraceMs = 2_147_483_647;
const maximumFrameBytes = 16_777_216;
const maximumJsonDepth = 256;
const allowedFlagsByCommand: Readonly<Record<CommandName, ReadonlySet<string>>> = {
  run: new Set([
    "policy",
    "profile",
    "audit-log",
    "ops-log",
    "ops-feature-flags",
    "shutdown-grace-ms",
    "max-frame-bytes",
    "max-json-depth",
    "approval-hook",
    "watch-policy",
    "json",
    "help"
  ]),
  "config-snippet": new Set([
    "target",
    "name",
    "policy",
    "profile",
    "proxy-command",
    "codex-command",
    "gemini-command",
    "help"
  ]),
  "check-policy": new Set(["policy", "json", "help"]),
  "inspect-tools": new Set(["input", "policy", "profile", "json", "help"]),
  "eval-call": new Set(["policy", "input", "profile", "approval-hook", "json", "help"])
};

export function createCommandRegistry(): readonly CommandContract[] {
  return [
    {
      name: "run",
      description: "run an MCP server behind the proxy",
      forwardsToolCalls: true
    },
    {
      name: "config-snippet",
      description: "print a read-only stdio host configuration snippet",
      forwardsToolCalls: false
    },
    {
      name: "check-policy",
      description: "validate policy syntax and contract shape",
      forwardsToolCalls: false
    },
    {
      name: "inspect-tools",
      description: "classify tool descriptors without forwarding calls",
      forwardsToolCalls: false
    },
    {
      name: "eval-call",
      description: "evaluate one captured tool call without forwarding it",
      forwardsToolCalls: false
    }
  ];
}

export function runCli(argv: readonly string[], io: CliIo): CliResult {
  const parsed = parseArgs(argv);
  if (isHelpRequest(parsed)) {
    writeHelp(io, helpTopic(parsed));
    return { exitCode: 0 };
  }

  const command = parsed.command;
  if (!command || !isCommandName(command)) {
    writeError(io, 2, `unknown command: ${parsed.command}`, parsed.flags["json"] === true);
    return { exitCode: 2 };
  }

  try {
    assertAllowedFlags(command, parsed.flags);
    if (command === "run") {
      writeError(
        io,
        2,
        "run requires async CLI IO; use runCliAsync for live proxy execution",
        parsed.flags["json"] === true
      );
      return { exitCode: 2 };
    }
    if (command === "config-snippet") {
      return configSnippet(parsed.flags, parsed.positionals, parsed.separatorSeen, io);
    }
    if (command === "check-policy") {
      return checkPolicy(parsed.flags, io);
    }
    if (command === "inspect-tools") {
      return inspectTools(parsed.flags, io);
    }
    return evalCall(parsed.flags, io);
  } catch (error) {
    const errorAsJson = command !== "config-snippet" && parsed.flags["json"] === true;
    if (error instanceof CliError) {
      writeError(io, error.exitCode, error.message, errorAsJson);
      return { exitCode: error.exitCode };
    }
    writeError(io, 1, error instanceof Error ? error.message : "handled runtime failure", errorAsJson);
    return { exitCode: 1 };
  }
}

export async function runCliAsync(argv: readonly string[], io: CliRunIo): Promise<CliResult> {
  const parsed = parseArgs(argv);
  if (isHelpRequest(parsed)) {
    writeHelp(io, helpTopic(parsed));
    return { exitCode: 0 };
  }
  if (parsed.command !== "run") {
    return runCli(argv, io);
  }

  try {
    assertAllowedFlags("run", parsed.flags);
    return await runProxy(parsed.flags, parsed.positionals, parsed.separatorSeen, io);
  } catch (error) {
    if (error instanceof CliError) {
      writeError(io, error.exitCode, error.message, false);
      return { exitCode: error.exitCode };
    }
    writeError(io, 1, error instanceof Error ? error.message : "handled runtime failure", false);
    return { exitCode: 1 };
  }
}

function checkPolicy(flags: Readonly<Record<string, string | true>>, io: CliIo): CliResult {
  const policyPath = readRequiredStringFlag(flags, "policy");
  const validation = parsePolicyDocumentJson(readTextFile(io, policyPath, 3));
  if (!validation.ok) {
    writeJsonOrHuman(
      io,
      flags,
      {
        ok: false,
        command: "check-policy",
        errors: validation.errors
      },
      `policy invalid: ${validation.errors.join("; ")}`
    );
    return { exitCode: 3 };
  }

  const policy = validation.value;
  writeJsonOrHuman(
    io,
    flags,
    {
      ok: true,
      command: "check-policy",
      policy: {
        path: policyPath,
        profiles: policy.profiles.map((profile) => ({
          id: profile.id,
          rules: profile.rules.length,
          auditFailure: profile.audit.onFailure
        })),
        schemas: knownSchemaVersions()
      }
    },
    `policy ok: ${policy.profiles.length} profile(s), ${policy.profiles.reduce((sum, item) => sum + item.rules.length, 0)} rule(s)`
  );
  return { exitCode: 0 };
}

function inspectTools(flags: Readonly<Record<string, string | true>>, io: CliIo): CliResult {
  const inputPath = readRequiredStringFlag(flags, "input");
  const captureValidation = validateToolListCapture(readJson(io, inputPath, 2));
  if (!captureValidation.ok) {
    writeJsonOrHuman(
      io,
      flags,
      {
        ok: false,
        command: "inspect-tools",
        errors: captureValidation.errors
      },
      `tool list invalid: ${captureValidation.errors.join("; ")}`
    );
    return { exitCode: 2 };
  }

  const policy = readOptionalPolicy(flags, io);
  const profileId = readOptionalStringFlag(flags, "profile") ?? "default";
  const profile = policy?.profiles.find((item) => item.id === profileId);
  const tools = captureValidation.value.tools.map((tool) => {
    const classified = classifyToolDescriptor(tool);
    return {
      name: classified.descriptor.name,
      capabilities: classified.descriptor.capabilities,
      evidence: classified.evidence.map((item) => ({
        capability: item.capability,
        source: item.source,
        reason: item.reason
      })),
      policyCovered: profile
        ? toolHasNonDenyPolicyCoverage(profile.rules, classified.descriptor.name, classified.descriptor.capabilities)
        : false
    };
  });

  writeJsonOrHuman(
    io,
    flags,
    {
      ok: true,
      command: "inspect-tools",
      input: inputPath,
      profile: profile ? profile.id : undefined,
      tools
    },
    `inspected ${tools.length} tool(s)`
  );
  return { exitCode: 0 };
}

function evalCall(flags: Readonly<Record<string, string | true>>, io: CliIo): CliResult {
  const policyPath = readRequiredStringFlag(flags, "policy");
  const inputPath = readRequiredStringFlag(flags, "input");
  const profileId = readOptionalStringFlag(flags, "profile") ?? "default";
  const approvalHookAvailable = flags["approval-hook"] === true;

  const policy = readRequiredPolicy(io, policyPath);

  const callValidation = validateNormalizedToolCall(readJson(io, inputPath, 2));
  if (!callValidation.ok) {
    writeJsonOrHuman(
      io,
      flags,
      {
        ok: false,
        command: "eval-call",
        errors: callValidation.errors
      },
      `tool call invalid: ${callValidation.errors.join("; ")}`
    );
    return { exitCode: 2 };
  }

  const decision = evaluateToolCall({
    policy,
    profileId,
    call: callValidation.value,
    approvalHookAvailable
  });

  writeJsonOrHuman(
    io,
    flags,
    {
      ok: true,
      command: "eval-call",
      profile: profileId,
      decision
    },
    `decision: ${decision.action} (${decision.evidence.map((item) => item.reason).join("; ")})`
  );
  return { exitCode: 0 };
}

function configSnippet(
  flags: Readonly<Record<string, string | true>>,
  upstreamArgv: readonly string[],
  separatorSeen: boolean,
  io: CliIo
): CliResult {
  const target = readRequiredStringFlag(flags, "target");
  assertConfigSnippetValue("--target", target);
  if (target !== "stdio-json" && target !== "codex-cli-json" && target !== "gemini-cli-json") {
    throw new CliError(2, `unsupported config snippet target: ${target}`);
  }
  const policyPath = readRequiredStringFlag(flags, "policy");
  const profileId = readRequiredStringFlag(flags, "profile");
  const proxyCommand = readOptionalStringFlag(flags, "proxy-command") ?? "mcp-security-proxy";
  const serverName = readOptionalStringFlag(flags, "name");
  const codexCommand = readOptionalStringFlag(flags, "codex-command") ?? "codex";
  const geminiCommand = readOptionalStringFlag(flags, "gemini-command") ?? "gemini";
  if (target === "stdio-json" && flags["name"] !== undefined) {
    throw new CliError(2, "--name is only supported for host-specific config targets");
  }
  if (target !== "codex-cli-json" && flags["codex-command"] !== undefined) {
    throw new CliError(2, "--codex-command is only supported for --target codex-cli-json");
  }
  if (target !== "gemini-cli-json" && flags["gemini-command"] !== undefined) {
    throw new CliError(2, "--gemini-command is only supported for --target gemini-cli-json");
  }
  if (target !== "stdio-json" && !serverName) {
    throw new CliError(2, "missing required --name");
  }
  if (serverName && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(serverName)) {
    throw new CliError(2, "--name must use 1..64 ASCII letters, numbers, hyphens, or underscores");
  }
  if (target === "gemini-cli-json" && serverName?.includes("_")) {
    throw new CliError(2, "Gemini MCP server names must not contain underscores");
  }
  if (!separatorSeen) {
    throw new CliError(2, "config-snippet requires -- before the upstream command");
  }
  const [upstreamCommand, ...upstreamArgs] = upstreamArgv;
  if (!upstreamCommand) {
    throw new CliError(2, "missing upstream command after --");
  }

  for (const [label, generatedValue] of [
    ["--policy", policyPath],
    ["--profile", profileId],
    ["--proxy-command", proxyCommand],
    ["--codex-command", codexCommand],
    ["--gemini-command", geminiCommand],
    ["upstream command", upstreamCommand],
    ...upstreamArgs.map((value, index) => [`upstream argument ${index + 1}`, value])
  ] as const) {
    assertConfigSnippetValue(label, generatedValue);
  }

  const policy = readRequiredPolicy(io, policyPath);
  if (!policy.profiles.some((item) => item.id === profileId)) {
    throw new CliError(3, `profile not found: ${profileId}`);
  }

  const proxyDescriptor = {
    command: proxyCommand,
    args: ["run", "--policy", policyPath, "--profile", profileId, "--", upstreamCommand, ...upstreamArgs]
  };
  const descriptor = buildConfigSnippetDescriptor(target, serverName, proxyDescriptor, codexCommand, geminiCommand);
  io.stdout(JSON.stringify(descriptor));
  return { exitCode: 0 };
}

function buildConfigSnippetDescriptor(
  target: "stdio-json" | "codex-cli-json" | "gemini-cli-json",
  serverName: string | undefined,
  proxyDescriptor: Readonly<{ command: string; args: readonly string[] }>,
  codexCommand: string,
  geminiCommand: string
): Readonly<{ command: string; args: readonly string[] }> {
  if (target === "stdio-json") {
    return proxyDescriptor;
  }
  if (!serverName) {
    throw new CliError(2, "missing required --name");
  }
  if (target === "codex-cli-json") {
    return {
      command: codexCommand,
      args: ["mcp", "add", serverName, "--", proxyDescriptor.command, ...proxyDescriptor.args]
    };
  }

  const upstreamSeparatorIndex = proxyDescriptor.args.indexOf("--");
  if (upstreamSeparatorIndex < 0) {
    throw new CliError(2, "Gemini config generation requires an upstream separator");
  }
  const geminiProxyArgs = [
    ...proxyDescriptor.args.slice(0, upstreamSeparatorIndex),
    "--",
    ...proxyDescriptor.args.slice(upstreamSeparatorIndex)
  ];
  return {
    command: geminiCommand,
    args: [
      "mcp",
      "add",
      "--scope",
      "project",
      "--transport",
      "stdio",
      serverName,
      proxyDescriptor.command,
      ...geminiProxyArgs
    ]
  };
}

function assertConfigSnippetValue(label: string, value: string): void {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)) {
      throw new CliError(2, `${label} must not contain control characters`);
    }
  }
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  let command: string | undefined;
  const flags: Record<string, string | true> = {};
  const positionals: string[] = [];
  let separatorSeen = false;
  let index = 0;

  while (index < argv.length) {
    const arg = argv[index];
    if (!arg) {
      index += 1;
      continue;
    }
    if (!arg.startsWith("--")) {
      command = arg;
      index += 1;
      break;
    }
    const nextIndex = readFlag(argv, index, flags);
    index = nextIndex;
  }

  for (; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      separatorSeen = true;
      positionals.push(...argv.slice(index + 1));
      break;
    }
    if (!arg?.startsWith("--")) {
      if (arg) {
        positionals.push(arg);
      }
      continue;
    }
    index = readFlag(argv, index, flags) - 1;
  }

  return command ? { command, flags, positionals, separatorSeen } : { flags, positionals, separatorSeen };
}

function readFlag(argv: readonly string[], index: number, flags: Record<string, string | true>): number {
  const arg = argv[index];
  const name = arg?.slice(2);
  if (!name) {
    return index + 1;
  }
  const next = argv[index + 1];
  if (!next || next.startsWith("--")) {
    flags[name] = true;
    return index + 1;
  }
  flags[name] = next;
  return index + 2;
}

function assertAllowedFlags(command: CommandName, flags: Readonly<Record<string, string | true>>): void {
  const unknown = Object.keys(flags).filter((name) => !allowedFlagsByCommand[command].has(name));
  if (unknown.length > 0) {
    throw new CliError(2, `unknown flag for ${command}: --${unknown[0]}`);
  }
}

function isHelpRequest(parsed: ParsedArgs): boolean {
  return parsed.flags["help"] === true || parsed.command === undefined || parsed.command === "help";
}

function helpTopic(parsed: ParsedArgs): CommandName | undefined {
  const topic = parsed.command === "help" ? parsed.positionals[0] : parsed.command;
  return topic && isCommandName(topic) ? topic : undefined;
}

function writeHelp(io: CliIo, command?: CommandName): void {
  if (command) {
    io.stdout(commandHelp(command));
    return;
  }
  io.stdout(
    [
      "Usage: mcp-security-proxy <command> [options]",
      "",
      "Commands:",
      ...createCommandRegistry().map((item) => `  ${item.name.padEnd(13)} ${item.description}`),
      "",
      "Use `mcp-security-proxy <command> --help` for command-specific options."
    ].join("\n")
  );
}

function commandHelp(command: CommandName): string {
  if (command === "run") {
    return [
      "Usage: mcp-security-proxy run --policy <path> --profile <name> [--audit-log <path>] [options] -- <upstream> [args...]",
      "",
      "Options:",
      "  --policy <path>                local policy file",
      "  --profile <name>               policy profile to apply",
      "  --audit-log <path>             override the profile JSON Lines audit file",
      "  --ops-log <path>               optional JSON Lines ops metrics output file",
      "  --ops-feature-flags <path>     hot-reload mcp.ops.metrics.enabled for --ops-log only",
      "  --watch-policy                 atomically reload valid policy file replacements",
      "  --shutdown-grace-ms <0..2147483647>",
      "                                 milliseconds to wait before killing upstream after client input closes",
      "  --max-frame-bytes <1..16777216>",
      "                                 maximum UTF-8 bytes per JSON-RPC line, default: 1048576",
      "  --max-json-depth <1..256>",
      "                                 maximum parsed JSON nesting depth, default: 64",
      "  --help                         show this help",
      "",
      "Stdout is reserved for MCP protocol messages after the live proxy starts."
    ].join("\n");
  }
  if (command === "check-policy") {
    return [
      "Usage: mcp-security-proxy check-policy --policy <path> [--json]",
      "",
      "Options:",
      "  --policy <path>                local policy file",
      "  --json                         write a redacted machine-readable result",
      "  --help                         show this help"
    ].join("\n");
  }
  if (command === "config-snippet") {
    return [
      "Usage: mcp-security-proxy config-snippet --target <stdio-json|codex-cli-json|gemini-cli-json> [--name <server>] --policy <path> --profile <name> [options] -- <upstream> [args...]",
      "",
      "Options:",
      "  --target <target>              stdio-json, codex-cli-json, or gemini-cli-json",
      "  --name <server>                MCP server name, required for host-specific targets",
      "  --policy <path>                local policy file referenced by the generated invocation",
      "  --profile <name>               existing policy profile referenced by the generated invocation",
      "  --proxy-command <path>         proxy executable, default: mcp-security-proxy",
      "  --codex-command <path>         Codex executable, default: codex",
      "  --gemini-command <path>        Gemini executable, default: gemini",
      "  --help                         show this help",
      "",
      "This command validates but never modifies the policy or host configuration files."
    ].join("\n");
  }
  if (command === "inspect-tools") {
    return [
      "Usage: mcp-security-proxy inspect-tools --input <path> [--policy <path>] [--profile <name>] [--json]",
      "",
      "Options:",
      "  --input <path>                 captured tool-list JSON file",
      "  --policy <path>                optional local policy file for coverage checks",
      "  --profile <name>               policy profile to compare, default: default",
      "  --json                         write a redacted machine-readable result",
      "  --help                         show this help"
    ].join("\n");
  }
  return [
    "Usage: mcp-security-proxy eval-call --policy <path> --input <path> [--profile <name>] [--approval-hook] [--json]",
    "",
    "Options:",
    "  --policy <path>                local policy file",
    "  --input <path>                 captured normalized tool-call JSON file",
    "  --profile <name>               policy profile to apply, default: default",
    "  --approval-hook                mark approval hook availability",
    "  --json                         write a redacted machine-readable result",
    "  --help                         show this help"
  ].join("\n");
}

function writeError(io: CliIo, code: number, message: string, asJson: boolean): void {
  if (asJson) {
    io.stdout(JSON.stringify({ ok: false, error: { code, message } }));
    return;
  }
  io.stderr(message);
}

function writeJsonOrHuman(
  io: CliIo,
  flags: Readonly<Record<string, string | true>>,
  value: unknown,
  human: string
): void {
  if (flags["json"] === true) {
    io.stdout(JSON.stringify(stripUndefined(value)));
    return;
  }
  io.stdout(human);
}

function readJson(io: CliIo, path: string, failureExitCode: 2 | 3): unknown {
  try {
    return JSON.parse(readTextFile(io, path, failureExitCode)) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown JSON read failure";
    throw new CliError(failureExitCode, `failed to read JSON file ${path}: ${message}`);
  }
}

function readTextFile(io: CliIo, path: string, failureExitCode: 2 | 3): string {
  try {
    return io.readTextFile(path);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown file read failure";
    throw new CliError(failureExitCode, `failed to read file ${path}: ${message}`);
  }
}

function readRequiredPolicy(io: CliIo, policyPath: string): PolicyDocument {
  const validation = parsePolicyDocumentJson(readTextFile(io, policyPath, 3));
  if (!validation.ok) {
    throw new CliError(3, `policy invalid: ${validation.errors.join("; ")}`);
  }
  return validation.value;
}

function readOptionalPolicy(flags: Readonly<Record<string, string | true>>, io: CliIo): PolicyDocument | undefined {
  const policyPath = readOptionalStringFlag(flags, "policy");
  if (!policyPath) {
    return undefined;
  }
  return readRequiredPolicy(io, policyPath);
}

function readRequiredStringFlag(flags: Readonly<Record<string, string | true>>, name: string): string {
  const value = readOptionalStringFlag(flags, name);
  if (!value) {
    throw new CliError(2, `missing required --${name}`);
  }
  return value;
}

function readOptionalStringFlag(flags: Readonly<Record<string, string | true>>, name: string): string | undefined {
  const value = flags[name];
  return typeof value === "string" ? value : undefined;
}

function readOptionalShutdownGraceMsFlag(flags: Readonly<Record<string, string | true>>): number | undefined {
  return readOptionalIntegerFlag(flags, "shutdown-grace-ms", 0, maximumShutdownGraceMs);
}

function readOptionalFrameBytesFlag(flags: Readonly<Record<string, string | true>>): number | undefined {
  return readOptionalIntegerFlag(flags, "max-frame-bytes", 1, maximumFrameBytes);
}

function readOptionalJsonDepthFlag(flags: Readonly<Record<string, string | true>>): number | undefined {
  return readOptionalIntegerFlag(flags, "max-json-depth", 1, maximumJsonDepth);
}

function readOptionalIntegerFlag(
  flags: Readonly<Record<string, string | true>>,
  name: string,
  minimum: number,
  maximum: number
): number | undefined {
  const value = flags[name];
  if (value === undefined) {
    return undefined;
  }
  if (value === true) {
    throw new CliError(2, `missing required --${name} value`);
  }
  if (!/^\d+$/.test(value)) {
    throw new CliError(2, `--${name} must be an integer between ${minimum} and ${maximum}`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new CliError(2, `--${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
}

async function runProxy(
  flags: Readonly<Record<string, string | true>>,
  upstreamArgv: readonly string[],
  separatorSeen: boolean,
  io: CliRunIo
): Promise<CliResult> {
  if (flags["json"] === true) {
    throw new CliError(2, "run does not support --json because stdout is reserved for MCP messages");
  }
  const policyPath = readRequiredStringFlag(flags, "policy");
  const profileId = readRequiredStringFlag(flags, "profile");
  const auditLogOverride = readOptionalStringFlag(flags, "audit-log");
  const opsLogPath = readOptionalStringFlag(flags, "ops-log");
  const opsFeatureFlagsPath = readOptionalStringFlag(flags, "ops-feature-flags");
  const shutdownGraceMs = readOptionalShutdownGraceMsFlag(flags);
  const maxFrameBytes = readOptionalFrameBytesFlag(flags);
  const maxJsonDepth = readOptionalJsonDepthFlag(flags);
  const watchPolicy = flags["watch-policy"] === true;
  if (flags["watch-policy"] !== undefined && !watchPolicy) {
    throw new CliError(2, "--watch-policy does not accept a value");
  }
  if (flags["approval-hook"] === true) {
    throw new CliError(2, "run does not support --approval-hook; approval hooks must be provided by an embedding host");
  }
  if (auditLogOverride === "-") {
    throw new CliError(2, "run requires --audit-log to be a file path; stdout is reserved for MCP messages");
  }
  if (opsLogPath === "-") {
    throw new CliError(2, "run requires --ops-log to be a file path; stdout is reserved for MCP messages");
  }
  if (opsFeatureFlagsPath === "-") {
    throw new CliError(2, "run requires --ops-feature-flags to be a file path");
  }
  if (opsFeatureFlagsPath && !opsLogPath) {
    throw new CliError(2, "--ops-feature-flags requires --ops-log and never controls policy decisions");
  }
  if (!separatorSeen) {
    throw new CliError(2, "run requires -- before the upstream command");
  }
  const [executable, ...argv] = upstreamArgv;
  if (!executable) {
    throw new CliError(2, "missing upstream command after --");
  }

  const policy = readRequiredPolicy(io, policyPath);
  const profile = policy.profiles.find((item) => item.id === profileId);
  if (!profile) {
    throw new CliError(3, `profile not found: ${profileId}`);
  }
  if (profile.audit.destination !== "file" || !profile.audit.path) {
    throw new CliError(
      3,
      `profile ${profileId} audit.destination must be file for CLI run; stdout is reserved for MCP messages`
    );
  }
  const auditLogPath = auditLogOverride ?? profile.audit.path;
  const policyReloadSource = watchPolicy
    ? io.createPolicyReloadSource?.({
        policyPath,
        profileId,
        initialPolicy: policy,
        readTextFile: io.readTextFile,
        onResult: (update) =>
          io.stderr(
            update.status === "accepted" ? "policy reload applied" : `policy reload rejected: ${update.reasonCode}`
          )
      })
    : undefined;
  if (watchPolicy && !policyReloadSource) {
    throw new CliError(2, "--watch-policy is unavailable in this embedding runtime");
  }

  let opsFeatureFlagController: OpsFeatureFlagController | undefined;
  if (opsFeatureFlagsPath) {
    if (!io.createOpsFeatureFlagController) {
      throw new CliError(2, "--ops-feature-flags is unavailable in this embedding runtime");
    }
    try {
      opsFeatureFlagController = await io.createOpsFeatureFlagController({
        path: opsFeatureFlagsPath,
        onConfigurationChanged: (enabled) =>
          io.stderr(`ops metrics feature flag applied: ${enabled ? "enabled" : "disabled"}`),
        onReloadFailure: (reason) =>
          io.stderr(`ops feature flag reload rejected: ${reason}; keeping last valid snapshot`)
      });
    } catch {
      throw new CliError(3, "ops feature flag snapshot is invalid or unreadable");
    }
  }

  try {
    return await runStdioProxy({
      policy,
      profileId,
      upstreamCommand: {
        executable,
        argv
      },
      clientInput: io.clientInput,
      clientOutput: io.mcpOutput,
      spawnUpstream: io.spawnUpstream,
      writeAuditEvent: (event) => io.appendTextFile(auditLogPath, formatAuditEventJsonLine(event)),
      ...(opsLogPath
        ? {
            writeOpsEvent: (event) => {
              if (opsFeatureFlagController?.isOpsMetricsEnabled() ?? true) {
                return io.appendTextFile(opsLogPath, formatStdioOpsEventJsonLine(event));
              }
            }
          }
        : {}),
      ...(shutdownGraceMs !== undefined ? { shutdownGraceMs } : {}),
      ...(maxFrameBytes !== undefined ? { maxFrameBytes } : {}),
      ...(maxJsonDepth !== undefined ? { maxJsonDepth } : {}),
      ...(policyReloadSource ? { policyReloadSource } : {})
    });
  } finally {
    await opsFeatureFlagController?.close();
  }
}

function isCommandName(value: string): value is CommandName {
  return ["run", "config-snippet", "check-policy", "inspect-tools", "eval-call"].includes(value);
}

function stripUndefined(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripUndefined);
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entryValue]) => entryValue !== undefined)
        .map(([key, entryValue]) => [key, stripUndefined(entryValue)])
    );
  }
  return value;
}

class CliError extends Error {
  readonly exitCode: 2 | 3;

  constructor(exitCode: 2 | 3, message: string) {
    super(message);
    this.exitCode = exitCode;
  }
}
