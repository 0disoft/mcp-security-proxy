import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const failures = [];

const requiredGitignorePatterns = [
  "*.log",
  ".env",
  ".env.*",
  "!.env.example",
  "node_modules/",
  "dist/",
  "build/",
  "coverage/",
  ".cache/",
  ".tmp/",
  "tmp/",
  "*.tsbuildinfo"
];

const requiredGitattributesLines = [
  "* text=auto eol=lf",
  "*.md text eol=lf",
  "*.yml text eol=lf",
  "*.json text eol=lf",
  "*.ts text eol=lf",
  "*.mjs text eol=lf",
  "*.png binary",
  "*.pdf binary",
  "*.tgz binary"
];

const requiredEditorconfigLines = [
  "root = true",
  "charset = utf-8",
  "end_of_line = lf",
  "insert_final_newline = true",
  "indent_style = space",
  "trim_trailing_whitespace = true"
];

const forbiddenTrackedPathPatterns = [
  { name: "environment file", pattern: /(^|\/)\.env(?:\.|$)/ },
  { name: "node_modules", pattern: /(^|\/)node_modules\// },
  { name: "dist output", pattern: /(^|\/)dist\// },
  { name: "build output", pattern: /(^|\/)build\// },
  { name: "coverage output", pattern: /(^|\/)coverage\// },
  { name: "cache output", pattern: /(^|\/)(?:\.cache|cache)\// },
  { name: "temporary output", pattern: /(^|\/)(?:\.tmp|tmp)\// },
  { name: "TypeScript build info", pattern: /\.tsbuildinfo$/ },
  { name: "log file", pattern: /(?:^|\/|\.)(?:debug\.)?log$/ },
  { name: "npm package archive", pattern: /\.tgz$/ }
];

const textExtensions = new Set([
  ".cjs",
  ".css",
  ".dbml",
  ".editorconfig",
  ".gitignore",
  ".gitattributes",
  ".js",
  ".json",
  ".jsonl",
  ".md",
  ".mjs",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml"
]);

const trackedFiles = execFileSync("git", ["ls-files"], {
  cwd: root,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"]
})
  .split(/\r?\n/)
  .filter(Boolean)
  .map((file) => file.replaceAll("\\", "/"));

checkRequiredLines(".gitignore", requiredGitignorePatterns);
checkRequiredLines(".gitattributes", requiredGitattributesLines);
checkRequiredLines(".editorconfig", requiredEditorconfigLines);
checkTrackedPaths();
checkTrackedTextFiles();

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(failure);
  }
  process.exit(1);
}

function checkRequiredLines(path, requiredLines) {
  const lines = readText(path)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const lineSet = new Set(lines);
  for (const requiredLine of requiredLines) {
    if (!lineSet.has(requiredLine)) {
      failures.push(`${path}: missing required hygiene rule "${requiredLine}"`);
    }
  }
}

function checkTrackedPaths() {
  for (const file of trackedFiles) {
    for (const forbidden of forbiddenTrackedPathPatterns) {
      if (forbidden.pattern.test(file)) {
        failures.push(`${file}: tracked ${forbidden.name} is not allowed`);
      }
    }
  }
}

function checkTrackedTextFiles() {
  for (const file of trackedFiles) {
    if (!isTextFile(file)) {
      continue;
    }
    const bytes = readFileSync(join(root, file));
    if (bytes.includes(13)) {
      failures.push(`${file}: tracked text file must use LF line endings`);
    }
    if (bytes.length > 0 && bytes[bytes.length - 1] !== 10) {
      failures.push(`${file}: tracked text file must end with a newline`);
    }
  }
}

function isTextFile(file) {
  if (file === ".editorconfig" || file === ".gitignore" || file === ".gitattributes") {
    return true;
  }
  const lastDot = file.lastIndexOf(".");
  if (lastDot === -1) {
    return false;
  }
  return textExtensions.has(file.slice(lastDot).toLowerCase());
}

function readText(path) {
  return readFileSync(join(root, path), "utf8");
}
