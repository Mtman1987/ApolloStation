// Fail-closed decision logic for a browser-assisted work resumer.
export function decideResume({ state, snapshot, now = Date.now(), cooldownMs = 60_000 }) {
  if (!state || !snapshot) return { action: "noop", reason: "missing-state-or-snapshot" };
  if (state.enabled === false || state.paused === true) return { action: "noop", reason: "paused-or-disabled" };
  if (state.completed === true) return { action: "noop", reason: "queue-completed" };
  const maxCycles = Number.isInteger(state.maxCycles) && state.maxCycles > 0 ? state.maxCycles : 1;
  const cycles = Number.isInteger(state.cycles) && state.cycles >= 0 ? state.cycles : 0;
  if (cycles >= maxCycles) return { action: "noop", reason: "max-cycles-reached" };
  if (!state.targetConversationUrl || snapshot.url !== state.targetConversationUrl) {
    return { action: "noop", reason: "conversation-mismatch" };
  }
  if (snapshot.busy === true || snapshot.stopControlVisible === true) return { action: "noop", reason: "chat-busy" };
  if (snapshot.busy !== false || snapshot.sendControlVisible !== true || snapshot.composerReady !== true) {
    return { action: "noop", reason: "ambiguous-ui" };
  }
  if (typeof state.pendingPrompt !== "string" || !state.pendingPrompt.trim()) {
    return { action: "noop", reason: "no-pending-prompt" };
  }
  if (state.lastSubmittedPromptHash && state.lastSubmittedPromptHash === state.pendingPromptHash) {
    return { action: "noop", reason: "prompt-already-submitted" };
  }
  if (Number.isFinite(state.lastSubmittedAt) && now - state.lastSubmittedAt < cooldownMs) {
    return { action: "noop", reason: "submission-cooldown" };
  }
  return { action: "submit", reason: "all-guards-passed", prompt: state.pendingPrompt };
}

// DOM adapter: labels are intentionally conservative; unknown controls stay ambiguous.
export function readChatGPTSnapshot(document, location) {
  const url = location?.href ?? "";
  const buttons = [...(document?.querySelectorAll?.("button") ?? [])];
  const label = (b) => [b.getAttribute?.("aria-label"), b.getAttribute?.("data-testid"), b.textContent]
    .filter(Boolean).join(" ").toLowerCase();
  const stopControlVisible = buttons.some(b => /stop generating|stop response|stop streaming/.test(label(b)));
  const sendControlVisible = buttons.some(b => /send message|send prompt|send/.test(label(b)) && !/stop/.test(label(b)) && !b.disabled);
  const busyText = document?.querySelector?.('[aria-busy="true"]') != null;
  const composer = document?.querySelector?.('[contenteditable="true"][role="textbox"], textarea');
  const composerReady = Boolean(composer && !composer.disabled && composer.getAttribute?.("aria-disabled") !== "true");
  const busy = stopControlVisible || busyText;
  return { url, busy, stopControlVisible, sendControlVisible, composerReady };
}
