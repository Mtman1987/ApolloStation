import { basename } from "node:path";

const entry = process.argv[1] ? basename(process.argv[1]) : "";
if (entry === "run-supervised-sandbox.mjs") {
  const existing = new Set(process.argv.slice(2));
  const base = 40000 + ((process.pid % 4000) * 5);
  const assignments = [
    ["--hearmeout-web-port", base],
    ["--dsh-web-port", base + 1],
    ["--streamweaver-web-port", base + 2],
    ["--mountainview-web-port", base + 3],
    ["--companion-web-port", base + 4],
  ];
  for (const [flag, port] of assignments) {
    if (!existing.has(flag)) process.argv.push(flag, String(port));
  }
}
