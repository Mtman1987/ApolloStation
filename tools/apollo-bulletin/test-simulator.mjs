export function simulatedAiReply(task, runNumber = 1, now = Date.now()) {
  const prompt = String(task?.prompt || "").trim();
  return { reply: "SIMULATED AI RECEIPT #" + runNumber + ": Prompt received.\nPrompt: " + prompt.slice(0, 240) + (prompt.length > 240 ? "…" : "") + "\nTest-only response; no external AI or workflow was invoked.", receivedAt: now, runNumber, destination: "test-simulator" };
}