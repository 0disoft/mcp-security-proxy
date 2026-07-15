export function resolveExpectedVersion(args, environment) {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  let argumentVersion;
  for (let index = 0; index < normalizedArgs.length; index += 1) {
    if (normalizedArgs[index] !== "--version" || !normalizedArgs[index + 1] || argumentVersion) {
      throw new Error("usage: pnpm run registry-smoke -- --version <exact-semver>");
    }
    argumentVersion = normalizedArgs[index + 1];
    index += 1;
  }
  const tagVersion =
    environment.GITHUB_REF_TYPE === "tag" && environment.GITHUB_REF_NAME?.startsWith("v")
      ? environment.GITHUB_REF_NAME.slice(1)
      : undefined;
  const candidates = [argumentVersion, environment.MSP_REGISTRY_SMOKE_VERSION, tagVersion].filter(Boolean);
  if (candidates.length === 0 || new Set(candidates).size !== 1) {
    throw new Error("registry smoke requires one unambiguous exact version");
  }
  const version = candidates[0];
  if (
    !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u.test(
      version
    )
  ) {
    throw new Error(`registry smoke version must be exact semver, received ${version}`);
  }
  return version;
}

export function validatePublishedMetadata(spec, metadata, version, registryUrl) {
  if (metadata.version !== version) {
    throw new Error(`${spec.name}: registry returned ${metadata.version || "<missing>"}, expected ${version}`);
  }
  if (typeof metadata.dist?.integrity !== "string" || !metadata.dist.integrity.startsWith("sha512-")) {
    throw new Error(`${spec.name}: registry metadata is missing sha512 integrity`);
  }
  if (!metadata.dist?.tarball?.startsWith(`${registryUrl}/${spec.name}/-/`)) {
    throw new Error(`${spec.name}: registry tarball URL is outside npmjs.org`);
  }
  const attestations = metadata.dist?.attestations;
  if (
    typeof attestations?.url !== "string" ||
    !attestations.url.startsWith(`${registryUrl}/-/npm/v1/attestations/`) ||
    attestations.provenance?.predicateType !== "https://slsa.dev/provenance/v1"
  ) {
    throw new Error(`${spec.name}: registry metadata is missing npm SLSA provenance`);
  }
  return metadata;
}
