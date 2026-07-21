import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isExactPublicationVersion, validatePublicationRecord } from "./lib/publication-record-validation.mjs";

const maximumReceiptBytes = 1024 * 1024;

if (isMainModule()) {
  try {
    const result = importPublicationReceipt(process.argv.slice(2));
    console.log(`publication receipt imported to ${result.destination} (sha256:${result.sha256})`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "publication receipt import failed");
    process.exitCode = 1;
  }
}

export function importPublicationReceipt(args, { root = process.cwd(), cwd = process.cwd() } = {}) {
  const input = resolveImportInput(args, cwd);
  if (!isExactPublicationVersion(input.version)) {
    throw new Error(`publication receipt version must be exact semver, received ${input.version || "<missing>"}`);
  }

  let inputStat;
  try {
    inputStat = lstatSync(input.inputPath, { throwIfNoEntry: false });
  } catch {
    throw new Error("publication receipt input must be a regular file");
  }
  if (!inputStat?.isFile()) {
    throw new Error("publication receipt input must be a regular file");
  }
  if (inputStat.size === 0 || inputStat.size > maximumReceiptBytes) {
    throw new Error(`publication receipt input must be between 1 and ${maximumReceiptBytes} bytes`);
  }

  let record;
  try {
    record = JSON.parse(readFileSync(input.inputPath, "utf8"));
  } catch {
    throw new Error("publication receipt input must contain valid UTF-8 JSON");
  }
  if (record?.releaseVersion !== input.version) {
    throw new Error("publication receipt releaseVersion must match --version");
  }

  const destination = `docs/ops/publications/${input.version}.publication.json`;
  const destinationPath = join(root, ...destination.split("/"));
  if (existsSync(destinationPath)) {
    throw new Error(`${destination} already exists; publication receipts are immutable`);
  }

  const issues = validatePublicationRecord({ root, path: destination, record });
  if (issues.length > 0) {
    throw new Error(`publication receipt validation failed:\n${issues.join("\n")}`);
  }

  const serialized = `${JSON.stringify(record, null, 2)}\n`;
  mkdirSync(dirname(destinationPath), { recursive: true });
  try {
    writeExclusiveAtomic(destinationPath, serialized);
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error(`${destination} already exists; publication receipts are immutable`, { cause: error });
    }
    throw new Error("publication receipt destination could not be created", { cause: error });
  }
  if (readFileSync(destinationPath, "utf8") !== serialized) {
    unlinkSync(destinationPath);
    throw new Error("publication receipt import verification failed");
  }

  return {
    destination,
    sha256: createHash("sha256").update(serialized).digest("hex"),
    record
  };
}

export function resolveImportInput(args, cwd = process.cwd()) {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  const options = {};
  const names = new Map([
    ["--input", "inputPath"],
    ["--version", "version"]
  ]);
  for (let index = 0; index < normalizedArgs.length; index += 2) {
    const key = names.get(normalizedArgs[index]);
    const value = normalizedArgs[index + 1];
    if (!key || !value || options[key] !== undefined) {
      throw new Error(usage());
    }
    options[key] = value;
  }
  if (!options.inputPath || !options.version) {
    throw new Error(usage());
  }
  return {
    inputPath: isAbsolute(options.inputPath) ? resolve(options.inputPath) : resolve(cwd, options.inputPath),
    version: options.version
  };
}

function writeExclusiveAtomic(destinationPath, serialized) {
  const stagingPath = join(dirname(destinationPath), `.${randomUUID()}.publication.tmp`);
  let descriptor;
  try {
    descriptor = openSync(stagingPath, "wx", 0o600);
    writeFileSync(descriptor, serialized, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    linkSync(stagingPath, destinationPath);
  } finally {
    if (descriptor !== undefined) {
      closeSync(descriptor);
    }
    if (existsSync(stagingPath)) {
      unlinkSync(stagingPath);
    }
  }
}

function usage() {
  return "Usage: node scripts/import-publication-receipt.mjs --version <exact-semver> --input <artifact-json>";
}

function isMainModule() {
  const entry = process.argv[1];
  return Boolean(entry) && import.meta.url === pathToFileURL(resolve(entry)).href;
}
