import { SpmtClient } from "@spmt/sdk";

export const CHAT_TAG_STATE_VERSION = 1 as const;
export const CHAT_TAG_PLAYER_JOINED = "nebula.chat-tag.player.joined.v1";
export const CHAT_TAG_PLAYER_LEFT = "nebula.chat-tag.player.left.v1";
export const CHAT_TAG_TAG_COMPLETED = "nebula.chat-tag.tag.completed.v1";
export const CHAT_TAG_FREE_FOR_ALL_STARTED = "nebula.chat-tag.free-for-all.started.v1";
export const CHAT_TAG_PLAYER_AVAILABILITY_CHANGED = "nebula.chat-tag.player.availability.changed.v1";
export const CHAT_TAG_PASS_GRANTED = "nebula.chat-tag.pass.granted.v1";

export const CHAT_TAG_EVENT_TYPES = [
  CHAT_TAG_PLAYER_JOINED,
  CHAT_TAG_PLAYER_LEFT,
  CHAT_TAG_TAG_COMPLETED,
  CHAT_TAG_FREE_FOR_ALL_STARTED,
  CHAT_TAG_PLAYER_AVAILABILITY_CHANGED,
  CHAT_TAG_PASS_GRANTED,
] as const;

export interface ChatTagPlayerStateV1 {
  userId: string;
  username: string;
  joinedAt: string;
  lastActiveAt: string;
  score: number;
  tagsMade: number;
  timesTagged: number;
  passCount: number;
  sleeping: boolean;
  offline: boolean;
  timedImmunityUntil: string | null;
  noTagbackFromUserId: string | null;
}

export interface ChatTagHistoryEntryV1 {
  id: string;
  commandId: string;
  kind: "tag" | "pass" | "free-for-all";
  actorUserId: string;
  targetUserId: string | null;
  channelId: string;
  occurredAt: string;
  doublePoints: boolean;
  scoreAwarded: number;
}

export interface ChatTagXpAwardV1 {
  userId: string;
  delta: number;
  reason: "chat-tag.tag" | "chat-tag.pass";
  idempotencyKey: string;
}

export interface ChatTagPublicEventV1 {
  type: (typeof CHAT_TAG_EVENT_TYPES)[number];
  idempotencyKey: string;
  payload: Record<string, unknown>;
}

export type ChatTagCommandKindV1 =
  | "join"
  | "leave"
  | "tag"
  | "pass"
  | "sleep"
  | "wake"
  | "record-activity"
  | "grant-pass"
  | "set-it"
  | "trigger-ffa";

interface ChatTagCommandBaseV1 {
  schemaVersion: 1;
  tenantId: string;
  commandId: string;
  actorUserId: string;
  occurredAt: string;
  channelId: string;
  isModerator?: boolean;
}

export type ChatTagCommandV1 =
  | (ChatTagCommandBaseV1 & { kind: "join"; username: string })
  | (ChatTagCommandBaseV1 & { kind: "leave" })
  | (ChatTagCommandBaseV1 & { kind: "tag"; targetUserId: string })
  | (ChatTagCommandBaseV1 & { kind: "pass"; targetUserId: string })
  | (ChatTagCommandBaseV1 & { kind: "sleep"; targetUserId?: string })
  | (ChatTagCommandBaseV1 & { kind: "wake"; targetUserId?: string })
  | (ChatTagCommandBaseV1 & { kind: "record-activity" })
  | (ChatTagCommandBaseV1 & { kind: "grant-pass"; targetUserId: string })
  | (ChatTagCommandBaseV1 & { kind: "set-it"; targetUserId: string })
  | (ChatTagCommandBaseV1 & { kind: "trigger-ffa" });

export interface ChatTagCommandResultV1 {
  schemaVersion: 1;
  tenantId: string;
  commandId: string;
  kind: ChatTagCommandKindV1;
  status: "applied" | "rejected" | "duplicate";
  code: string;
  message: string;
  stateChanged: boolean;
  event?: ChatTagPublicEventV1;
  xpAward?: ChatTagXpAwardV1;
}

export interface ChatTagStateV1 {
  schemaVersion: typeof CHAT_TAG_STATE_VERSION;
  tenantId: string;
  currentItUserId: string | null;
  lastTagAt: string | null;
  players: Record<string, ChatTagPlayerStateV1>;
  history: ChatTagHistoryEntryV1[];
  appliedCommands: Record<string, ChatTagCommandResultV1>;
}

