from pathlib import Path

path = Path('packages/app-foundation/src/product-web.ts')
text = path.read_text(encoding='utf-8')

import_line = 'import { discoverHumanReferencesInText, humanReferenceKey, humanizeTextWithReferences, type HumanReferenceInputV1, type HumanReferenceV1 } from "@spmt/contracts/human-reference";\n'
if import_line not in text:
    text = import_line + text

anchor = '''    const raw = await read<unknown>(source, paths[source], source === "xpWallet" ? null : []);
    values[source] = liveRead && liveProtocol === "blue-v1" ? unwrapBlueSnapshot(source, raw) : raw;
  }));
'''
insert = anchor + '''  if (requestedSources.includes("operations") && (!liveRead || liveProtocol === "green-v1")) {
    values.operations = await presentOperationsSnapshot({
      value: values.operations,
      tenantId,
      origin: dataOrigin,
      headers: dataHeaders,
      fetchImpl,
    }).catch(() => values.operations);
  }
'''
if 'values.operations = await presentOperationsSnapshot({' not in text:
    if anchor not in text:
        raise SystemExit('product snapshot fetch anchor missing')
    text = text.replace(anchor, insert, 1)

helper = r'''

export function collectOperationsHumanReferences(value: unknown): HumanReferenceInputV1[] {
  if (!Array.isArray(value)) return [];
  const refs: HumanReferenceInputV1[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    if (typeof record.summary === "string") refs.push(...discoverHumanReferencesInText(record.summary));
    if (typeof record.detail === "string") refs.push(...discoverHumanReferencesInText(record.detail));
  }
  return [...new Map(refs.map((ref) => [humanReferenceKey(ref), ref])).values()];
}

export function applyHumanReferencesToOperations(value: unknown, references: readonly HumanReferenceV1[]): unknown {
  if (!Array.isArray(value) || !references.length) return value;
  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    const record = item as Record<string, unknown>;
    const summary = typeof record.summary === "string" ? humanizeTextWithReferences(record.summary, references) : undefined;
    const detail = typeof record.detail === "string" ? humanizeTextWithReferences(record.detail, references) : undefined;
    if (summary === undefined && detail === undefined) return item;
    return {
      ...record,
      ...(summary !== undefined ? { summary } : {}),
      ...(detail !== undefined ? { detail } : {}),
      presentation: {
        ...(record.presentation && typeof record.presentation === "object" && !Array.isArray(record.presentation) ? record.presentation as Record<string, unknown> : {}),
        ...(summary !== undefined ? { summary } : {}),
        ...(detail !== undefined ? { detail } : {}),
      },
    };
  });
}

async function presentOperationsSnapshot(input: { value: unknown; tenantId: string; origin: string; headers: Record<string, string>; fetchImpl: typeof fetch }): Promise<unknown> {
  const requested = collectOperationsHumanReferences(input.value);
  if (!requested.length) return input.value;
  const response = await input.fetchImpl(`${input.origin}/v1/presentation/references`, {
    method: "POST",
    headers: { ...input.headers, accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ references: requested }),
    redirect: "manual",
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) return input.value;
  const body = await response.json().catch(() => undefined) as { references?: unknown } | undefined;
  const references = Array.isArray(body?.references)
    ? body.references.filter((item): item is HumanReferenceV1 => Boolean(item && typeof item === "object" && !Array.isArray(item) && (item as HumanReferenceV1).schemaVersion === 1 && typeof (item as HumanReferenceV1).id === "string" && typeof (item as HumanReferenceV1).label === "string"))
    : [];
  return applyHumanReferencesToOperations(input.value, references);
}
'''
if 'export function collectOperationsHumanReferences(' not in text:
    text += helper

path.write_text(text, encoding='utf-8')

Path('tests/product-human-reference-presentation.test.mjs').write_text(r'''import test from "node:test";
import assert from "node:assert/strict";
import { applyHumanReferencesToOperations, collectOperationsHumanReferences } from "../packages/app-foundation/dist/product-web.js";

test("shared product snapshots discover only semantically identified provider references", () => {
  const logs = [{ summary: "accepted user 737589459347", detail: "server 837589459347 channel 1004895478763 message 303039283; total 999999999999" }];
  const refs = collectOperationsHumanReferences(logs);
  assert.equal(refs.some((ref) => ref.kind === "user" && ref.id === "737589459347"), true);
  assert.equal(refs.some((ref) => ref.kind === "guild" && ref.id === "837589459347"), true);
  assert.equal(refs.some((ref) => ref.kind === "channel" && ref.id === "1004895478763"), true);
  assert.equal(refs.some((ref) => ref.kind === "message" && ref.id === "303039283" && ref.channelId === "1004895478763"), true);
  assert.equal(refs.some((ref) => ref.id === "999999999999"), false);
});

test("shared product snapshots present names while leaving source records untouched", () => {
  const source = [{ summary: "accepted user 737589459347", detail: "channel 1004895478763 message 303039283" }];
  const refs = [
    { schemaVersion: 1, provider: "discord", kind: "user", id: "737589459347", label: "SaltyBear", resolved: true },
    { schemaVersion: 1, provider: "discord", kind: "channel", id: "1004895478763", label: "#general", secondary: "Space Mountain", resolved: true },
    { schemaVersion: 1, provider: "discord", kind: "message", id: "303039283", channelId: "1004895478763", label: "Message “hello there”", resolved: true },
  ];
  const presented = applyHumanReferencesToOperations(source, refs);
  assert.equal(source[0].summary, "accepted user 737589459347");
  assert.equal(source[0].detail, "channel 1004895478763 message 303039283");
  assert.equal(presented[0].summary, "accepted user SaltyBear");
  assert.equal(presented[0].detail, "channel #general (Space Mountain) message Message “hello there”");
  assert.equal(presented[0].presentation.summary, "accepted user SaltyBear");
});
''', encoding='utf-8')

print('shared product human-reference presentation patch applied')
