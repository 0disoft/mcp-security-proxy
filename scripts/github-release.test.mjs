import assert from "node:assert/strict";
import test from "node:test";
import { createOrVerifyGitHubRelease, resolveGitHubReleaseInput } from "./create-github-release.mjs";

const repository = "0disoft/mcp-security-proxy";
const token = "test-token-not-a-credential";

test("creates a prerelease only after verifying the immutable tag exists", async () => {
  const requests = [];
  const fetchImpl = createFetch(
    [response(404), response(200, tagRef("v0.2.0-alpha.4")), response(201, release("v0.2.0-alpha.4", true))],
    requests
  );

  const result = await createOrVerifyGitHubRelease([], workflowEnvironment("v0.2.0-alpha.4"), fetchImpl);

  assert.deepEqual(result, {
    status: "created",
    url: "https://github.com/0disoft/mcp-security-proxy/releases/tag/v0.2.0-alpha.4"
  });
  assert.deepEqual(
    requests.map((item) => item.method),
    ["GET", "GET", "POST"]
  );
  assert.deepEqual(JSON.parse(requests[2].body), {
    tag_name: "v0.2.0-alpha.4",
    name: "v0.2.0-alpha.4",
    draft: false,
    prerelease: true,
    generate_release_notes: true,
    make_latest: "false"
  });
  assert.equal(requests[0].authorization, `Bearer ${token}`);
});

test("verifies an existing matching release without creating another", async () => {
  const requests = [];
  const result = await createOrVerifyGitHubRelease(
    ["--repository", repository, "--tag", "v1.0.0"],
    { GITHUB_TOKEN: token },
    createFetch([response(200, release("v1.0.0", false))], requests)
  );

  assert.equal(result.status, "verified");
  assert.deepEqual(
    requests.map((item) => item.method),
    ["GET"]
  );
});

test("rejects an existing release with the wrong channel", async () => {
  await assert.rejects(
    createOrVerifyGitHubRelease(
      [],
      workflowEnvironment("v0.2.0-alpha.4"),
      createFetch([response(200, release("v0.2.0-alpha.4", false))], [])
    ),
    /does not match the expected published channel/u
  );
});

test("does not create a release when the tag is absent", async () => {
  const requests = [];
  await assert.rejects(
    createOrVerifyGitHubRelease(
      [],
      workflowEnvironment("v0.2.0-alpha.4"),
      createFetch([response(404), response(404)], requests)
    ),
    /requires existing tag/u
  );
  assert.deepEqual(
    requests.map((item) => item.method),
    ["GET", "GET"]
  );
});

test("reconciles a concurrent create response with the resulting release", async () => {
  const requests = [];
  const result = await createOrVerifyGitHubRelease(
    [],
    workflowEnvironment("v0.2.0-alpha.4"),
    createFetch(
      [
        response(404),
        response(200, tagRef("v0.2.0-alpha.4")),
        response(422),
        response(200, release("v0.2.0-alpha.4", true))
      ],
      requests
    )
  );

  assert.equal(result.status, "verified");
  assert.deepEqual(
    requests.map((item) => item.method),
    ["GET", "GET", "POST", "GET"]
  );
});

test("rejects ambiguous, unsafe, or non-tag inputs before network access", () => {
  assert.throws(
    () =>
      resolveGitHubReleaseInput([], { GITHUB_REPOSITORY: repository, GITHUB_REF_NAME: "main", GITHUB_TOKEN: token }),
    /exact vMAJOR/u
  );
  assert.throws(
    () =>
      resolveGitHubReleaseInput(["--repository", "other/repository", "--tag", "v1.0.0"], {
        GITHUB_REPOSITORY: repository,
        GITHUB_TOKEN: token
      }),
    /unambiguous repository/u
  );
  assert.throws(
    () => resolveGitHubReleaseInput(["--repository", "../unsafe", "--tag", "v1.0.0"], { GITHUB_TOKEN: token }),
    /safe owner\/name/u
  );
  assert.throws(
    () => resolveGitHubReleaseInput(["--repository", repository, "--tag", "v1.0.0"], {}),
    /GITHUB_TOKEN is required/u
  );
});

function workflowEnvironment(tag) {
  return {
    GITHUB_REPOSITORY: repository,
    GITHUB_REF_TYPE: "tag",
    GITHUB_REF_NAME: tag,
    GITHUB_TOKEN: token
  };
}

function release(tag, prerelease) {
  return {
    tag_name: tag,
    draft: false,
    prerelease,
    html_url: `https://github.com/${repository}/releases/tag/${tag}`
  };
}

function tagRef(tag) {
  return {
    ref: `refs/tags/${tag}`,
    object: {
      type: "commit",
      sha: "1fbcbe224fa494c059799b3e34b1ee4d80b7cb6d"
    }
  };
}

function response(status, body) {
  return new Response(body === undefined ? undefined : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function createFetch(responses, requests) {
  return async (url, options) => {
    const next = responses.shift();
    assert.ok(next, `unexpected request ${options.method} ${url}`);
    requests.push({
      url,
      method: options.method,
      body: options.body,
      authorization: options.headers.Authorization
    });
    return next;
  };
}
