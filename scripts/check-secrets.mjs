import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

const detectors = [
  { name: "openai-sk", pattern: /sk-[A-Za-z0-9]{20,}/ },
  { name: "github-token", pattern: /gh[pousr]_[A-Za-z0-9_]{20,}/ },
  { name: "private-key-block", pattern: /BEGIN (RSA |OPENSSH |EC |DSA )?PRIVATE KEY/ },
  { name: "token-assignment", pattern: /\bTOKEN_[A-Z0-9_]*\s*[:=]/ },
  { name: "private-assignment", pattern: /\bPRIVATE_[A-Z0-9_]*\s*[:=]/ },
  { name: "credential-assignment", pattern: /\bCREDENTIAL[A-Z0-9_]*\s*[:=]/ },
  { name: "password-assignment", pattern: /\bpassword\s*[:=]/i },
  { name: "api-key-assignment", pattern: /\bapi[_-]?key\s*[:=]/i }
];

const ignoredTextFiles = new Set([
  "scripts/check-secrets.mjs"
]);

const trackedFiles = execFileSync("git", ["ls-files"], {
  cwd: root,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"]
})
  .split(/\r?\n/)
  .filter(Boolean)
  .filter((file) => !ignoredTextFiles.has(file.replaceAll("\\", "/")));

const findings = [];

for (const file of trackedFiles) {
  const normalized = file.replaceAll("\\", "/");
  const text = readFileSync(join(root, file), "utf8");
  findings.push(...scanTextForSecrets(normalized, text));
}

checkSecretScanValidator();

if (findings.length > 0) {
  for (const finding of findings) {
    console.error(finding);
  }
  process.exit(1);
}

function scanTextForSecrets(label, text) {
  const matches = [];
  const lines = text.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    for (const detector of detectors) {
      if (detector.pattern.test(line)) {
        matches.push(`${label}:${index + 1}: secret-like match (${detector.name})`);
      }
    }
  }
  return matches;
}

function checkSecretScanValidator() {
  const detectorFixtures = [
    ["openai-sk", "sk-abcdefghijklmnopqrstuvwxyz"],
    ["github-token", "ghp_abcdefghijklmnopqrstuvwxyz"],
    ["private-key-block", "-----BEGIN PRIVATE KEY-----"],
    ["token-assignment", "TOKEN_EXAMPLE: value"],
    ["private-assignment", "PRIVATE_EXAMPLE=value"],
    ["credential-assignment", "CREDENTIAL_EXAMPLE=value"],
    ["password-assignment", "password: value"],
    ["api-key-assignment", "api_key=value"]
  ];

  for (const [name, sample] of detectorFixtures) {
    const sampleFindings = scanTextForSecrets(`<secret-scan-self-test-${name}>`, sample);
    if (!sampleFindings.some((item) => item.includes(`secret-like match (${name})`))) {
      findings.push(`secret-scan self-test detector ${name} did not match its synthetic fixture`);
    }
  }

  const safeFindings = scanTextForSecrets("<secret-scan-self-test-safe>", "policy id: local-development");
  if (safeFindings.length > 0) {
    findings.push(`secret-scan self-test safe fixture produced findings: ${safeFindings.join("; ")}`);
  }
}
