import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { installLocalBrowserPackage } from "./setup-local-browser.mjs";

test("local browser package installer creates its cwd before invoking npm ci", async () => {
  const base = await mkdtemp(join(tmpdir(), "apollo-local-browser-install-"));
  const root = join(base, "local-browser");
  let invocation;
  try {
    installLocalBrowserPackage(root, (command, args, options) => {
      invocation = { command, args, cwd: options.cwd, exists: existsSync(options.cwd), timeout: options.timeout };
      return { status: 0, error: null };
    });
    assert.deepEqual(invocation, {
      command: "npm",
      args: ["ci", "--ignore-scripts"],
      cwd: root,
      exists: true,
      timeout: 120000,
    });
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("local browser package installer reports spawn and exit failures", async () => {
  const base = await mkdtemp(join(tmpdir(), "apollo-local-browser-failure-"));
  const root = join(base, "local-browser");
  try {
    assert.throws(() => installLocalBrowserPackage(root, () => ({ status: 1, error: null })), /exit code 1/);
    assert.throws(() => installLocalBrowserPackage(root, () => ({ status: null, error: new Error("spawn failed") })), /spawn failed/);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
