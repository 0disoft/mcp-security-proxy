import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";

const root = process.cwd();
const failures = [];

const releaseRecordPattern = /^docs\/ops\/release-records\/(?:public-release\.template\.json|.+\.release\.json)$/;
const placeholderValues = new Set(["UNDECIDED", "UNRECORDED"]);
const forbiddenPathSegments = new Set([
  ".env",
  ".git",
  "build",
  "captures",
  "corpus",
  "dist",
  "exploit",
  "logs",
  "node_modules",
  "private",
  "tmp"
]);
const forbiddenTextMarkers = [
  { name: "private-key-block", pattern: /BEGIN (RSA |OPENSSH |EC |DSA )?PRIVATE KEY/ },
  { name: "raw-arguments-field", pattern: /"raw(?:Tool)?Arguments"\s*:/ },
  { name: "raw-prompt-field", pattern: /"rawPrompt"\s*:/ },
  { name: "full-prompt-field", pattern: /"fullPrompt"\s*:/ },
  { name: "environment-value-field", pattern: /"environmentValue"\s*:/ },
  { name: "raw-synthetic-leak-marker", pattern: /\bRAW_[A-Z0-9_]*_MARKER\b/ },
  { name: "unnormalized-external-fixture-root", pattern: /\bmsp-external-fixture-[A-Za-z0-9_-]+\b/ },
  { name: "windows-user-path", pattern: /[A-Za-z]:\\Users\\/ },
  { name: "posix-home-path", pattern: /\/home\/[A-Za-z0-9._-]+\// },
  { name: "npm-cache-path", pattern: /(?:^|[\\/_-])npm-cache(?:[\\/_-]|$)/i },
  { name: "package-manager-debug-log", pattern: /(?:npm|pnpm|yarn)(?:-debug|-error)?\.log|[\\/]_logs[\\/]/i },
  { name: "private-capture-marker", pattern: /private\s+(?:mcp\s+)?capture/i },
  { name: "real-log-marker", pattern: /real\s+(?:user\s+)?log/i },
  { name: "exploit-corpus-marker", pattern: /exploit\s+corpus/i },
  { name: "raw-incident-evidence-marker", pattern: /raw\s+incident\s+evidence/i }
];

const trackedFiles = execFileSync("git", ["ls-files"], {
  cwd: root,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"]
})
  .split(/\r?\n/)
  .filter(Boolean)
  .map((file) => file.replaceAll("\\", "/"));

const trackedSet = new Set(trackedFiles);
const currentHead = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"]
}).trim();

for (const file of trackedFiles) {
  if (file.startsWith("fixtures/")) {
    checkPublicFixtureFile(file);
  }
  if (releaseRecordPattern.test(file)) {
    checkReleaseRecord(file);
  }
}

checkCompatibilityManifest("fixtures/compatibility/manifest.json");
checkArtifactSafetyValidator();

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(failure);
  }
  process.exit(1);
}

function checkPublicFixtureFile(file) {
  checkRepositoryPath(file, `${file}: public fixture path`);
  if (file.startsWith("fixtures/audit/") && !basename(file).includes(".redacted.")) {
    failures.push(`${file}: public audit fixtures must be explicitly redacted`);
  }
  checkTextMarkers(file, `${file}: public fixture`);
}

function checkCompatibilityManifest(path) {
  if (!trackedSet.has(path)) {
    return;
  }
  checkCompatibilityManifestObject(path, readJson(path));
}

function checkCompatibilityManifestObject(path, manifest) {
  if (!Array.isArray(manifest.evidence)) {
    failures.push(`${path}: evidence must be an array`);
    return;
  }

  if (Array.isArray(manifest.targets)) {
    for (const [index, item] of manifest.targets.entries()) {
      for (const field of ["manifest", "summary", "harness"]) {
        const value = item?.[field];
        if (typeof value !== "string") {
          continue;
        }
        const label = `${path}: targets[${index}].${field}`;
        checkRepositoryPath(value, label);
        if (field === "harness") {
          if (!value.startsWith("scripts/")) {
            failures.push(`${label}: compatibility harness references must stay under scripts/`);
          }
        } else if (!value.startsWith("fixtures/compatibility/")) {
          failures.push(`${label}: compatibility target references must stay under fixtures/compatibility/`);
        }
        if (!trackedSet.has(value)) {
          failures.push(`${label}: referenced compatibility target file must be tracked`);
        }
      }
    }
  }

  for (const [index, item] of manifest.evidence.entries()) {
    for (const field of ["path", "policy", "call", "envelope"]) {
      const value = item?.[field];
      if (typeof value !== "string") {
        continue;
      }
      const label = `${path}: evidence[${index}].${field}`;
      checkRepositoryPath(value, label);
      if (!value.startsWith("fixtures/")) {
        failures.push(`${label}: compatibility fixture references must stay under fixtures/`);
      }
      if (!trackedSet.has(value)) {
        failures.push(`${label}: referenced fixture must be tracked`);
      }
      if (value.startsWith("fixtures/audit/") && !basename(value).includes(".redacted.")) {
        failures.push(`${label}: public audit fixture references must be explicitly redacted`);
      }
    }
  }
}

