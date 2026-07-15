import { Extractor, ExtractorConfig } from "@microsoft/api-extractor";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const update = process.argv.includes("--update");
const packages = [
  { directory: "contracts", report: "mcp-security-proxy-contracts.api.md" },
  { directory: "core", report: "mcp-security-proxy-core.api.md" },
  { directory: "mcp-adapter", report: "mcp-security-proxy-mcp-adapter.api.md" },
  { directory: "proxy-runtime", report: "mcp-security-proxy-runtime.api.md" },
  { directory: "cli", report: "mcp-security-proxy-cli.api.md" }
];
const typescriptCompilerFolder = join(root, "node_modules", "typescript");
const failures = [];

mkdirSync(join(root, "etc", "api"), { recursive: true });
mkdirSync(join(root, ".tmp", "api"), { recursive: true });

for (const { directory: packageDirectory, report } of packages) {
  const configPath = join(root, "packages", packageDirectory, "config", "api-extractor.json");
  if (!existsSync(configPath)) {
    failures.push(`${packageDirectory}: missing API Extractor configuration`);
    continue;
  }

  try {
    const extractorConfig = ExtractorConfig.loadFileAndPrepare(configPath);
    const result = Extractor.invoke(extractorConfig, {
      localBuild: update,
      showVerboseMessages: false,
      typescriptCompilerFolder
    });
    if (!result.succeeded) {
      failures.push(
        `${packageDirectory}: API report failed with ${result.errorCount} errors and ${result.warningCount} warnings`
      );
    }
    checkApiReportLineEndings(packageDirectory, report);
  } catch (error) {
    failures.push(`${packageDirectory}: ${error instanceof Error ? error.message : "API report failed"}`);
  }
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(failure);
  }
  process.exit(1);
}

console.log(`API reports ${update ? "updated" : "verified"} for ${packages.length} public packages`);

function checkApiReportLineEndings(packageDirectory, report) {
  const reportPath = join(root, "etc", "api", report);
  if (!existsSync(reportPath)) {
    failures.push(`${packageDirectory}: missing API report ${report}`);
    return;
  }
  const content = readFileSync(reportPath, "utf8");
  if (!content.includes("\r\n")) {
    return;
  }
  if (!update) {
    failures.push(`${packageDirectory}: API report must use LF line endings; rerun with --update`);
    return;
  }
  writeFileSync(reportPath, content.replaceAll("\r\n", "\n"), "utf8");
}
