#!/usr/bin/env node
/**
 * Apollo-side recovery bridge for the retired StreamWeaver Adult Mode Qwen error.
 * It only observes bot-authored Discord DM messages containing the exact legacy
 * offline response. It does not alter Chat Gateway ingress or the old listener.
 */
import { buildChatChainFromEnv } from "../../apps/stellar-core/dist/chat-chain.js";

const ERROR_TEXT = "Adult Mode local model is offline while local AI is disabled.";
const DISCORD_API = "https://discord.com/api/v10";
const POLL_MS = Math.max(10_000, Number(process.env.ADULT_MODE_BRIDGE_POLL_MS || 15_000));
const BOT_TOKEN = String(process.env.DISCORD_BOT_TOKEN || "").trim();
const BOT_SECRET_KEY = String(process.env.BOT_SECRET_KEY || "").trim();
const processed = new Set();
let polling = false;

function log(message, details = {}) {
  console.info("[adult-mode-bridge] " + message, JSON.stringify(details));
}
function discordHeaders() {
  return { authorization: "Bot " + BOT_TOKEN, "content-type": "application/json" };
}
async function discord(path, init = {}) {
  const response = await fetch(DISCORD_API + path, {
    ...init,
    headers: { ...discordHeaders(), ...(init.headers || {}) },
    signal: AbortSignal.timeout(20_000),
  });
  const raw = await response.text();
  let body;
  try { body = raw ? JSON.parse(raw) : null; } catch { body = raw; }
  if (!response.ok) throw new Error("Discord HTTP " + response.status + ": " + String(body?.message || raw).slice(0, 240));
  return body;
}
function textOf(message) {
  const chunks = [message?.content || ""];
  for (const embed of Array.isArray(message?.embeds) ? message.embeds : []) {
    chunks.push(embed?.title || "", embed?.description || "");
    for (const field of Array.isArray(embed?.fields) ? embed.fields : []) chunks.push(field?.name || "", field?.value || "");
  }
  return chunks.join("\n");
}
function promptFromFooter(message) {
  for (const embed of Array.isArray(message?.embeds) ? message.embeds : []) {
    const footer = String(embed?.footer?.text || "").trim();
    // Existing StreamWeaver private reply footer: "Requested by <name> • <prompt> • ..."
    const parts = footer.split(/\s+•\s+/);
    if (parts.length >= 2) {
      const start = /^requested by\s+/i.test(parts[0]) ? 1 : 0;
      const prompt = parts.slice(start, parts.length > start + 1 ? -1 : undefined).join(" • ").trim();
      if (prompt) return prompt;
    }
  }
  return "";
}
async function hostedReply(prompt) {
  if (!BOT_SECRET_KEY) throw new Error("BOT_SECRET_KEY is not configured in Apollo runtime.");
  const { chain, enabled } = buildChatChainFromEnv(process.env);
  if (!chain) throw new Error("No hosted AI provider is configured for the Adult Mode bridge.");
  log("Calling Apollo hosted provider chain.", { providers: enabled });
  const result = await chain.complete([
    { role: "system", content: "Continue a private fictional adult conversation naturally. All participants and characters must be unambiguously adults aged 18 or older and interactions must be consensual. Return only the assistant's reply." },
    { role: "user", content: prompt },
  ]);
  return String(result.text || "").trim();
}
async function handleMessage(message, ownBotId) {
  if (!message?.id || !message?.channel_id || message.author?.id !== ownBotId) return;
  const combined = textOf(message);
  if (!combined.includes(ERROR_TEXT)) return;
  if (processed.has(message.id)) return;
  processed.add(message.id);

  const prompt = promptFromFooter(message);
  if (!prompt) {
    log("Matched legacy error but could not extract the prompt from its embed footer.", { messageId: message.id, channelId: message.channel_id, embedCount: message.embeds?.length || 0 });
    return;
  }
  try {
    const answer = await hostedReply(prompt);
    if (!answer) throw new Error("Hosted provider chain returned an empty reply.");
    const embeds = Array.isArray(message.embeds) ? message.embeds.map(embed => {
      const next = { ...embed };
      if (typeof next.description === "string") next.description = answer;
      return next;
    }) : [];
    try {
      await discord("/channels/" + message.channel_id + "/messages/" + message.id, {
        method: "PATCH",
        body: JSON.stringify({ content: "", embeds }),
      });
      log("Replaced the offline error with the hosted reply.", { messageId: message.id, channelId: message.channel_id });
    } catch (editError) {
      log("Discord edit failed; posting the reply underneath.", { messageId: message.id, channelId: message.channel_id, error: String(editError).slice(0, 300) });
      await discord("/channels/" + message.channel_id + "/messages", {
        method: "POST",
        body: JSON.stringify({ content: answer }),
      });
      log("Posted the hosted reply underneath the original message.", { messageId: message.id, channelId: message.channel_id });
    }
  } catch (error) {
    log("Bridge could not complete this matched message.", { messageId: message.id, channelId: message.channel_id, error: String(error).slice(0, 400) });
  }
}
async function poll() {
  if (polling) return;
  polling = true;
  try {
    const me = await discord("/users/@me");
    const channels = await discord("/users/@me/channels");
    if (!Array.isArray(channels)) throw new Error("Discord DM channel listing did not return an array.");
    for (const channel of channels) {
      if (channel?.type !== 1 || !channel.id) continue;
      const messages = await discord("/channels/" + channel.id + "/messages?limit=25");
      if (!Array.isArray(messages)) continue;
      for (const message of messages.reverse()) await handleMessage(message, me.id);
    }
  } catch (error) {
    log("DM polling failed; will check again on the next interval.", { error: String(error).slice(0, 400) });
  } finally {
    polling = false;
  }
}
if (!BOT_TOKEN) {
  console.warn("[adult-mode-bridge] DISCORD_BOT_TOKEN is missing; bridge is not starting.");
} else {
  log("Starting Discord DM watcher.", { pollMs: POLL_MS, botSecretConfigured: Boolean(BOT_SECRET_KEY) });
  await poll();
  setInterval(() => void poll(), POLL_MS).unref?.();
}