function checkReleaseRecord(path) {
  checkTextMarkers(path, `${path}: release record`);
  checkReleaseRecordObject(path, readJson(path));
}

function checkReleaseRecordObject(path, record) {
  const publicPackages = Array.isArray(record.publicPackages) ? record.publicPackages : [];
  const artifacts = Array.isArray(record.artifacts) ? record.artifacts : [];

  for (const [index, item] of publicPackages.entries()) {
    checkOptionalRepositoryPath(item?.workspacePath, `${path}: publicPackages[${index}].workspacePath`);
    checkOptionalArtifactName(item?.artifactName, `${path}: publicPackages[${index}].artifactName`);
  }

  for (const [index, item] of artifacts.entries()) {
    checkOptionalArtifactName(item?.name, `${path}: artifacts[${index}].name`);
    if (usesCurrentWorkspaceState(record)) {
      checkOptionalTrackedRepositoryPath(item?.source, `${path}: artifacts[${index}].source`);
    } else {
      checkOptionalRepositoryPath(item?.source, `${path}: artifacts[${index}].source`);
    }
  }
}

function checkOptionalRepositoryPath(value, label) {
  if (isPlaceholder(value)) {
    return;
  }
  if (typeof value !== "string") {
    failures.push(`${label}: must be a string path or placeholder`);
    return;
  }
  checkRepositoryPath(value, label);
}

function checkOptionalTrackedRepositoryPath(value, label) {
  checkOptionalRepositoryPath(value, label);
  if (!isPlaceholder(value) && typeof value === "string" && !trackedSet.has(value)) {
    failures.push(`${label}: referenced artifact source must be tracked`);
  }
}

function checkOptionalArtifactName(value, label) {
  if (isPlaceholder(value)) {
    return;
  }
  if (typeof value !== "string") {
    failures.push(`${label}: must be a string name or placeholder`);
    return;
  }
  if (value.includes("/") || value.includes("\\") || value.includes("..")) {
    failures.push(`${label}: artifact names must not contain path separators or traversal`);
  }
  checkForbiddenSegments(value, label);
}

function checkRepositoryPath(value, label) {
  if (value.includes("\\") || value.startsWith("/") || /^[A-Za-z]:/.test(value)) {
    failures.push(`${label}: paths must be repository-relative POSIX paths`);
  }
  const segments = value.split("/");
  if (segments.some((segment) => segment === ".." || segment.length === 0)) {
    failures.push(`${label}: paths must not contain traversal or empty segments`);
  }
  checkForbiddenSegments(value, label);
}

function checkForbiddenSegments(value, label) {
  for (const pathSegment of value.toLowerCase().split(/[\/\\]+/).filter(Boolean)) {
    if (pathSegment === ".env" || pathSegment.startsWith(".env.")) {
      failures.push(`${label}: forbidden public artifact path segment "${pathSegment}"`);
    }
  }
  for (const segment of value.toLowerCase().split(/[/.\\_-]+/).filter(Boolean)) {
    if (forbiddenPathSegments.has(segment)) {
      failures.push(`${label}: forbidden public artifact path segment "${segment}"`);
    }
  }
}

function checkTextMarkers(file, label) {
  const text = readFileSync(join(root, file), "utf8");
  checkTextContentMarkers(text, label);
}

function checkTextContentMarkers(text, label) {
  for (const marker of forbiddenTextMarkers) {
    if (marker.pattern.test(text)) {
      failures.push(`${label}: forbidden marker ${marker.name}`);
    }
  }
}

