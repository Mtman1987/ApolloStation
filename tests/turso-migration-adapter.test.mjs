import test from "node:test";
import assert from "node:assert/strict";
import { decodeHranaValue, encodeHranaValue, normalizeTursoUrl } from "../scripts/migrate-sqlite-to-turso.mjs";

test("encodes SQLite scalar values for Hrana", () => {
  assert.deepEqual(encodeHranaValue(null), { type: "null" });
  assert.deepEqual(encodeHranaValue("apollo"), { type: "text", value: "apollo" });
  assert.deepEqual(encodeHranaValue(42), { type: "integer", value: "42" });
  assert.deepEqual(encodeHranaValue(42n), { type: "integer", value: "42" });
  assert.deepEqual(encodeHranaValue(1.25), { type: "float", value: 1.25 });
  assert.deepEqual(encodeHranaValue(new Uint8Array([1, 2, 3])), {
    type: "blob",
    base64: "AQID",
  });
});

test("rejects non-finite and unsupported SQLite values", () => {
  assert.throws(() => encodeHranaValue(Number.NaN), /non-finite/);
  assert.throws(() => encodeHranaValue({}), /Unsupported SQLite value/);
});

test("normalizes Turso URLs to the authenticated Hrana endpoint", () => {
  assert.equal(
    normalizeTursoUrl("libsql://apollo-persistence-spike-mtman1987.turso.io"),
    "https://apollo-persistence-spike-mtman1987.turso.io/v2/pipeline",
  );
  assert.equal(
    normalizeTursoUrl("https://example.turso.io/old/path?x=1"),
    "https://example.turso.io/v2/pipeline",
  );
  assert.throws(() => normalizeTursoUrl("http://example.turso.io"), /must use libsql/);
});


test("decodes Hrana integers without losing 64-bit precision", () => {
  assert.equal(decodeHranaValue({ type: "integer", value: "9223372036854775807" }), 9223372036854775807n);
  assert.equal(decodeHranaValue({ type: "integer", value: "-9223372036854775808" }), -9223372036854775808n);
  assert.equal(decodeHranaValue({ type: "integer", value: "9007199254740991" }), 9007199254740991);
  assert.equal(decodeHranaValue({ type: "integer", value: "42" }), 42);
});
