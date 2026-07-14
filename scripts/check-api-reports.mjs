import { Extractor, ExtractorConfig } from "@microsoft/api-extractor";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const update = process.argv.includes("--update");
const packages = ["contracts", "core", "mcp-adapter", "proxy-runtime", "cli"];
const typescriptCompilerFolder = join(root, "node_modules", "typescript");
const failures = [];

mkdirSync(join(root, "etc", "api"), { recursive: true });
mkdirSync(join(root, ".tmp", "api"), { recursive: true });

for (const packageDirectory of packages) {
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
