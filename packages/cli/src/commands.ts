import {
  knownSchemaVersions,
  validateNormalizedToolCall,
  validatePolicyDocument,
  validateToolListCapture,
  type NormalizedToolCall,
  type PolicyDocument
} from "@0disoft/mcp-security-proxy-contracts";
import { classifyToolDescriptor, evaluateToolCall } from "@0disoft/mcp-security-proxy-core";

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

export interface CliResult {
  readonly exitCode: number;
}

interface ParsedArgs {
  readonly command?: string;
  readonly flags: Readonly<Record<string, string | true>>;
}

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
  if (parsed.flags["help"] === true || !parsed.command) {
    writeHelp(io);
    return { exitCode: 0 };
  }

  if (!isCommandName(parsed.command)) {
    writeError(io, 2, `unknown command: ${parsed.command}`, parsed.flags["json"] === true);
    return { exitCode: 2 };
  }

  try {
    if (parsed.command === "run") {
      writeError(io, 6, "live proxy run is not implemented in the dry-run CLI milestone", parsed.flags["json"] === true);
      return { exitCode: 6 };
    }
    if (parsed.command === "check-policy") {
      return checkPolicy(parsed.flags, io);
    }
    if (parsed.command === "inspect-tools") {
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

function checkPolicy(flags: Readonly<Record<string, string | true>>, io: CliIo): CliResult {
  const policyPath = readRequiredStringFlag(flags, "policy");
  const parsed = readJson(io, policyPath, 3);
  const validation = validatePolicyDocument(parsed);
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

  const policyValidation = validatePolicyDocument(readJson(io, policyPath, 3));
  if (!policyValidation.ok) {
    writeJsonOrHuman(
      io,
      flags,
      {
        ok: false,
        command: "eval-call",
        errors: policyValidation.errors
      },
      `policy invalid: ${policyValidation.errors.join("; ")}`
    );
    return { exitCode: 3 };
  }

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
    policy: policyValidation.value,
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
      decision: {
        action: decision.action,
        evidence: decision.evidence
      }
    },
    `decision: ${decision.action} (${decision.evidence.map((item) => item.reason).join("; ")})`
  );
  return { exitCode: 0 };
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const [command, ...rest] = argv;
  const flags: Record<string, string | true> = {};

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (!arg?.startsWith("--")) {
      continue;
    }
    const name = arg.slice(2);
    const next = rest[index + 1];
    if (!next || next.startsWith("--")) {
      flags[name] = true;
      continue;
    }
    flags[name] = next;
    index += 1;
  }

  return command ? { command, flags } : { flags };
}

function writeHelp(io: CliIo): void {
  const commandNames = createCommandRegistry().map((command) => command.name).join(", ");
  io.stdout(`mcp-security-proxy commands: ${commandNames}`);
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
    return JSON.parse(io.readTextFile(path)) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown JSON read failure";
    throw new CliError(failureExitCode, `failed to read JSON file ${path}: ${message}`);
  }
}

function readOptionalPolicy(flags: Readonly<Record<string, string | true>>, io: CliIo): PolicyDocument | undefined {
  const policyPath = readOptionalStringFlag(flags, "policy");
  if (!policyPath) {
    return undefined;
  }
  const validation = validatePolicyDocument(readJson(io, policyPath, 3));
  if (!validation.ok) {
    throw new CliError(3, `policy invalid: ${validation.errors.join("; ")}`);
  }
  return validation.value;
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