export interface ChatTagRulesV1 {
  tagSuccessPoints: number;
  taggedPenaltyPoints: number;
  immunityMs: number;
  maxPasses: number;
  passSpendLimit: number;
  passSpendWindowMs: number;
}

export const DEFAULT_CHAT_TAG_RULES: ChatTagRulesV1 = {
  tagSuccessPoints: 100,
  taggedPenaltyPoints: 50,
  immunityMs: 20 * 60 * 1_000,
  maxPasses: 3,
  passSpendLimit: 3,
  passSpendWindowMs: 24 * 60 * 60 * 1_000,
};

export type ChatTagParsedCommandV1 =
  | { kind: "join" | "leave" | "status" | "score" | "rank" | "players" | "sleep" | "wake" | "toggle-away" | "rules" | "help" | "info" }
  | { kind: "tag" | "pass" | "grant-pass"; targetUsername: string };

function normalizeUsername(value: string): string {
  return value.trim().toLowerCase().replace(/^@+/, "");
}

function isValidIso(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

function eventFor(
  command: ChatTagCommandV1,
  type: ChatTagPublicEventV1["type"],
  payload: Record<string, unknown>,
): ChatTagPublicEventV1 {
  return {
    type,
    idempotencyKey: `chat-tag:${command.kind}:${command.commandId}`,
    payload: {
      schemaVersion: 1,
      commandId: command.commandId,
      channelId: command.channelId,
      occurredAt: command.occurredAt,
      ...payload,
    },
  };
}

function resultFor(
  command: ChatTagCommandV1,
  status: "applied" | "rejected",
  code: string,
  message: string,
  extras: Pick<ChatTagCommandResultV1, "event" | "xpAward"> = {},
): ChatTagCommandResultV1 {
  return {
    schemaVersion: 1,
    tenantId: command.tenantId,
    commandId: command.commandId,
    kind: command.kind,
    status,
    code,
    message,
    stateChanged: status === "applied",
    ...extras,
  };
}

function remember(state: ChatTagStateV1, result: ChatTagCommandResultV1): ChatTagCommandResultV1 {
  state.appliedCommands[result.commandId] = structuredClone(result);
  const keys = Object.keys(state.appliedCommands);
  for (const key of keys.slice(0, Math.max(0, keys.length - 500))) delete state.appliedCommands[key];
  return result;
}

function requireModerator(command: ChatTagCommandV1): ChatTagCommandResultV1 | null {
  return command.isModerator
    ? null
    : resultFor(command, "rejected", "moderator-required", "A broadcaster or moderator must perform this command.");
}

function availabilityDenial(player: ChatTagPlayerStateV1, actorUserId: string, nowMs: number): string | null {
  if (player.sleeping) return "target-sleeping";
  if (player.offline) return "target-offline";
  if (player.noTagbackFromUserId === actorUserId) return "target-no-tagback";
  const immuneUntil = player.timedImmunityUntil ? Date.parse(player.timedImmunityUntil) : 0;
  if (Number.isFinite(immuneUntil) && immuneUntil > nowMs) return "target-timed-immunity";
  return null;
}

function cloneState(state: ChatTagStateV1): ChatTagStateV1 {
  return structuredClone(state);
}

export function createChatTagState(tenantId: string): ChatTagStateV1 {
  if (!tenantId.trim()) throw new Error("tenantId is required");
  return {
    schemaVersion: CHAT_TAG_STATE_VERSION,
    tenantId,
    currentItUserId: null,
    lastTagAt: null,
    players: {},
    history: [],
    appliedCommands: {},
  };
}

export function assertChatTagStateV1(value: unknown, tenantId?: string): ChatTagStateV1 {
  if (!value || typeof value !== "object") throw new Error("Chat Tag state must be an object");
  const state = value as ChatTagStateV1;
  if (state.schemaVersion !== CHAT_TAG_STATE_VERSION) throw new Error("Unsupported Chat Tag state version");
  if (!state.tenantId || (tenantId && state.tenantId !== tenantId)) throw new Error("Chat Tag tenant mismatch");
  if (!state.players || !state.history || !state.appliedCommands) throw new Error("Chat Tag state is incomplete");
  return cloneState(state);
}

export function parseChatTagCommandText(message: string): ChatTagParsedCommandV1 | null {
  const tokens = message.trim().split(/\s+/);
  if (tokens.length < 2 || tokens[0]?.toLowerCase() !== "spmt") return null;
  const name = tokens[1]?.toLowerCase();
  if (!name) return null;
  if (["join", "leave", "status", "score", "rank", "players", "sleep", "wake", "rules", "help", "info"].includes(name)) {
    return { kind: name as Exclude<ChatTagParsedCommandV1["kind"], "tag" | "pass" | "grant-pass" | "toggle-away"> };
  }
  if (name === "whosit") return { kind: "status" };
  if (name === "stats") return { kind: "score" };
  if (name === "away") return { kind: "toggle-away" };
  if (name === "tag" || name === "pass" || name === "givepass") {
    const targetUsername = normalizeUsername(tokens[2] ?? "");
    if (!targetUsername) return null;
    return { kind: name === "givepass" ? "grant-pass" : name, targetUsername };
  }
  return null;
}

export function executeChatTagCommand(
  inputState: ChatTagStateV1,
  command: ChatTagCommandV1,
  rules: ChatTagRulesV1 = DEFAULT_CHAT_TAG_RULES,
): { state: ChatTagStateV1; result: ChatTagCommandResultV1 } {
  const state = assertChatTagStateV1(inputState, command.tenantId);
  const prior = state.appliedCommands[command.commandId];
  if (prior) return { state, result: { ...structuredClone(prior), status: "duplicate", stateChanged: false } };
  if (!command.commandId.trim()) throw new Error("commandId is required");
  if (!isValidIso(command.occurredAt)) throw new Error("occurredAt must be an ISO timestamp");

  const nowMs = Date.parse(command.occurredAt);
  const actor = state.players[command.actorUserId];

  if (command.kind === "join") {
    if (actor) {
      const result = remember(state, resultFor(command, "rejected", "already-joined", "You are already in Chat Tag."));
      return { state, result };
    }
    const username = normalizeUsername(command.username);
    if (!username) throw new Error("username is required");
    state.players[command.actorUserId] = {
      userId: command.actorUserId,
      username,
      joinedAt: command.occurredAt,
      lastActiveAt: command.occurredAt,
      score: 0,
      tagsMade: 0,
      timesTagged: 0,
      passCount: 0,
      sleeping: false,
      offline: false,
      timedImmunityUntil: null,
      noTagbackFromUserId: null,
    };
    if (!state.currentItUserId) state.currentItUserId = command.actorUserId;
    const result = remember(state, resultFor(command, "applied", "joined", `${username} joined Chat Tag.`, {
      event: eventFor(command, CHAT_TAG_PLAYER_JOINED, { userId: command.actorUserId, username }),
    }));
    return { state, result };
  }

  const moderatorMayActWithoutMembership = Boolean(command.isModerator) && (
    command.kind === "grant-pass" ||
    command.kind === "set-it" ||
    command.kind === "trigger-ffa" ||
    ((command.kind === "sleep" || command.kind === "wake") && command.targetUserId !== undefined)
  );
  if (!actor && !moderatorMayActWithoutMembership) {
    const result = remember(state, resultFor(command, "rejected", "not-a-player", "Join Chat Tag first with spmt join."));
    return { state, result };
  }
  const memberActor = actor as ChatTagPlayerStateV1;

  if (command.kind === "record-activity") {
    memberActor.lastActiveAt = command.occurredAt;
    memberActor.sleeping = false;
    memberActor.offline = false;
    const result = remember(state, resultFor(command, "applied", "activity-recorded", "Player activity recorded."));
    return { state, result };
  }

  if (command.kind === "leave") {
    const wasIt = state.currentItUserId === command.actorUserId;
    delete state.players[command.actorUserId];
    if (wasIt) {
      state.currentItUserId = null;
      state.lastTagAt = command.occurredAt;
      state.history.push({
        id: `chat-tag-history:${command.commandId}`,
        commandId: command.commandId,
        kind: "free-for-all",
        actorUserId: command.actorUserId,
        targetUserId: null,
        channelId: command.channelId,
        occurredAt: command.occurredAt,
        doublePoints: true,
        scoreAwarded: 0,
      });
    }
    const result = remember(state, resultFor(command, "applied", wasIt ? "left-free-for-all" : "left", `${memberActor.username} left Chat Tag.`, {
      event: eventFor(command, CHAT_TAG_PLAYER_LEFT, { userId: command.actorUserId, username: memberActor.username, freeForAll: wasIt }),
    }));
    return { state, result };
  }

  if (command.kind === "sleep" || command.kind === "wake") {
    const targetUserId = command.targetUserId ?? command.actorUserId;
    if (targetUserId !== command.actorUserId && !command.isModerator) {
      const result = remember(state, resultFor(command, "rejected", "moderator-required", "Only a moderator can change another player's availability."));
      return { state, result };
    }
    const target = state.players[targetUserId];
    if (!target) {
      const result = remember(state, resultFor(command, "rejected", "target-not-a-player", "The target is not in Chat Tag."));
      return { state, result };
    }
    target.sleeping = command.kind === "sleep";
    if (command.kind === "wake") target.offline = false;
    const result = remember(state, resultFor(command, "applied", command.kind === "sleep" ? "sleeping" : "awake", `${target.username} is now ${command.kind === "sleep" ? "sleeping" : "awake"}.`, {
      event: eventFor(command, CHAT_TAG_PLAYER_AVAILABILITY_CHANGED, { userId: targetUserId, sleeping: target.sleeping, offline: target.offline }),
    }));
    return { state, result };
  }

  if (command.kind === "grant-pass") {
    const denied = requireModerator(command);
    if (denied) {
      const result = remember(state, denied);
      return { state, result };
    }
    const target = state.players[command.targetUserId];
    if (!target) {
      const result = remember(state, resultFor(command, "rejected", "target-not-a-player", "The target is not in Chat Tag."));
      return { state, result };
    }
    if (target.passCount >= rules.maxPasses) {
      const result = remember(state, resultFor(command, "rejected", "pass-wallet-full", `${target.username} already has the maximum number of passes.`));
      return { state, result };
    }
    target.passCount += 1;
    const result = remember(state, resultFor(command, "applied", "pass-granted", `${target.username} received a Chat Tag pass.`, {
      event: eventFor(command, CHAT_TAG_PASS_GRANTED, { userId: target.userId, username: target.username, passCount: target.passCount }),
    }));
    return { state, result };
  }

  if (command.kind === "set-it" || command.kind === "trigger-ffa") {
    const denied = requireModerator(command);
    if (denied) {
      const result = remember(state, denied);
      return { state, result };
    }
    if (command.kind === "set-it") {
      const target = state.players[command.targetUserId];
      if (!target) {
        const result = remember(state, resultFor(command, "rejected", "target-not-a-player", "The target is not in Chat Tag."));
        return { state, result };
      }
      state.currentItUserId = target.userId;
      target.sleeping = false;
      target.offline = false;
      const result = remember(state, resultFor(command, "applied", "it-assigned", `${target.username} is now it.`, {
        event: eventFor(command, CHAT_TAG_PLAYER_AVAILABILITY_CHANGED, { userId: target.userId, isIt: true }),
      }));
      return { state, result };
    }
    state.currentItUserId = null;
    state.lastTagAt = command.occurredAt;
    state.history.push({
      id: `chat-tag-history:${command.commandId}`,
      commandId: command.commandId,
      kind: "free-for-all",
      actorUserId: command.actorUserId,
      targetUserId: null,
      channelId: command.channelId,
      occurredAt: command.occurredAt,
      doublePoints: true,
      scoreAwarded: 0,
    });
    const result = remember(state, resultFor(command, "applied", "free-for-all", "Chat Tag is now free for all.", {
      event: eventFor(command, CHAT_TAG_FREE_FOR_ALL_STARTED, { actorUserId: command.actorUserId }),
    }));
    return { state, result };
  }

  if (command.kind !== "tag" && command.kind !== "pass") {
    const exhaustive: never = command;
    throw new Error(`Unsupported Chat Tag command: ${JSON.stringify(exhaustive)}`);
  }

  const target = state.players[command.targetUserId];
  if (!target) {
    const result = remember(state, resultFor(command, "rejected", "target-not-a-player", "The target is not in Chat Tag."));
    return { state, result };
  }
  if (target.userId === memberActor.userId) {
    const result = remember(state, resultFor(command, "rejected", "cannot-tag-self", "You cannot tag yourself."));
    return { state, result };
  }
  const usingPass = command.kind === "pass";
  if (!usingPass && state.currentItUserId && state.currentItUserId !== memberActor.userId) {
    const itName = state.players[state.currentItUserId]?.username ?? state.currentItUserId;
    const result = remember(state, resultFor(command, "rejected", "not-it", `${itName} is it.`));
    return { state, result };
  }
  if (usingPass) {
    if (memberActor.passCount <= 0) {
      const result = remember(state, resultFor(command, "rejected", "no-pass", "You do not have a Chat Tag pass."));
      return { state, result };
    }
    const cutoff = nowMs - rules.passSpendWindowMs;
    const recentPasses = state.history.filter((entry) => entry.kind === "pass" && entry.actorUserId === memberActor.userId && Date.parse(entry.occurredAt) > cutoff && Date.parse(entry.occurredAt) <= nowMs).length;
    if (recentPasses >= rules.passSpendLimit) {
      const result = remember(state, resultFor(command, "rejected", "pass-spend-limit", "You already used the maximum number of passes in the last 24 hours."));
      return { state, result };
    }
  }
  const immunityCode = availabilityDenial(target, memberActor.userId, nowMs);
  if (immunityCode) {
    const result = remember(state, resultFor(command, "rejected", immunityCode, `${target.username} is currently immune.`));
    return { state, result };
  }

  const doublePoints = usingPass || state.currentItUserId === null;
  const scoreAwarded = rules.tagSuccessPoints * (doublePoints ? 2 : 1);
  if (usingPass) memberActor.passCount -= 1;
  memberActor.score += scoreAwarded;
  memberActor.tagsMade += 1;
  memberActor.lastActiveAt = command.occurredAt;
  memberActor.timedImmunityUntil = new Date(nowMs + rules.immunityMs).toISOString();
  memberActor.noTagbackFromUserId = null;
  target.score -= rules.taggedPenaltyPoints;
  target.timesTagged += 1;
  target.lastActiveAt = command.occurredAt;
  target.noTagbackFromUserId = memberActor.userId;
  state.currentItUserId = target.userId;
  state.lastTagAt = command.occurredAt;
  const history: ChatTagHistoryEntryV1 = {
    id: `chat-tag-history:${command.commandId}`,
    commandId: command.commandId,
    kind: usingPass ? "pass" : "tag",
    actorUserId: memberActor.userId,
    targetUserId: target.userId,
    channelId: command.channelId,
    occurredAt: command.occurredAt,
    doublePoints,
    scoreAwarded,
  };
  state.history.push(history);
  const idempotencyKey = `chat-tag:${command.kind}:${command.commandId}`;
  const result = remember(state, resultFor(command, "applied", usingPass ? "pass-completed" : "tag-completed", `${memberActor.username} tagged ${target.username}${doublePoints ? " for double points" : ""}.`, {
    event: eventFor(command, CHAT_TAG_TAG_COMPLETED, {
      historyId: history.id,
      actorUserId: memberActor.userId,
      actorUsername: memberActor.username,
      targetUserId: target.userId,
      targetUsername: target.username,
      doublePoints,
      passUsed: usingPass,
      scoreAwarded,
    }),
    xpAward: {
      userId: memberActor.userId,
      delta: scoreAwarded,
      reason: usingPass ? "chat-tag.pass" : "chat-tag.tag",
      idempotencyKey,
    },
  }));
  return { state, result };
}

export function getChatTagStatus(state: ChatTagStateV1): { freeForAll: boolean; currentItUserId: string | null; currentItUsername: string | null; playerCount: number } {
  const current = state.currentItUserId ? state.players[state.currentItUserId] : undefined;
  return {
    freeForAll: !current,
    currentItUserId: current?.userId ?? null,
    currentItUsername: current?.username ?? null,
    playerCount: Object.keys(state.players).length,
  };
}

export function getChatTagLeaderboard(state: ChatTagStateV1): ChatTagPlayerStateV1[] {
  return Object.values(state.players)
    .map((player) => structuredClone(player))
    .sort((left, right) => right.score - left.score || right.tagsMade - left.tagsMade || left.username.localeCompare(right.username));
}

export async function publishChatTagCommandResult(client: SpmtClient, result: ChatTagCommandResultV1): Promise<{ eventPublished: boolean; xpAwarded: boolean }> {
  let eventPublished = false;
  let xpAwarded = false;
  if (result.event) {
    await client.publishEvent(result.tenantId, result.event.type, result.event.payload, result.event.idempotencyKey);
    eventPublished = true;
  }
  if (result.xpAward) {
    await client.awardXp(result.tenantId, result.xpAward.userId, result.xpAward.delta, result.xpAward.reason, result.xpAward.idempotencyKey);
    xpAwarded = true;
  }
  return { eventPublished, xpAwarded };
}
