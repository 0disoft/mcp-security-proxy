import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { publishablePackages, registryUrl } from "./lib/package-consumer-smoke.mjs";
import { validatePublishedMetadata } from "./lib/registry-smoke-contract.mjs";

const repository = "0disoft/mcp-security-proxy";
const githubApiUrl = "https://api.github.com";
const githubUrl = "https://github.com";
const requestPattern =
  /^Registry Smoke receipt: version=((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?); release-run=([1-9]\d*)$/u;

if (isMainModule()) {
  generatePublicationReceipt(process.argv.slice(2), process.env).catch((error) => {
    console.error(error instanceof Error ? error.message : "publication receipt generation failed");
    process.exitCode = 1;
  });
}

export async function generatePublicationReceipt(args, environment) {
  const input = resolvePublicationReceiptInput(args, environment);
  const releaseRecordPath = `docs/ops/release-records/${input.version}.approved.release.json`;
  const bootstrapPlanPath = "docs/ops/npm-bootstrap-plan.json";
  if (!existsSync(join(process.cwd(), releaseRecordPath))) {
    throw new Error(`${releaseRecordPath} is missing`);
  }
  const releaseRecord = JSON.parse(readFileSync(join(process.cwd(), releaseRecordPath), "utf8"));
  const bootstrapPlan = JSON.parse(readFileSync(join(process.cwd(), bootstrapPlanPath), "utf8"));
  validateReleaseRecord(releaseRecordPath, releaseRecord, input.version);
  validateBootstrapPlan(bootstrapPlanPath, bootstrapPlan, releaseRecord.publicPackages);

  const token = environment.GITHUB_TOKEN || environment.GH_TOKEN;
  const tag = `v${input.version}`;
  const [releaseRun, registrySmokeRun, releaseCommit, githubRelease, registryPackages] = await Promise.all([
    readWorkflowRun(input.releaseRunId, token),
    readWorkflowRun(input.registrySmokeRunId, token),
    readTagCommit(tag, token),
    readGitHubRelease(tag, token),
    readRegistryPackages(releaseRecord.publicPackages, input.version)
  ]);

  validateWorkflowRun("release run", releaseRun, {
    id: input.releaseRunId,
    workflow: "release.yml",
    event: "push",
    headBranch: `v${input.version}`
  });
  validateWorkflowRun("registry smoke run", registrySmokeRun, {
    id: input.registrySmokeRunId,
    workflow: "registry-smoke.yml",
    event: "workflow_dispatch",
    displayTitle: input.requestTitle
  });
  if (releaseRun.head_sha !== releaseCommit) {
    throw new Error("release run head commit must match the immutable release tag commit");
  }
  validateGitHubRelease(githubRelease, {
    version: input.version,
    tag,
    tagCommit: releaseCommit,
    observedAt: input.recordedAt
  });

  const latestPublishedAt = Math.max(...registryPackages.map((item) => Date.parse(item.publishedAt)));
  if (Date.parse(registrySmokeRun.updated_at) < latestPublishedAt) {
    throw new Error("registry smoke run completed before all package versions were published");
  }
  if (Date.parse(input.recordedAt) < Date.parse(registrySmokeRun.updated_at)) {
    throw new Error("recordedAt must not precede the successful registry smoke run");
  }

  const receipt = buildPublicationReceipt({
    version: input.version,
    releaseRecordPath,
    releaseCommit,
    githubRelease,
    releaseRun,
    registrySmokeRun,
    registryPackages,
    expectedBootstrapVersion: bootstrapPlan.bootstrapVersion,
    recordedAt: input.recordedAt
  });
  const outputPath = input.outputPath;
  if (existsSync(outputPath)) {
    throw new Error(`${outputPath} already exists; publication receipts are immutable`);
  }
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  console.log(`publication receipt generated at ${outputPath}`);
  return receipt;
}

export function resolvePublicationReceiptInput(args, environment) {
  const options = parseOptions(args);
  const requestTitle = environment.MSP_PUBLICATION_RECEIPT_REQUEST;
  const request = requestTitle ? parsePublicationReceiptRequest(requestTitle) : undefined;
  const version = mergeSingleValue("version", options.version, request?.version);
  const releaseRunId = parsePositiveInteger(
    "release run id",
    mergeSingleValue("release run id", options.releaseRunId, request?.releaseRunId)
  );
  const registrySmokeRunId = parsePositiveInteger(
    "registry smoke run id",
    mergeSingleValue("registry smoke run id", options.registrySmokeRunId, environment.MSP_REGISTRY_SMOKE_RUN_ID)
  );
  if (!isExactVersion(version)) {
    throw new Error(`publication receipt version must be exact semver, received ${version || "<missing>"}`);
  }
  const recordedAt = options.recordedAt ?? new Date().toISOString();
  if (!isIsoDate(recordedAt)) {
    throw new Error("recordedAt must be an ISO-8601 timestamp");
  }
  const outputPath =
    options.outputPath ??
    environment.MSP_PUBLICATION_RECEIPT_OUTPUT ??
    (environment.MSP_PUBLICATION_RECEIPT_OUTPUT_DIR
      ? join(environment.MSP_PUBLICATION_RECEIPT_OUTPUT_DIR, `${version}.publication.json`)
      : undefined);
  if (!outputPath) {
    throw new Error(
      `${usage()}\n--output, MSP_PUBLICATION_RECEIPT_OUTPUT, or MSP_PUBLICATION_RECEIPT_OUTPUT_DIR is required`
    );
  }
  if (!outputPath.replaceAll("\\", "/").endsWith(`/${version}.publication.json`)) {
    throw new Error(`publication receipt output must end with /${version}.publication.json`);
  }
  return {
    version,
    releaseRunId,
    registrySmokeRunId,
    recordedAt,
    outputPath,
    requestTitle
  };
}

export function parsePublicationReceiptRequest(value) {
  const match = typeof value === "string" ? value.match(requestPattern) : null;
  if (!match) {
    throw new Error("registry smoke run name does not match the publication receipt request contract");
  }
  return {
    version: match[1],
    releaseRunId: parsePositiveInteger("release run id", match[2])
  };
}

export function validateWorkflowRun(label, run, expected) {
  if (!run || typeof run !== "object") {
    throw new Error(`${label} metadata is missing`);
  }
  if (run.id !== expected.id) {
    throw new Error(`${label} id does not match the requested run`);
  }
  if (run.repository?.full_name !== repository) {
    throw new Error(`${label} belongs to an unexpected repository`);
  }
  if (run.path !== `.github/workflows/${expected.workflow}`) {
    throw new Error(`${label} must use ${expected.workflow}`);
  }
  if (run.event !== expected.event) {
    throw new Error(`${label} must use the ${expected.event} event`);
  }
  if (expected.headBranch && run.head_branch !== expected.headBranch) {
    throw new Error(`${label} must run from ${expected.headBranch}`);
  }
  if (expected.displayTitle && run.display_title !== expected.displayTitle) {
    throw new Error(`${label} title does not match the receipt request`);
  }
  if (run.status !== "completed" || run.conclusion !== "success") {
    throw new Error(`${label} must be completed successfully`);
  }
  if (!isFullCommitSha(run.head_sha)) {
    throw new Error(`${label} is missing a full head commit SHA`);
  }
  if (run.html_url !== `${githubUrl}/${repository}/actions/runs/${expected.id}`) {
    throw new Error(`${label} URL does not match the requested run`);
  }
  if (!isIsoDate(run.updated_at)) {
    throw new Error(`${label} is missing a completion timestamp`);
  }
}

export function buildPublicationReceipt({
  version,
  releaseRecordPath,
  releaseCommit,
  githubRelease,
  releaseRun,
  registrySmokeRun,
  registryPackages,
  expectedBootstrapVersion,
  recordedAt
}) {
  const distTags = registryPackages[0]?.distTags;
  if (!distTags) {
    throw new Error("registry package metadata is missing dist-tags");
  }
  for (const item of registryPackages) {
    if (item.distTags.latest !== distTags.latest || item.distTags.bootstrap !== distTags.bootstrap) {
      throw new Error("published packages do not expose one consistent latest/bootstrap dist-tag set");
    }
  }
  if (distTags.latest !== version || distTags.bootstrap !== expectedBootstrapVersion) {
    throw new Error("published packages expose an invalid latest/bootstrap dist-tag set");
  }
  validateGitHubRelease(githubRelease, {
    version,
    tag: `v${version}`,
    tagCommit: releaseCommit,
    observedAt: recordedAt
  });

  return {
    schemaVersion: "msp.publication-record.v2",
    status: "completed",
    releaseVersion: version,
    tag: `v${version}`,
    releaseCommit,
    releaseRecord: releaseRecordPath,
    registryTarget: "npmjs.org",
    observedDistTags: distTags,
    publishedAt: registryPackages
      .map((item) => item.publishedAt)
      .sort((left, right) => Date.parse(left) - Date.parse(right))[0],
    recordedAt,
    githubRelease: {
      id: githubRelease.id,
      tag: githubRelease.tag_name,
      tagCommit: releaseCommit,
      draft: githubRelease.draft,
      prerelease: githubRelease.prerelease,
      publishedAt: githubRelease.published_at,
      observedAt: recordedAt,
      url: githubRelease.html_url
    },
    releaseRun: toReceiptRun(releaseRun, "release.yml"),
    registrySmokeRun: toReceiptRun(registrySmokeRun, "registry-smoke.yml"),
    packages: registryPackages.map((item) => ({
      name: item.name,
      version,
      integrity: item.integrity,
      shasum: item.shasum,
      provenance: {
        predicateType: "https://slsa.dev/provenance/v1",
        verifiedByRunId: registrySmokeRun.id
      }
    }))
  };
}

function parseOptions(args) {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  const options = {};
  const names = new Map([
    ["--version", "version"],
    ["--release-run-id", "releaseRunId"],
    ["--registry-smoke-run-id", "registrySmokeRunId"],
    ["--recorded-at", "recordedAt"],
    ["--output", "outputPath"]
  ]);
  for (let index = 0; index < normalizedArgs.length; index += 2) {
    const key = names.get(normalizedArgs[index]);
    const value = normalizedArgs[index + 1];
    if (!key || !value || options[key] !== undefined) {
      throw new Error(usage());
    }
    options[key] = value;
  }
  return options;
}

function validateReleaseRecord(path, record, version) {
  if (record?.schemaVersion !== "msp.release-readiness.v1" || record?.status !== "approved") {
    throw new Error(`${path} must be an approved msp.release-readiness.v1 record`);
  }
  if (record.releaseVersion !== version || !record.registryTarget?.startsWith("npmjs.org")) {
    throw new Error(`${path} does not approve ${version} for npmjs.org`);
  }
  const expectedNames = publishablePackages.map((item) => item.name);
  const actualNames = Array.isArray(record.publicPackages) ? record.publicPackages.map((item) => item?.name) : [];
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
    throw new Error(`${path} publicPackages must match the five publishable workspace packages in order`);
  }
}

