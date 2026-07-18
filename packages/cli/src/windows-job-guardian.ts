import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { win32 } from "node:path";

const READY_LINE = "MSP_JOB_GUARDIAN_READY";
const MAX_DIAGNOSTIC_BYTES = 4_096;
const DEFAULT_READY_TIMEOUT_MS = 10_000;

const guardianSource = String.raw`
$ErrorActionPreference = 'Stop'

Add-Type -Language CSharp -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class MspJobGuardianNative
{
    [StructLayout(LayoutKind.Sequential)]
    public struct IO_COUNTERS
    {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct JOBOBJECT_BASIC_LIMIT_INFORMATION
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern IntPtr CreateJobObject(IntPtr jobAttributes, string name);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool SetInformationJobObject(
        IntPtr job,
        int informationClass,
        ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION information,
        uint informationLength);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr OpenProcess(uint desiredAccess, bool inheritHandle, uint processId);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool CloseHandle(IntPtr handle);
}
'@

$job = [IntPtr]::Zero
$parent = [IntPtr]::Zero

try {
    $targetPidText = [Environment]::GetEnvironmentVariable('MSP_PROXY_PARENT_PID')
    [UInt32]$targetPid = 0
    if (-not [UInt32]::TryParse($targetPidText, [ref]$targetPid) -or $targetPid -eq 0) {
        throw [InvalidOperationException]::new('invalid parent process id')
    }

    $job = [MspJobGuardianNative]::CreateJobObject([IntPtr]::Zero, $null)
    if ($job -eq [IntPtr]::Zero) {
        throw [ComponentModel.Win32Exception]::new([Runtime.InteropServices.Marshal]::GetLastWin32Error())
    }

    $basic = New-Object MspJobGuardianNative+JOBOBJECT_BASIC_LIMIT_INFORMATION
    $basic.LimitFlags = 0x00002000
    $limits = New-Object MspJobGuardianNative+JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    $limits.BasicLimitInformation = $basic
    $limitSize = [Runtime.InteropServices.Marshal]::SizeOf([type][MspJobGuardianNative+JOBOBJECT_EXTENDED_LIMIT_INFORMATION])
    if (-not [MspJobGuardianNative]::SetInformationJobObject($job, 9, [ref]$limits, $limitSize)) {
        throw [ComponentModel.Win32Exception]::new([Runtime.InteropServices.Marshal]::GetLastWin32Error())
    }

    $parentAccess = 0x00100000 -bor 0x00000100 -bor 0x00000001
    $parent = [MspJobGuardianNative]::OpenProcess($parentAccess, $false, $targetPid)
    if ($parent -eq [IntPtr]::Zero) {
        throw [ComponentModel.Win32Exception]::new([Runtime.InteropServices.Marshal]::GetLastWin32Error())
    }
    if (-not [MspJobGuardianNative]::AssignProcessToJobObject($job, $parent)) {
        throw [ComponentModel.Win32Exception]::new([Runtime.InteropServices.Marshal]::GetLastWin32Error())
    }

    [Console]::Out.WriteLine('${READY_LINE}')
    [Console]::Out.Flush()
    $waitResult = [MspJobGuardianNative]::WaitForSingleObject($parent, [UInt32]::MaxValue)
    if ($waitResult -ne 0) {
        throw [ComponentModel.Win32Exception]::new([Runtime.InteropServices.Marshal]::GetLastWin32Error())
    }
}
catch {
    $nativeCode = 1
    if ($_.Exception -is [ComponentModel.Win32Exception]) {
        $nativeCode = $_.Exception.NativeErrorCode
    }
    [Console]::Error.WriteLine('MSP_JOB_GUARDIAN_ERROR:{0}' -f $nativeCode)
    exit 1
}
finally {
    if ($parent -ne [IntPtr]::Zero) {
        [void][MspJobGuardianNative]::CloseHandle($parent)
    }
    if ($job -ne [IntPtr]::Zero) {
        [void][MspJobGuardianNative]::CloseHandle($job)
    }
}
`;

export class WindowsProcessContainmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WindowsProcessContainmentError";
  }
}

interface WindowsJobGuardianDependencies {
  readonly platform?: NodeJS.Platform;
  readonly pid?: number;
  readonly environment?: NodeJS.ProcessEnv;
  readonly fileExists?: (path: string) => boolean;
  readonly spawnGuardian?: typeof spawn;
  readonly readyTimeoutMs?: number;
}

