import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const pnpmStore = join(root, "node_modules", ".pnpm");

const allowedLicenses = new Set(["Apache-2.0", "MIT", "BSD-2-Clause", "BSD-3-Clause", "ISC"]);
const reviewedLicenses = new Set(["MPL-2.0"]);
const deniedLicensePattern = /\b(?:AGPL|GPL|LGPL|SSPL|BUSL)\b|proprietary|source-available/i;

const failures = [];
const packages = new Map();

if (!existsSync(pnpmStore)) {
  failures.push("node_modules/.pnpm is missing; run pnpm install before license-report");
} else {
  for (const entry of readdirSync(pnpmStore, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    collectPackagesFromNodeModules(join(pnpmStore, entry.name, "node_modules"));
  }
}

const licenseCounts = new Map();
for (const item of [...packages.values()].sort((left, right) => left.key.localeCompare(right.key))) {
  const license = normalizeLicense(item.manifest.license ?? item.manifest.licenses);
  if (!license) {
    failures.push(`${item.key}: missing license metadata`);
    continue;
  }
  if (deniedLicensePattern.test(license)) {
    failures.push(`${item.key}: denied license ${license}`);
    continue;
  }
  if (!licenseAllowedOrReviewed(license)) {
    failures.push(`${item.key}: license requires review before release: ${license}`);
    continue;
  }
  licenseCounts.set(license, (licenseCounts.get(license) ?? 0) + 1);
}

if (packages.size === 0) {
  failures.push("no external dependency manifests found under node_modules/.pnpm");
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(failure);
  }
  process.exit(1);
}

for (const [license, count] of [...licenseCounts.entries()].sort((left, right) => left[0].localeCompare(right[0]))) {
  console.log(`${license}: ${count}`);
}

function collectPackagesFromNodeModules(nodeModulesDir) {
  if (!existsSync(nodeModulesDir)) {
    return;
  }

  for (const entry of readdirSync(nodeModulesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    if (entry.name.startsWith("@")) {
      const scopeDir = join(nodeModulesDir, entry.name);
      for (const scopedEntry of readdirSync(scopeDir, { withFileTypes: true })) {
        if (scopedEntry.isDirectory()) {
          collectPackage(join(scopeDir, scopedEntry.name));
        }
      }
      continue;
    }

    collectPackage(join(nodeModulesDir, entry.name));
  }
}

function collectPackage(packageDir) {
  const manifestPath = join(packageDir, "package.json");
  if (!existsSync(manifestPath)) {
    return;
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (typeof manifest.name !== "string" || typeof manifest.version !== "string") {
    return;
  }
  if (manifest.name.startsWith("@0disoft/mcp-security-proxy-")) {
    return;
  }

  packages.set(`${manifest.name}@${manifest.version}`, {
    key: `${manifest.name}@${manifest.version}`,
    manifest
  });
}

function normalizeLicense(value) {
  if (typeof value === "string") {
    return value.trim();
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeLicense(item)).filter(Boolean).join(" OR ");
  }
  if (value && typeof value === "object" && typeof value.type === "string") {
    return value.type.trim();
  }
  return "";
}

function licenseAllowedOrReviewed(license) {
  const parts = license
    .split(/\s+(?:OR|AND)\s+|[()/]/)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.every((part) => allowedLicenses.has(part) || reviewedLicenses.has(part));
}