function validateBootstrapPlan(path, plan, publicPackages) {
  if (
    plan?.schemaVersion !== "msp.npm-bootstrap.v1" ||
    plan?.status !== "completed" ||
    plan?.distTag !== "bootstrap" ||
    plan?.registry !== registryUrl ||
    !isExactVersion(plan?.bootstrapVersion)
  ) {
    throw new Error(`${path} must describe the completed npmjs.org bootstrap version`);
  }
  const expectedNames = publicPackages.map((item) => item.name);
  const actualNames = Array.isArray(plan.packages) ? plan.packages.map((item) => item?.name) : [];
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
    throw new Error(`${path} packages must match the approved public package set in order`);
  }
}

async function readWorkflowRun(runId, token) {
  return fetchJson(`${githubApiUrl}/repos/${repository}/actions/runs/${runId}`, { token });
}

async function readTagCommit(tag, token) {
  let object = (
    await fetchJson(`${githubApiUrl}/repos/${repository}/git/ref/tags/${encodeURIComponent(tag)}`, { token })
  ).object;
  for (let depth = 0; depth < 5; depth += 1) {
    if (object?.type === "commit" && isFullCommitSha(object.sha)) {
      return object.sha;
    }
    if (object?.type !== "tag" || !isFullCommitSha(object.sha)) {
      break;
    }
    object = (await fetchJson(`${githubApiUrl}/repos/${repository}/git/tags/${object.sha}`, { token })).object;
  }
  throw new Error(`release tag ${tag} does not resolve to a Git commit`);
}

