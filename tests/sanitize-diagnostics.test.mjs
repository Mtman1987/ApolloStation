import assert from "node:assert/strict";
import test from "node:test";
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { redactDiagnosticText, sanitizeDiagnosticDirectory } from "../scripts/sanitize-diagnostics.mjs";

test("redacts Hostless, GitHub, JWT, authorization, cookies, query strings and JSON secrets", () => {
  const source = [
    "Authorization: hlk_prefix_verysecretvalue123",
    "Set-Cookie: spmt_token=private-cookie; HttpOnly",
    "https://example.test/callback?access_token=private-query-token&state=ok",
    '{"refreshToken":"private-refresh","client_secret":"private-client-secret"}',
    "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzZWNyZXQifQ.signaturevalue",
    "AKIA1234567890ABCDEF",
  ].join("\\n");
  const result = redactDiagnosticText(source);
  for (const secret of ["verysecretvalue123", "private-cookie", "private-query-token", "private-refresh", "private-client-secret", "ghp_abcdefghijklmnopqrstuvwxyz", "signaturevalue", "AKIA1234567890ABCDEF"]) {
    assert.equal(result.includes(secret), false, "secret leaked: " + secret);
  }
  assert.match(result, /Authorization: \\[REDACTED\\]/);
  assert.match(result, /Set-Cookie: \\[REDACTED\\]/);
  assert.match(result, /state=ok/);
});

test("redacts PEM and PGP armored private keys", () => {
  const source = [
    "-----BEGIN PRIVATE KEY-----",
    "pem-private-material",
    "-----END PRIVATE KEY-----",
    "-----BEGIN PGP PRIVATE KEY BLOCK-----",
    "pgp-private-material",
    "-----END PGP PRIVATE KEY BLOCK-----",
  ].join("\\n");
  const result = redactDiagnosticText(source);
  assert.doesNotMatch(result, /pem-private-material|pgp-private-material/);
  assert.equal((result.match(/REDACTED PRIVATE KEY/g) ?? []).length, 2);
});

test("does not match token suffixes in access_token and preserves safe query fields", () => {
  const result = redactDiagnosticText("https://example.test/callback?access_token=private-value&state=keep-this");
  assert.doesNotMatch(result, /private-value/);
  assert.match(result, /state=keep-this/);
});

test("sanitizes nested text artifacts and removes unsupported binary files", async () => {
  const root = await mkdtemp(join(tmpdir(), "apollo-diagnostics-"));
  try {
    await mkdir(join(root, "nested"));
    await writeFile(join(root, "nested", "runtime.ndjson"), '{"apiKey":"hlk_prefix_verysecretvalue123"}', "utf8");
    await writeFile(join(root, "image.bin"), Buffer.from([0, 1, 2, 3]));
    const result = await sanitizeDiagnosticDirectory(root);
    assert.deepEqual(result, { sanitizedFiles: 1, skippedFiles: 1 });
    const saved = await readFile(join(root, "nested", "runtime.ndjson"), "utf8");
    assert.doesNotMatch(saved, /verysecretvalue123/);
    await assert.rejects(access(join(root, "image.bin")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
