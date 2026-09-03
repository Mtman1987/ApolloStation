export interface HearMeOutRoomBotDescriptorV1 {
  displayName: string;
  wakeNames: string[];
  targetTenantId?: string;
}

export interface HearMeOutBotInvocationV1 {
  displayName: string;
  targetTenantId?: string;
}

function escapeRegex(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

export function hearMeOutExpandedWakeNames(bot: HearMeOutRoomBotDescriptorV1) {
  const names = [...new Set([bot.displayName, ...(bot.wakeNames ?? [])].map((value) => String(value ?? "").trim()).filter(Boolean))];
  const athenaLike = names.some((name) => name.toLowerCase().includes("athena") || name.toLowerCase() === "annie");
  if (athenaLike && !names.some((name) => name.toLowerCase() === "hey athena")) names.push("Hey Athena");
  return names;
}

export function hearMeOutWakeNameMatchIndex(value: string, wakeName: string) {
  const normalized = String(wakeName ?? "").trim().replace(/^@/, "");
  if (!normalized) return -1;
  return new RegExp(`(^|[^a-z0-9_])@?${escapeRegex(normalized)}([^a-z0-9_]|$)`, "i").exec(value)?.index ?? -1;
}

/** Typed chat and trusted local-Companion wake events share this exact resolver. */
export function resolveHearMeOutBotInvocation(value: string, bots: HearMeOutRoomBotDescriptorV1[] = []): HearMeOutBotInvocationV1 | null {
  let best: (HearMeOutBotInvocationV1 & { index: number; wakeNameLength: number }) | undefined;
  for (const bot of bots) {
    for (const wakeName of hearMeOutExpandedWakeNames(bot)) {
      const index = hearMeOutWakeNameMatchIndex(value, wakeName), wakeNameLength = wakeName.length;
      if (index < 0 || (best && index > best.index) || (best && index === best.index && wakeNameLength <= best.wakeNameLength)) continue;
      best = { displayName: cleanLabel(bot.displayName), ...(bot.targetTenantId ? { targetTenantId: cleanId(bot.targetTenantId) } : {}), index, wakeNameLength };
    }
  }
  return best ? { displayName: best.displayName, ...(best.targetTenantId ? { targetTenantId: best.targetTenantId } : {}) } : null;
}

function cleanId(value: string) { const result = value.trim(); if (!/^[A-Za-z0-9._:@/-]{1,200}$/.test(result)) throw new Error("HearMeOut persona target is invalid"); return result; }
function cleanLabel(value: string) { const result = value.trim(); if (!result || result.length > 120 || /[\r\n\0]/.test(result)) throw new Error("HearMeOut persona display name is invalid"); return result; }
