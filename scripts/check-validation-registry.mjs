import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const failures = [];
const nonValidationScripts = new Set(["build"]);
const postReleaseValidations = new Set(["registry-smoke"]);

const validationNames = extractStandardValidationNames("VALIDATION.md");
const validationSet = new Set(validationNames);

for (const file of readdirSync(join(root, ".agents", "validations"))
  .filter((name) => name.endsWith(".md"))
  .sort()) {
  const path = `.agents/validations/${file}`;
  const names = extractStandardValidationNames(path);
  assertArrayEqual(path, names, validationNames);
}

checkPackageScripts();
checkReleaseReadinessScript();
checkReleaseTemplate();
checkReleaseScopeRegistry();
checkReleaseRecordsReadme();
checkRequiredValidationMentions();

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(failure);
  }
  process.exit(1);
}

function checkPackageScripts() {
  const manifest = readJson("package.json");
  const scripts = manifest.scripts ?? {};
  for (const scriptName of Object.keys(scripts).sort()) {
    if (nonValidationScripts.has(scriptName)) {
      continue;
    }
    if (!validationSet.has(scriptName)) {
      failures.push(`package.json: script "${scriptName}" is not listed in VALIDATION.md`);
    }
  }

  const checkCommand = scripts.check;
  if (typeof checkCommand !== "string") {
    failures.push("package.json: check script is missing");
    return;
  }

  const checkSteps = checkCommand.split("&&").map((step) => step.trim());
  const checkValidationNames = [];
  for (const step of checkSteps) {
    const match = step.match(/^pnpm(?: run)? ([a-z0-9-]+)$/);
    if (!match) {
      failures.push(`package.json: unsupported check step "${step}"`);
      continue;
    }
    const name = match[1];
    if (!validationSet.has(name)) {
      failures.push(`package.json: check step "${name}" is not listed in VALIDATION.md`);
      continue;
    }
    if (name === "check") {
      failures.push("package.json: check must not invoke itself");
    }
    checkValidationNames.push(name);
  }

  assertNoDuplicates("package.json: check steps", checkValidationNames);

  for (const scriptName of Object.keys(scripts).sort()) {
    if (scriptName === "check" || nonValidationScripts.has(scriptName)) {
      continue;
    }
    if (!checkValidationNames.includes(scriptName) && !postReleaseValidations.has(scriptName)) {
      failures.push(`package.json: script "${scriptName}" is configured but missing from check`);
    }
  }

  for (const name of postReleaseValidations) {
    if (!validationSet.has(name)) {
      failures.push(`post-release validation "${name}" is not listed in VALIDATION.md`);
    }
    if (typeof scripts[name] !== "string") {
      failures.push(`post-release validation "${name}" has no package.json script`);
    }
    if (checkValidationNames.includes(name)) {
      failures.push(`post-release validation "${name}" must not run in the offline check aggregate`);
    }
  }
}

function checkReleaseReadinessScript() {
  const names = extractStringArray("scripts/check-release-readiness.mjs", "requiredValidations");
  for (const name of names) {
    if (!validationSet.has(name)) {
      failures.push(`scripts/check-release-readiness.mjs: unknown validation "${name}"`);
    }
  }
  assertNoDuplicates("scripts/check-release-readiness.mjs: requiredValidations", names);
}

function checkReleaseTemplate() {
  const template = readJson("docs/ops/release-records/public-release.template.json");
  const validationKeys = Object.keys(template.validation ?? {});
  const releaseRequired = extractStringArray("scripts/check-release-readiness.mjs", "requiredValidations");
  assertArrayEqual(
    "docs/ops/release-records/public-release.template.json: validation keys",
    validationKeys,
    releaseRequired
  );
}

function checkReleaseScopeRegistry() {
  const path = "docs/ops/release-records/public-release.template.json";
  const template = readJson(path);
  const releaseScopeKeys = Object.keys(template.releaseScope ?? {});
  const requiredScopeKeys = extractStringArray("scripts/check-release-readiness.mjs", "requiredReleaseScopeDecisions");
  assertArrayEqual(`${path}: releaseScope keys`, releaseScopeKeys, requiredScopeKeys);

  const readmePath = "docs/ops/release-records/README.md";
  const readme = readText(readmePath);
  for (const name of requiredScopeKeys) {
    if (!readme.includes(`\`${name}\``)) {
      failures.push(`${readmePath}: missing release scope key mention for ${name}`);
    }
  }
}

function checkReleaseRecordsReadme() {
  const path = "docs/ops/release-records/README.md";
  const text = readText(path);
  const releaseRequired = extractStringArray("scripts/check-release-readiness.mjs", "requiredValidations");
  for (const name of releaseRequired) {
    if (!text.includes(`\`${name}\``)) {
      failures.push(`${path}: missing release validation evidence mention for ${name}`);
    }
  }
  if (!text.includes("pnpm run check")) {
    failures.push(`${path}: must mention pnpm run check as the release validation aggregate`);
  }
}

function checkRequiredValidationMentions() {
  const trackedMarkdown = execFileSync("git", ["ls-files", "*.md"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  })
    .split(/\r?\n/)
    .filter(Boolean)
    .map((file) => file.replaceAll("\\", "/"));

  for (const file of trackedMarkdown) {
    const lines = readText(file).split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (!line.trimStart().startsWith("- Required validation names:")) {
        continue;
      }
      const block = [line];
      let nextIndex = index + 1;
      while (nextIndex < lines.length && /^\s{2,}\S/.test(lines[nextIndex])) {
        block.push(lines[nextIndex]);
        nextIndex += 1;
      }
      for (const name of parseValidationNameList(block.join(" "))) {
        if (!validationSet.has(name)) {
          failures.push(`${file}:${index + 1}: unknown required validation "${name}"`);
        }
      }
    }
  }
}

function extractStandardValidationNames(path) {
  const lines = readText(path).split(/\r?\n/);
  const names = [];
  let inSection = false;
  for (const line of lines) {
    if (line.trim() === "## Standard Validation Names") {
      inSection = true;
      continue;
    }
    if (inSection && line.startsWith("## ")) {
      break;
    }
    if (inSection) {
      const match = line.match(/^- ([a-z0-9-]+)$/);
      if (match) {
        names.push(match[1]);
      }
    }
  }
  if (names.length === 0) {
    failures.push(`${path}: missing Standard Validation Names entries`);
  }
  assertNoDuplicates(`${path}: Standard Validation Names`, names);
  return names;
}

function extractStringArray(path, constName) {
  const text = readText(path);
  const pattern = new RegExp(`const\\s+${constName}\\s*=\\s*\\[([\\s\\S]*?)\\];`);
  const match = text.match(pattern);
  if (!match) {
    failures.push(`${path}: missing ${constName} string array`);
    return [];
  }
  return [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]);
}

function parseValidationNameList(text) {
  return text
    .replace(/^- Required validation names:\s*/, "")
    .replace(/\bwhen commands exist\b/g, "")
    .replace(/\.$/, "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function assertArrayEqual(label, actual, expected) {
  const actualText = JSON.stringify(actual);
  const expectedText = JSON.stringify(expected);
  if (actualText !== expectedText) {
    failures.push(`${label}: expected ${expectedText}, got ${actualText}`);
  }
}

function assertNoDuplicates(label, values) {
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) {
      failures.push(`${label}: duplicate "${value}"`);
    }
    seen.add(value);
  }
}

function readJson(path) {
  return JSON.parse(readText(path));
}

function readText(path) {
  return readFileSync(join(root, path), "utf8");
}