async function readGitHubRelease(tag, token) {
  return fetchJson(`${githubApiUrl}/repos/${repository}/releases/tags/${encodeURIComponent(tag)}`, { token });
}

export function validateGitHubRelease(release, expected) {
  if (!release || typeof release !== "object") {
    throw new Error("GitHub Release metadata is missing");
  }
  if (!Number.isSafeInteger(release.id) || release.id <= 0) {
    throw new Error("GitHub Release id must be a positive integer");
  }
  if (release.tag_name !== expected.tag) {
    throw new Error("GitHub Release tag must match the immutable release tag");
  }
  if (!isFullCommitSha(expected.tagCommit)) {
    throw new Error("GitHub Release tag commit must be a full Git commit SHA");
  }
  if (release.draft !== false) {
    throw new Error("GitHub Release must be published, not draft");
  }
  if (release.prerelease !== hasPrerelease(expected.version)) {
    throw new Error("GitHub Release prerelease state must match the exact SemVer channel");
  }
  if (release.html_url !== `${githubUrl}/${repository}/releases/tag/${encodeURIComponent(expected.tag)}`) {
    throw new Error("GitHub Release URL must match the immutable release tag");
  }
  if (!isIsoDate(release.published_at)) {
    throw new Error("GitHub Release published_at must be an ISO-8601 timestamp");
  }
  if (!isIsoDate(expected.observedAt)) {
    throw new Error("GitHub Release observedAt must be an ISO-8601 timestamp");
  }
  if (Date.parse(expected.observedAt) < Date.parse(release.published_at)) {
    throw new Error("GitHub Release observedAt must not precede its publication time");
  }
}

