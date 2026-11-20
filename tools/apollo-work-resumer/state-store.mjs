import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const DEFAULT_STATE = Object.freeze({
  schemaVersion: 1, enabled: true, paused: false, completed: false,
  cycles: 0, maxCycles: 3, cooldownMs: 60_000, targetConversationUrl: "",
  pendingPrompt: "", pendingPromptHash: "", lastSubmittedPromptHash: null,
  lastSubmittedAt: null, queue: [], activityLog: [],
});

export async function loadState(filePath) {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8"));
    if (parsed?.schemaVersion !== 1) throw new Error("Unsupported work-resumer state schema");
    return { ...DEFAULT_STATE, ...parsed };
  } catch (error) {
    if (error?.code === "ENOENT") return structuredClone(DEFAULT_STATE);
    throw error;
  }
}

export async function saveState(filePath, state) {
  if (!state || state.schemaVersion !== 1) throw new Error("Invalid work-resumer state");
  const directory = dirname(filePath);
  await mkdir(directory, { recursive: true });
  const temporary = join(directory, `.apollo-work-resumer-${process.pid}-${Date.now()}.tmp`);
  await writeFile(temporary, JSON.stringify(state, null, 2), { encoding: "utf8", mode: 0o600 });
  await rename(temporary, filePath);
}

export function appendActivity(state, event, now = Date.now()) {
  const activityLog = [...(state.activityLog ?? []), { at: now, event }].slice(-200);
  return { ...state, activityLog };
}

export function markSubmitted(state, promptHash, now = Date.now()) {
  return appendActivity({
    ...state,
    cycles: state.cycles + 1,
    lastSubmittedPromptHash: promptHash,
    lastSubmittedAt: now,
  }, "prompt-submitted", now);
}
