import type {
  Capability,
  NormalizedToolDescriptor
} from "@0disoft/mcp-security-proxy-contracts";

export interface ClassifierEvidence {
  readonly capability: Capability;
  readonly source: "explicit" | "name" | "description" | "fallback";
  readonly reason: string;
}

export interface ToolDescriptorInput {
  readonly name: string;
  readonly description?: string;
  readonly explicitCapabilities?: readonly Capability[];
}

export function classifyToolDescriptor(input: ToolDescriptorInput): {
  readonly descriptor: NormalizedToolDescriptor;
  readonly evidence: readonly ClassifierEvidence[];
} {
  const explicit = input.explicitCapabilities ?? [];
  const inferred = inferCapabilities(input);
  const capabilities = uniqueCapabilities([...explicit, ...inferred.map((item) => item.capability)]);

  return {
    descriptor: {
      name: input.name,
      ...(input.description ? { description: input.description } : {}),
      capabilities: capabilities.length > 0 ? capabilities : ["unknown"]
    },
    evidence: [
      ...explicit.map((capability): ClassifierEvidence => ({
        capability,
        source: "explicit",
        reason: "capability supplied by policy or fixture"
      })),
      ...inferred,
      ...(capabilities.length === 0
        ? [
            {
              capability: "unknown" as const,
              source: "fallback" as const,
              reason: "no safe capability could be inferred"
            }
          ]
        : [])
    ]
  };
}

function inferCapabilities(input: ToolDescriptorInput): readonly ClassifierEvidence[] {
  const haystack = `${input.name} ${input.description ?? ""}`.toLowerCase();
  const evidence: ClassifierEvidence[] = [];

  if (haystack.includes("file") || haystack.includes("path")) {
    evidence.push({ capability: "file-read", source: "name", reason: "tool text mentions file or path" });
  }
  if (haystack.includes("write")) {
    evidence.push({ capability: "file-write", source: "description", reason: "tool text mentions write" });
  }
  if (haystack.includes("shell") || haystack.includes("command")) {
    evidence.push({ capability: "shell", source: "description", reason: "tool text mentions shell or command" });
  }
  if (haystack.includes("http") || haystack.includes("url") || haystack.includes("network")) {
    evidence.push({ capability: "network", source: "description", reason: "tool text mentions network access" });
  }

  return evidence;
}

function uniqueCapabilities(capabilities: readonly Capability[]): readonly Capability[] {
  return [...new Set(capabilities)];
}
