import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const shell = readFileSync(new URL("../apps/spacemountain/src/shell-ui.ts", import.meta.url), "utf8");
const page = readFileSync(new URL("../apps/spacemountain-web/src/page.ts", import.meta.url), "utf8");

test("SpaceMountain browser shell uses only bare imports present in the page import map", () => {
  const importMapMatch = page.match(/<script type="importmap"[^>]*>(\{.*?\})<\/script>/s);
  assert.ok(importMapMatch, "SpaceMountain page must publish an import map");
  const imports = JSON.parse(importMapMatch[1]).imports ?? {};
  const bareImports = [...shell.matchAll(/from\s+["']([^./][^"']*)["']/g)].map((match) => match[1]);
  for (const specifier of bareImports) {
    assert.ok(imports[specifier], `browser shell bare import ${specifier} must be present in the page import map`);
  }
  assert.doesNotMatch(shell, /@spmt\/contracts\//, "browser shell must not introduce an unmapped contracts subpath import");
});