export async function establishWindowsKillOnCloseGuardian(
  dependencies: WindowsJobGuardianDependencies = {}
): Promise<void> {
  const platform = dependencies.platform ?? process.platform;
  if (platform !== "win32") {
    return;
  }

  const pid = dependencies.pid ?? process.pid;
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    throw new WindowsProcessContainmentError("Windows process containment received an invalid parent PID");
  }
  const environment = dependencies.environment ?? process.env;
  const executable = resolveSystemPowerShell(environment, dependencies.fileExists ?? existsSync);
  const encodedCommand = Buffer.from(guardianSource, "utf16le").toString("base64");
  const spawnGuardian = dependencies.spawnGuardian ?? spawn;
  const guardian = spawnGuardian(
    executable,
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encodedCommand],
    {
      env: createGuardianEnvironment(environment, pid),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    }
  );

  if (!guardian.stdout || !guardian.stderr) {
    guardian.kill("SIGKILL");
    throw new WindowsProcessContainmentError("Windows process containment failed to create guardian pipes");
  }
  await waitForGuardianReady(guardian, dependencies.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS);
}

export function resolveSystemPowerShell(
  environment: NodeJS.ProcessEnv,
  fileExists: (path: string) => boolean = existsSync
): string {
  const systemRoot =
    readWindowsEnvironmentValue(environment, "SystemRoot") ?? readWindowsEnvironmentValue(environment, "WINDIR");
  if (!systemRoot || !win32.isAbsolute(systemRoot)) {
    throw new WindowsProcessContainmentError("Windows process containment requires an absolute SystemRoot");
  }
  const executable = win32.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  if (!fileExists(executable)) {
    throw new WindowsProcessContainmentError("Windows process containment requires system PowerShell");
  }
  return executable;
}

export function decodeGuardianSource(encodedCommand: string): string {
  return Buffer.from(encodedCommand, "base64").toString("utf16le");
}

function createGuardianEnvironment(environment: NodeJS.ProcessEnv, pid: number): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {
    MSP_PROXY_PARENT_PID: String(pid)
  };
  for (const name of ["SystemRoot", "WINDIR", "TEMP", "TMP"] as const) {
    const value = readWindowsEnvironmentValue(environment, name);
    if (value) {
      result[name] = value;
    }
  }
  return result;
}

function readWindowsEnvironmentValue(environment: NodeJS.ProcessEnv, targetName: string): string | undefined {
  const sourceName = Object.keys(environment).find((name) => name.toLowerCase() === targetName.toLowerCase());
  return sourceName === undefined ? undefined : environment[sourceName];
}

function waitForGuardianReady(guardian: ChildProcess, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => {
      fail("Windows process containment guardian timed out");
    }, timeoutMs);

    const cleanup = (): void => {
      clearTimeout(timeout);
      guardian.stdout?.off("data", onStdout);
      guardian.stderr?.off("data", onStderr);
      guardian.off("error", onError);
      guardian.off("exit", onExit);
    };
    const succeed = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve();
    };
    const fail = (message: string): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      if (guardian.exitCode === null) {
        guardian.kill("SIGKILL");
      }
      reject(new WindowsProcessContainmentError(message));
    };
    const onStdout = (chunk: Buffer | string): void => {
      stdout = appendBounded(stdout, chunk);
      if (stdout.split(/\r?\n/u).includes(READY_LINE)) {
        succeed();
      }
    };
    const onStderr = (chunk: Buffer | string): void => {
      stderr = appendBounded(stderr, chunk);
    };
    const onError = (): void => fail("Windows process containment guardian failed to start");
    const onExit = (code: number | null): void => {
      const errorCode = extractGuardianErrorCode(stderr);
      fail(`Windows process containment guardian exited before readiness (code ${errorCode ?? code ?? 1})`);
    };

    guardian.stdout?.on("data", onStdout);
    guardian.stderr?.on("data", onStderr);
    guardian.once("error", onError);
    guardian.once("exit", onExit);
  });
}

function appendBounded(current: string, chunk: Buffer | string): string {
  return `${current}${chunk.toString()}`.slice(-MAX_DIAGNOSTIC_BYTES);
}

function extractGuardianErrorCode(stderr: string): number | undefined {
  const match = stderr.match(/(?:^|\r?\n)MSP_JOB_GUARDIAN_ERROR:(\d+)(?:\r?\n|$)/u);
  if (!match?.[1]) {
    return undefined;
  }
  const value = Number(match[1]);
  return Number.isSafeInteger(value) ? value : undefined;
}
