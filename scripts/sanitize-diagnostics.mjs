import { readdir, readFile, writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const TEXT_EXTENSIONS = new Set([".json", ".ndjson", ".log", ".txt", ".body", ".stderr", ".html", ".xml"]);
const MAX_FILE_BYTES = 32 * 1024 * 1024;

export function redactDiagnosticText(input) {
  let value = String(input);
  const patterns = [
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[REDACTED PRIVATE KEY]"],
    [/(authorization\s*[:=]\s*)(?:bearer\s+)?[^\s"';,]+/gi, "$1[REDACTED]"],
    [/(set-cookie|cookie)\s*[:=]\s*[^\r\n]+/gi, "$1: [REDACTED]"],
    [/([?&](?:access_token|refresh_token|id_token|token|api_key|key|secret|code)=)[^&#\s]+/gi, "$1[REDACTED]"],
    [/(['"]?(?:access[_-]?token|refresh[_-]?token|id[_-]?token|token|secret|password|passwd|api[_-]?key|session[_-]?key|client[_-]?secret|webhook[_-]?key|private[_-]?key)['"]?\s*[:=]\s*['"]?)[^\s,;'"]+/gi, "$1[REDACTED]"],
    [/(?:hlk_[a-z0-9_]{12,}|gh[pousr]_[a-z0-9]{20,}|github_pat_[a-z0-9_]{20,}|xox[baprs]-[a-z0-9-]{12,}|sk-[a-z0-9_-]{12,})/gi, "[REDACTED TOKEN]"],
    [/(eyJ[a-z0-9_-]{10,}\.)[a-z0-9_-]{10,}(?:\.[a-z0-9_-]{10,})?/gi, "[REDACTED JWT]"],
    [/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED AWS KEY]"],
  ];
  for (const [pattern, replacement] of patterns) value = value.replace(pattern, replacement);
  return value;
}

export async function sanitizeDiagnosticDirectory(directory) {
  const root = resolve(directory);
  let sanitizedFiles = 0;
  let skippedFiles = 0;
  async function visit(path) {
    const entries = await readdir(path, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const target = resolve(path, entry.name);
      if (entry.isDirectory()) {
        await visit(target);
      } else if (entry.isFile() && TEXT_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
        const bytes = await readFile(target);
        if (bytes.byteLength > MAX_FILE_BYTES) {
          skippedFiles++;
          continue;
        }
        const original = bytes.toString("utf8");
        const redacted = redactDiagnosticText(original);
        if (redacted !== original) await writeFile(target, redacted, "utf8");
        sanitizedFiles++;
      }
    }
  }
  await visit(root);
  return { sanitizedFiles, skippedFiles };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const directory = process.argv[2];
  if (!directory) {
    console.error("Usage: node scripts/sanitize-diagnostics.mjs <directory>");
    process.exitCode = 2;
  } else {
    const result = await sanitizeDiagnosticDirectory(directory);
    console.log(JSON.stringify(result));
  }
}
