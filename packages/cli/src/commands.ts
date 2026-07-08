import {
  knownSchemaVersions,
  parsePolicyDocumentJson,
  validateNormalizedToolCall,
  validateToolListCapture,
  type NormalizedToolCall,
  type PolicyDocument
} from "@0disoft/mcp-security-proxy-contracts";
import { classifyToolDescriptor, evaluateToolCall, formatAuditEventJsonLine } from "@0disoft/mcp-security-proxy-core";
import {
  formatStdioOpsEventJsonLine,
  runStdioProxy,
  type UpstreamCommand,
  type UpstreamProcess
} from "@0disoft/mcp-security-proxy-runtime";
import type { Readable, Writable } from "node:stream";

export type CommandName = "run" | "check-policy" | "inspect-tools" | "eval-call";

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

export function createCommandRegistry(): readonly CommandContract[] {
  return [
    {
      name: "run",
      description: "run an MCP server behind the proxy",
      forwardsToolCalls: true
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
    if (command === "run") {
      writeError(io, 2, "run requires async CLI IO; use runCliAsync for live proxy execution", parsed.flags["json"] === true);
      return { exitCode: 2 };
    }
    if (command === "check-policy") {
      return checkPolicy(parsed.flags, io);
    }
    if (command === "inspect-tools") {
      return inspectTools(parsed.flags, io);
    }
    return evalCall(parsed.flags, io);
  } catch (error) {
    if (error instanceof CliError) {
      writeError(io, error.exitCode, error.message, parsed.flags["json"] === true);
      return { exitCode: error.exitCode };
    }
    writeError(io, 1, error instanceof Error ? error.message : "handled runtime failure", parsed.flags["json"] === true);
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
      policyCovered: profile ? profile.rules.some((rule) => ruleCoversTool(rule, classified.descriptor.name, classified.descriptor.capabilities)) : false
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
      "Usage: mcp-security-proxy run --policy <path> --profile <name> --audit-log <path> [options] -- <upstream> [args...]",
      "",
      "Options:",
      "  --policy <path>                local policy file",
      "  --profile <name>               policy profile to apply",
      "  --audit-log <path>             JSON Lines audit output file",
      "  --ops-log <path>               optional JSON Lines ops metrics output file",
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

function writeJsonOrHuman(io: CliIo, flags: Readonly<Record<string, string | true>>, value: unknown, human: string): void {
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
  const auditLogPath = readRequiredStringFlag(flags, "audit-log");
  const opsLogPath = readOptionalStringFlag(flags, "ops-log");
  const shutdownGraceMs = readOptionalShutdownGraceMsFlag(flags);
  const maxFrameBytes = readOptionalFrameBytesFlag(flags);
  const maxJsonDepth = readOptionalJsonDepthFlag(flags);
  if (flags["approval-hook"] === true) {
    throw new CliError(2, "run does not support --approval-hook; approval hooks must be provided by an embedding host");
  }
  if (auditLogPath === "-") {
    throw new CliError(2, "run requires --audit-log to be a file path; stdout is reserved for MCP messages");
  }
  if (opsLogPath === "-") {
    throw new CliError(2, "run requires --ops-log to be a file path; stdout is reserved for MCP messages");
  }
  if (!separatorSeen) {
    throw new CliError(2, "run requires -- before the upstream command");
  }
  const [executable, ...argv] = upstreamArgv;
  if (!executable) {
    throw new CliError(2, "missing upstream command after --");
  }

  const policy = readRequiredPolicy(io, policyPath);
  if (!policy.profiles.some((profile) => profile.id === profileId)) {
    throw new CliError(3, `profile not found: ${profileId}`);
  }

  return runStdioProxy({
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
    ...(opsLogPath ? { writeOpsEvent: (event) => io.appendTextFile(opsLogPath, formatStdioOpsEventJsonLine(event)) } : {}),
    ...(shutdownGraceMs !== undefined ? { shutdownGraceMs } : {}),
    ...(maxFrameBytes !== undefined ? { maxFrameBytes } : {}),
    ...(maxJsonDepth !== undefined ? { maxJsonDepth } : {})
  });
}

function isCommandName(value: string): value is CommandName {
  return ["run", "check-policy", "inspect-tools", "eval-call"].includes(value);
}

function ruleCoversTool(rule: PolicyDocument["profiles"][number]["rules"][number], toolName: string, capabilities: readonly string[]): boolean {
  const toolCovered = rule.tools?.includes(toolName) ?? false;
  const capabilityCovered = capabilities.some((capability) => rule.capabilities?.includes(capability as never));
  return toolCovered || capabilityCovered;
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
