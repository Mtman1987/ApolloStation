import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { redactDiagnosticText, sanitizeDiagnosticDirectory } from "../scripts/sanitize-diagnostics.mjs";

test("redacts Hostless, GitHub, JWT, authorization, cookie, query and JSON secrets", () => {
  const source = [
    "Authorization: hlk_prefix_verysecretvalue123",
    "Set-Cookie: spmt_token=private-cookie; HttpOnly",
    "https://example.test/callback?access_token=private-query-token&state=ok",
    '{"refreshToken":"private-refresh","client_secret":"private-client-secret"}',
    "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzZWNyZXQifQ.signaturevalue",
    "AKIA1234567890ABCDEF",
  ].join("\n");
  const result = redactDiagnosticText(source);
  for (const secret of ["verysecretvalue123", "private-cookie", "private-query-token", "private-refresh", "private-client-secret", "ghp_abcdefghijklmnopqrstuvwxyz", "signaturevalue", "AKIA1234567890ABCDEF"]) {
    assert.equal(result.includes(secret), false, "secret leaked: " + secret);
  }
  assert.match(result, /Authorization: \[REDACTED\]/);
  assert.match(result, /Set-Cookie: \[REDACTED\]/);
  assert.match(result, /state=ok/);
});

test("sanitizes nested text artifacts and skips unsupported extensions", async () => {
  const root = await mkdtemp(join(tmpdir(), "spmt-diagnostics-"));
  try {
    await mkdir(join(root, "nested"));
    await writeFile(join(root, "nested", "runtime.ndjson"), '{"apiKey":"hlk_prefix_verysecretvalue123"}', "utf8");
    await writeFile(join(root, "image.bin"), Buffer.from([0, 1, 2, 3]));
    const result = await sanitizeDiagnosticDirectory(root);
    assert.deepEqual(result, { sanitizedFiles: 1, skippedFiles: 0 });
    const saved = await readFile(join(root, "nested", "runtime.ndjson"), "utf8");
    assert.doesNotMatch(saved, /verysecretvalue123/);
    assert.deepEqual([...await readFile(join(root, "image.bin"))], [0, 1, 2, 3]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
