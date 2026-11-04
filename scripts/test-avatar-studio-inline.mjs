import { spawnSync } from "node:child_process";
import { writeFileSync, rmSync } from "node:fs";
import { renderAvatarStudioPage } from "../apps/streamweaver/dist/avatar-studio.js";

const nonce = "avatar-studio-syntax-test";
const html = renderAvatarStudioPage(nonce);
const match = html.match(new RegExp('<script type="module" nonce="' + nonce + '">([\\s\\S]*?)<\\/script>'));
if (!match) throw new Error("Could not extract the rendered Avatar Studio module script.");
const path = "/tmp/avatar-studio-inline-syntax-check.mjs";
writeFileSync(path, match[1], "utf8");
const result = spawnSync(process.execPath, ["--check", path], { encoding: "utf8" });
rmSync(path, { force: true });
if (result.status !== 0) {
  process.stderr.write(result.stderr || result.stdout || "Inline script syntax check failed.\\n");
  process.exit(result.status || 1);
}
console.log("Rendered Avatar Studio inline module syntax passed.");