async function readRegistryPackages(publicPackages, version) {
  return Promise.all(
    publicPackages.map(async (item) => {
      const packument = await fetchJson(`${registryUrl}/${encodeURIComponent(item.name)}`);
      const metadata = packument.versions?.[version];
      validatePublishedMetadata({ name: item.name }, metadata, version, registryUrl);
      if (!/^[a-f0-9]{40}$/u.test(metadata.dist?.shasum ?? "")) {
        throw new Error(`${item.name}: registry metadata is missing a lowercase SHA-1 shasum`);
      }
      const publishedAt = packument.time?.[version];
      if (!isIsoDate(publishedAt)) {
        throw new Error(`${item.name}: registry metadata is missing the publication timestamp`);
      }
      return {
        name: item.name,
        integrity: metadata.dist.integrity,
        shasum: metadata.dist.shasum,
        publishedAt,
        distTags: {
          latest: packument["dist-tags"]?.latest,
          bootstrap: packument["dist-tags"]?.bootstrap
        }
      };
    })
  );
}

async function fetchJson(url, { token } = {}) {
  const delays = [0, 1_000, 3_000];
  let lastError;
  for (const delayMs of delays) {
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    try {
      const headers = {
        Accept: "application/vnd.github+json",
        "User-Agent": "mcp-security-proxy-publication-receipt"
      };
      if (url.startsWith(`${githubApiUrl}/`)) {
        headers["X-GitHub-Api-Version"] = "2022-11-28";
        if (token) {
          headers.Authorization = `Bearer ${token}`;
        }
      }
      const response = await fetch(url, {
        headers,
        redirect: "error",
        signal: AbortSignal.timeout(15_000)
      });
      if (!response.ok) {
        throw new Error(`${new URL(url).host} returned HTTP ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function toReceiptRun(run, workflow) {
  return {
    workflow,
    id: run.id,
    headCommit: run.head_sha,
    conclusion: run.conclusion,
    url: run.html_url
  };
}

function mergeSingleValue(label, ...values) {
  const candidates = values.filter((value) => value !== undefined && value !== "");
  if (candidates.length === 0 || new Set(candidates.map(String)).size !== 1) {
    throw new Error(`publication receipt requires one unambiguous ${label}`);
  }
  return candidates[0];
}

function parsePositiveInteger(label, value) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return value;
  }
  if (typeof value !== "string" || !/^[1-9]\d*$/u.test(value)) {
    throw new Error(`${label} must be a positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${label} must be a safe positive integer`);
  }
  return parsed;
}

function isExactVersion(value) {
  return (
    typeof value === "string" &&
    /^(?!0\.0\.0$)(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u.test(
      value
    )
  );
}

function hasPrerelease(version) {
  return typeof version === "string" && version.split("+", 1)[0].includes("-");
}

function isFullCommitSha(value) {
  return typeof value === "string" && /^[a-f0-9]{40}$/u.test(value);
}

function isIsoDate(value) {
  return typeof value === "string" && value.includes("T") && !Number.isNaN(Date.parse(value));
}

function usage() {
  return (
    "usage: node scripts/generate-publication-receipt.mjs " +
    "--version <exact-semver> --release-run-id <id> --registry-smoke-run-id <id> " +
    "--output <path>/<version>.publication.json [--recorded-at <ISO-8601>]"
  );
}

function isMainModule() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
}
