import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { importPublicationReceipt, resolveImportInput } from "./import-publication-receipt.mjs";

const sourceRoot = process.cwd();
const version = "0.2.0-alpha.4";
const destination = `docs/ops/publications/${version}.publication.json`;

test("imports a validated receipt into its immutable canonical path", () => {
  withFixture(({ root, inputPath, record }) => {
    const result = importPublicationReceipt(["--version", version, "--input", inputPath], { root, cwd: root });
    assert.equal(result.destination, destination);
    assert.match(result.sha256, /^[a-f0-9]{64}$/u);
    assert.deepEqual(JSON.parse(readFileSync(join(root, ...destination.split("/")), "utf8")), record);
    assert.equal(readFileSync(join(root, ...destination.split("/")), "utf8").endsWith("\n"), true);
  });
});

test("rejects a mismatched explicit version before writing", () => {
  withFixture(({ root, inputPath }) => {
    assert.throws(
      () => importPublicationReceipt(["--version", "0.2.0-alpha.3", "--input", inputPath], { root, cwd: root }),
      /releaseVersion must match --version/u
    );
    assert.equal(existsSync(join(root, "docs", "ops", "publications", "0.2.0-alpha.3.publication.json")), false);
  });
});

test("rejects schema or semantic drift before writing", () => {
  withFixture(({ root, inputPath, record }) => {
    writeFileSync(inputPath, `${JSON.stringify({ ...record, untrackedEvidence: true })}\n`, "utf8");
    assert.throws(
      () => importPublicationReceipt(["--version", version, "--input", inputPath], { root, cwd: root }),
      /JSON Schema validation failed/u
    );
    assert.equal(existsSync(join(root, ...destination.split("/"))), false);
  });
});

test("never overwrites an existing immutable receipt", () => {
  withFixture(({ root, inputPath }) => {
    const destinationPath = join(root, ...destination.split("/"));
    mkdirSync(dirname(destinationPath), { recursive: true });
    writeFileSync(destinationPath, "existing receipt\n", "utf8");
    assert.throws(
      () => importPublicationReceipt(["--version", version, "--input", inputPath], { root, cwd: root }),
      /already exists; publication receipts are immutable/u
    );
    assert.equal(readFileSync(destinationPath, "utf8"), "existing receipt\n");
  });
});

test("requires one unambiguous input and exact version", () => {
  assert.throws(() => resolveImportInput(["--input", "receipt.json"]), /Usage:/u);
  assert.throws(
    () => resolveImportInput(["--input", "one.json", "--input", "two.json", "--version", version]),
    /Usage:/u
  );
});

test("rejects empty and oversized inputs before parsing", () => {
  withFixture(({ root, inputPath }) => {
    writeFileSync(inputPath, "", "utf8");
    assert.throws(
      () => importPublicationReceipt(["--version", version, "--input", inputPath], { root, cwd: root }),
      /must be between 1 and 1048576 bytes/u
    );
    writeFileSync(inputPath, "x".repeat(1024 * 1024 + 1), "utf8");
    assert.throws(
      () => importPublicationReceipt(["--version", version, "--input", inputPath], { root, cwd: root }),
      /must be between 1 and 1048576 bytes/u
    );
    assert.equal(existsSync(join(root, ...destination.split("/"))), false);
  });
});

test("rejects malformed UTF-8 before JSON or schema interpretation", () => {
  withFixture(({ root, inputPath, record }) => {
    const bytes = Buffer.from(JSON.stringify(record), "utf8");
    const statusOffset = bytes.indexOf(Buffer.from("completed", "utf8"));
    assert.notEqual(statusOffset, -1);
    bytes[statusOffset] = 0x80;
    writeFileSync(inputPath, bytes);
    assert.throws(
      () => importPublicationReceipt(["--version", version, "--input", inputPath], { root, cwd: root }),
      /must contain valid UTF-8 JSON/u
    );
    assert.equal(existsSync(join(root, ...destination.split("/"))), false);
  });
});

function withFixture(run) {
  const root = mkdtempSync(join(tmpdir(), "msp-publication-import-"));
  try {
    copySource(root, "docs/ops/npm-bootstrap-plan.json");
    copySource(root, `docs/ops/release-records/${version}.approved.release.json`);
    copySource(root, "docs/ops/publications/schemas/publication-record.v1.schema.json");
    copySource(root, "docs/ops/publications/schemas/publication-record.v2.schema.json");
    const record = JSON.parse(
      readFileSync(join(sourceRoot, "docs", "ops", "publications", `${version}.publication.json`), "utf8")
    );
    const inputPath = join(root, "downloaded", `${version}.publication.json`);
    mkdirSync(dirname(inputPath), { recursive: true });
    writeFileSync(inputPath, `${JSON.stringify(record)}\n`, "utf8");
    run({ root, inputPath, record });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function copySource(root, relativePath) {
  const parts = relativePath.split("/");
  const destinationPath = join(root, ...parts);
  mkdirSync(dirname(destinationPath), { recursive: true });
  copyFileSync(join(sourceRoot, ...parts), destinationPath);
}
