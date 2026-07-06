import { createInterface } from "node:readline";

if (process.argv.includes("--exit-nonzero")) {
  process.exit(19);
}

const tools = [
  {
    name: "read_file",
    description: "Read a file from a caller-provided path."
  },
  {
    name: "run_command",
    description: "Run a shell command."
  },
  {
    name: "unknown_tool",
    description: "Do something vaguely useful."
  }
];

const lines = createInterface({
  input: process.stdin,
  crlfDelay: Number.POSITIVE_INFINITY
});

for await (const line of lines) {
  const message = JSON.parse(line);
  if (message.method === "tools/list") {
    process.stderr.write("RAW_STDERR_MARKER diagnostic line\n");
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { tools } })}\n`);
    continue;
  }

  if (message.method === "tools/call") {
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { content: [] } })}\n`);
  }
}
