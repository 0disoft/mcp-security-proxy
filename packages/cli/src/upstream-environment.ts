const posixEnvironmentAllowlist = ["PATH", "TMPDIR"] as const;
const windowsEnvironmentAllowlist = ["PATH", "PATHEXT", "SystemRoot", "WINDIR", "ComSpec", "TEMP", "TMP"] as const;

export function createUpstreamEnvironment(
  source: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform
): NodeJS.ProcessEnv {
  const allowedNames = platform === "win32" ? windowsEnvironmentAllowlist : posixEnvironmentAllowlist;
  const output: NodeJS.ProcessEnv = {};

  for (const allowedName of allowedNames) {
    const sourceName =
      platform === "win32"
        ? Object.keys(source).find((name) => name.toLowerCase() === allowedName.toLowerCase())
        : allowedName;
    if (sourceName !== undefined && source[sourceName] !== undefined) {
      output[allowedName] = source[sourceName];
    }
  }

  return output;
}