function checkArtifactSafetyValidator() {
  const validRecord = createArtifactSafetyReleaseRecordSelfTestFixture();
  const validRecordFailures = collectArtifactSafetyFailures(() => {
    checkTextContentMarkers(JSON.stringify(validRecord), "<artifact-safety-self-test-valid-record>");
    checkReleaseRecordObject("<artifact-safety-self-test-valid-record>", validRecord);
  });
  if (validRecordFailures.length > 0) {
    failures.push(`artifact-safety self-test valid release record failed: ${validRecordFailures.join("; ")}`);
  }

  const historicalRecordFailures = collectArtifactSafetyFailures(() => {
    checkReleaseRecordObject("<artifact-safety-self-test-historical-release-record>", {
      status: "approved",
      targetCommit: "0000000000000000000000000000000000000000",
      publicPackages: [
        {
          workspacePath: "packages/cli",
          artifactName: "historical-artifact"
        }
      ],
      artifacts: [
        {
          name: "historical-artifact",
          source: "docs/ops/historical-release-artifact.md"
        }
      ]
    });
  });
  if (historicalRecordFailures.length > 0) {
    failures.push(`artifact-safety self-test historical release record failed: ${historicalRecordFailures.join("; ")}`);
  }

  const forbiddenTextFixtures = [
    ["private-key-block", `BEGIN ${"PRIVATE"} KEY`],
    ["raw-arguments-field", '{"rawArguments":"synthetic self-test marker"}'],
    ["raw-prompt-field", '{"rawPrompt":"synthetic self-test marker"}'],
    ["full-prompt-field", '{"fullPrompt":"synthetic self-test marker"}'],
    ["environment-value-field", '{"environmentValue":"synthetic self-test marker"}'],
    ["raw-synthetic-leak-marker", "RAW_SYNTHETIC_LEAK_MARKER"],
    ["unnormalized-external-fixture-root", "msp-external-fixture-abc123"],
    ["windows-user-path", "C:\\Users\\someone\\AppData\\Local\\Temp\\file.json"],
    ["posix-home-path", "/home/someone/.npm/_logs/file.log"],
    ["npm-cache-path", "npm-cache/_logs/fixture.log"],
    ["package-manager-debug-log", "npm-debug.log"],
    ["private-capture-marker", "private mcp capture"],
    ["real-log-marker", "real user log"],
    ["exploit-corpus-marker", "exploit corpus"],
    ["raw-incident-evidence-marker", "raw incident evidence"]
  ];
  for (const [name, sample] of forbiddenTextFixtures) {
    const forbiddenTextFailures = collectArtifactSafetyFailures(() => {
      checkTextContentMarkers(sample, `<artifact-safety-self-test-forbidden-text-${name}>`);
    });
    if (!forbiddenTextFailures.some((item) => item.includes(`forbidden marker ${name}`))) {
      failures.push(`artifact-safety self-test forbidden text marker ${name} was not rejected: ${forbiddenTextFailures.join("; ")}`);
    }
  }

  const unsafeRecordFailures = collectArtifactSafetyFailures(() => {
    checkReleaseRecordObject("<artifact-safety-self-test-unsafe-release-record>", {
      publicPackages: [
        {
          workspacePath: "../private/.env",
          artifactName: "../dist/private-key.tgz"
        }
      ],
      artifacts: [
        {
          name: "capture-logs.tgz",
          source: "logs/private/capture.json"
        },
        {
          name: "local-release-directory",
          source: "docs/ops/release-records"
        }
      ]
    });
  });
  if (
    !unsafeRecordFailures.some((item) => item.includes("paths must not contain traversal or empty segments")) ||
    !unsafeRecordFailures.some((item) => item.includes("artifact names must not contain path separators or traversal")) ||
    !unsafeRecordFailures.some((item) => item.includes('forbidden public artifact path segment "logs"')) ||
    !unsafeRecordFailures.some((item) => item.includes("referenced artifact source must be tracked"))
  ) {
    failures.push(`artifact-safety self-test unsafe release record was not rejected: ${unsafeRecordFailures.join("; ")}`);
  }

  const unsafeCompatibilityFailures = collectArtifactSafetyFailures(() => {
    checkCompatibilityManifestObject("<artifact-safety-self-test-unsafe-compatibility-manifest>", {
      evidence: [
        {
          path: "private/capture.json",
          policy: "fixtures/policies/local-dev.json",
          call: "fixtures/audit/tool-call.json",
          envelope: "captures/raw-envelope.json"
        }
      ]
    });
  });
  if (
    !unsafeCompatibilityFailures.some((item) => item.includes("compatibility fixture references must stay under fixtures/")) ||
    !unsafeCompatibilityFailures.some((item) => item.includes("referenced fixture must be tracked")) ||
    !unsafeCompatibilityFailures.some((item) => item.includes("public audit fixture references must be explicitly redacted"))
  ) {
    failures.push(`artifact-safety self-test unsafe compatibility manifest was not rejected: ${unsafeCompatibilityFailures.join("; ")}`);
  }
}

function createArtifactSafetyReleaseRecordSelfTestFixture() {
  return {
    status: "proposed",
    publicPackages: [
      {
        workspacePath: "packages/cli",
        artifactName: "mcp-security-proxy-cli"
      }
    ],
    artifacts: [
      {
        name: "readme",
        source: "README.md"
      }
    ]
  };
}

function usesCurrentWorkspaceState(record) {
  return record?.status !== "approved" || record?.targetCommit === currentHead;
}

function collectArtifactSafetyFailures(fn) {
  const before = failures.length;
  fn();
  return failures.splice(before);
}

function readJson(path) {
  return JSON.parse(readFileSync(join(root, path), "utf8"));
}

function isPlaceholder(value) {
  return typeof value === "string" && placeholderValues.has(value);
}
