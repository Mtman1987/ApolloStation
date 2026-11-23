import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { installLocalBrowserPackage } from "../scripts/setup-local-browser.mjs";

test("Chromium package install runs npm ci from an ensured prefix directory", async () => {
  const root = await mkdtemp(tmpdir() + "/apollo-browser-install-");
  let invocation;
  try {
    await rm(root, { recursive: true, force: true });
    installLocalBrowserPackage(root, (command, args, options) => {
      invocation = { command, args, options };
      return { status: 0 };
    });
    await access(root);
    assert.equal(invocation.command, "npm");
    assert.deepEqual(invocation.args, ["ci", "--ignore-scripts"]);
    assert.equal(invocation.options.cwd, root);
    assert.equal(invocation.options.timeout, 120000);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("Chromium package installer fails explicitly when npm exits nonzero", () => {
  assert.throws(() => installLocalBrowserPackage(tmpdir() + "/apollo-browser-install-fail", () => ({ status: 1 })), /exit code 1/);
});
test("Chromium package installer surfaces npm spawn errors", () => {
  assert.throws(() => installLocalBrowserPackage(tmpdir() + "/apollo-browser-install-error", () => ({ status: null, error: new Error("spawn failed") })), /spawn failed/);
});
