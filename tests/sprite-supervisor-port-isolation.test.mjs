import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const preload = readFileSync(new URL("../scripts/sprites/supervisor-test-port-isolation.mjs", import.meta.url), "utf8");
const deploy = readFileSync(new URL("../scripts/sprites/deploy-sandbox-release.sh", import.meta.url), "utf8");

test("protected Sprite validation isolates only nested supervisor app ports", () => {
  assert.match(preload, /run-supervised-sandbox\.mjs/);
  for (const flag of ["hearmeout-web-port", "dsh-web-port", "streamweaver-web-port", "mountainview-web-port", "companion-web-port"]) assert.match(preload, new RegExp(`--${flag}`));
  assert.match(preload, /40000/);
  assert.doesNotMatch(preload, /--spmt-port|--web-port|--nebula-arcade-port/);
  assert.match(deploy, /NODE_OPTIONS="--import=\$release_dir\/scripts\/sprites\/supervisor-test-port-isolation\.mjs"/);
  assert.doesNotMatch(deploy, /cohort_quiesced|Validation failed while the previous supervised cohort was quiesced/);
});
