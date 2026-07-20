import { pathToFileURL } from "node:url";

const githubApiUrl = "https://api.github.com";
const githubUrl = "https://github.com";
const githubApiVersion = "2022-11-28";
const exactTagPattern =
  /^v((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?)$/u;
const repositorySegmentPattern = /^[A-Za-z0-9](?:[A-Za-z0-9_.-]*[A-Za-z0-9])?$/u;

if (isMainModule()) {
  createOrVerifyGitHubRelease(process.argv.slice(2), process.env)
    .then((result) => {
      console.log(`GitHub release ${result.status}: ${result.url}`);
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : "GitHub release creation failed");
      process.exitCode = 1;
    });
}

export async function createOrVerifyGitHubRelease(args, environment, fetchImpl = fetch) {
  const input = resolveGitHubReleaseInput(args, environment);
  const existing = await readReleaseByTag(input, fetchImpl);
  if (existing.status === 200) {
    return toResult("verified", validateRelease(existing.body, input));
  }

  await verifyTagExists(input, fetchImpl);
  const created = await requestGitHub(input, fetchImpl, "POST", "/releases", {
    tag_name: input.tag,
    name: input.tag,
    draft: false,
    prerelease: input.prerelease,
    generate_release_notes: true,
    make_latest: input.prerelease ? "false" : "true"
  });
  if (created.status === 201) {
    return toResult("created", validateRelease(created.body, input));
  }
  if (created.status === 422) {
    const raced = await readReleaseByTag(input, fetchImpl);
    if (raced.status === 200) {
      return toResult("verified", validateRelease(raced.body, input));
    }
  }
  throw new Error(`GitHub API could not create release for existing tag ${input.tag} (HTTP ${created.status})`);
}

export function resolveGitHubReleaseInput(args, environment) {
  const parsed = parseArgs(args);
  if (environment.GITHUB_REF_TYPE && environment.GITHUB_REF_TYPE !== "tag") {
    throw new Error("GitHub release creation requires a tag ref");
  }
  const repository = mergeSingleValue("repository", parsed.repository, environment.GITHUB_REPOSITORY);
  const tag = mergeSingleValue("tag", parsed.tag, environment.GITHUB_REF_NAME);
  const token = environment.GITHUB_TOKEN;

  validateRepository(repository);
  const match = tag.match(exactTagPattern);
  if (!match) {
    throw new Error("release tag must be exact vMAJOR.MINOR.PATCH[-PRERELEASE][+BUILD] SemVer");
  }
  if (typeof token !== "string" || token.length === 0) {
    throw new Error("GITHUB_TOKEN is required for GitHub release creation");
  }

  return {
    repository,
    tag,
    token,
    prerelease: match[1].includes("-")
  };
}

async function readReleaseByTag(input, fetchImpl) {
  return requestGitHub(input, fetchImpl, "GET", `/releases/tags/${encodeURIComponent(input.tag)}`);
}

async function verifyTagExists(input, fetchImpl) {
  const response = await requestGitHub(input, fetchImpl, "GET", `/git/ref/tags/${encodeURIComponent(input.tag)}`);
  if (response.status !== 200) {
    throw new Error(`GitHub release creation requires existing tag ${input.tag}`);
  }
  if (
    response.body?.ref !== `refs/tags/${input.tag}` ||
    !["commit", "tag"].includes(response.body?.object?.type) ||
    !/^[a-f0-9]{40}$/u.test(response.body?.object?.sha ?? "")
  ) {
    throw new Error(`GitHub tag ${input.tag} returned an invalid ref object`);
  }
}

async function requestGitHub(input, fetchImpl, method, path, body) {
  const response = await fetchImpl(`${githubApiUrl}/repos/${encodeRepository(input.repository)}${path}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${input.token}`,
      "Content-Type": "application/json",
      "User-Agent": "mcp-security-proxy-release",
      "X-GitHub-Api-Version": githubApiVersion
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "error",
    signal: AbortSignal.timeout(15_000)
  });

  if (![200, 201, 404, 422].includes(response.status)) {
    throw new Error(`GitHub API ${method} ${path} returned HTTP ${response.status}`);
  }
  return {
    status: response.status,
    body: response.status === 200 || response.status === 201 ? await response.json() : undefined
  };
}

function validateRelease(release, input) {
  if (release?.tag_name !== input.tag || release?.draft !== false || release?.prerelease !== input.prerelease) {
    throw new Error(`GitHub release for ${input.tag} does not match the expected published channel`);
  }
  const expectedUrlPrefix = `${githubUrl}/${input.repository}/releases/tag/`;
  if (typeof release.html_url !== "string" || !release.html_url.startsWith(expectedUrlPrefix)) {
    throw new Error(`GitHub release for ${input.tag} returned an unexpected public URL`);
  }
  return release;
}

function toResult(status, release) {
  return { status, url: release.html_url };
}

function parseArgs(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!value || (key !== "--repository" && key !== "--tag")) {
      throw new Error("usage: node scripts/create-github-release.mjs [--repository owner/repo --tag vSEMVER]");
    }
    const property = key.slice(2);
    if (result[property] !== undefined) {
      throw new Error(`duplicate ${key} argument`);
    }
    result[property] = value;
  }
  return result;
}

function mergeSingleValue(label, ...values) {
  const candidates = values.filter((value) => value !== undefined && value !== "");
  if (candidates.length === 0 || new Set(candidates).size !== 1) {
    throw new Error(`GitHub release creation requires one unambiguous ${label}`);
  }
  return candidates[0];
}

function validateRepository(repository) {
  const segments = repository.split("/");
  if (
    segments.length !== 2 ||
    segments.some(
      (segment) =>
        !repositorySegmentPattern.test(segment) || segment === "." || segment === ".." || segment.length > 100
    )
  ) {
    throw new Error("repository must use a safe owner/name value");
  }
}

function encodeRepository(repository) {
  return repository.split("/").map(encodeURIComponent).join("/");
}

function isMainModule() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
}
