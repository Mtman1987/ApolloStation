export interface NebulaGameV1 {
  id: string;
  name: string;
  summary: string;
  commands: string[];
  overlayWidgets: string[];
}

function game(id: string, name: string, summary: string, commands: string[], overlayWidgets: string[]): NebulaGameV1 {
  return Object.freeze({ id, name, summary, commands: Object.freeze([...commands]) as unknown as string[], overlayWidgets: Object.freeze([...overlayWidgets]) as unknown as string[] });
}

export const NEBULA_ARCADE_GAMES: readonly NebulaGameV1[] = Object.freeze([
  game("tag", "Tag", "A live Nebula Arcade game of tagging, passing, immunity, crowns, and persistent scores across chat.", ["join", "leave", "status", "score", "tag", "pass"], ["current-it", "scoreboard", "activity"]),
  game("quackverse", "Quackverse", "Collect, trade, reveal, and battle community duck cards.", ["pack", "quackpack", "collection", "deck", "accept"], ["card-reveal", "collection", "battlefield", "activity"]),
  game("bingo", "Bingo", "A shared chat bingo board that turns stream moments and community prompts into a race.", ["card", "claim", "phrases", "leave", "status"], ["board", "winners"]),
  game("chaosmode", "Chaos Mode", "Timed community chaos events where chat actions modify the active round.", ["chaos", "explode", "glitch", "portal", "shake", "leave", "status"], ["round", "activity"]),
  game("chatgarden", "Chat Garden", "A cooperative garden that grows through chat participation and shared community actions.", ["garden", "grow", "leave", "status"], ["garden", "progress"]),
  game("chatwars", "Chat Wars", "Community teams compete through chat actions, objectives, and round scoring.", ["wars", "red", "blue", "green", "yellow", "leave", "status"], ["teams", "scoreboard"]),
  game("chickenroyale", "Chicken Royale", "A chat-driven elimination game where players survive rounds until one chicken remains.", ["chicken", "hatch", "launch", "start", "stop", "leave", "status"], ["arena", "survivors"]),
  game("colorsymphony", "Color Symphony", "Chat builds a collaborative color performance through synchronized choices and reactions.", ["symphony", "harmony", "leave", "status"], ["canvas", "activity"]),
  game("colorwars", "Color Wars", "Players choose colors and compete for control of a shared visual field.", ["colors", "red", "blue", "green", "yellow", "leave", "status"], ["battlefield", "scoreboard"]),
  game("dancingparade", "Dancing Parade", "A shared parade where chat joins, dances, and builds the on-screen procession.", ["parade", "dance", "leave", "status"], ["parade", "activity"]),
  game("emojirain", "Emoji Rain", "Community emoji choices become a live falling visual game on stream.", ["rain", "leave", "status"], ["rain", "counter"]),
  game("emojitower", "Emoji Tower", "Players stack emoji pieces and try to keep the community tower standing.", ["tower", "drop", "leave", "status"], ["tower", "height"]),
  game("memorylane", "Memory Lane", "A community memory challenge using prompts, sequences, and recall rounds.", ["memory", "leave", "status"], ["sequence", "scoreboard"]),
  game("petrace", "Pet Race", "Chat joins pets into a race and follows the field through each round.", ["pet", "race", "leave", "status"], ["track", "standings"]),
  game("phraseguess", "Phrase Guess", "Chat races to solve hidden phrases while clues are revealed over time.", ["phrase", "leave", "status"], ["phrase", "guesses"]),
  game("pixelbattle", "Pixel Battle", "Players compete and collaborate on a shared pixel battlefield.", ["pixel", "paint", "leave", "status"], ["canvas", "teams"]),
  game("rhythmpulse", "Rhythm Pulse", "A timing game where chat reactions drive a shared rhythm sequence.", ["rhythm", "leave", "status"], ["pulse", "streak"]),
  game("treasurehunt", "Treasure Hunt", "Chat follows clues, accepts discoveries, and races through a shared hunt.", ["treasure", "dig", "accept", "leave", "status"], ["map", "clues"]),
  game("wordchain", "Word Chain", "Players keep a word chain alive by responding with valid linked words.", ["chain", "leave", "status"], ["chain", "streak"]),
  game("wordstorm", "Word Storm", "A rapid word challenge where chat scores through valid responses during timed rounds.", ["storm", "leave", "status"], ["round", "scoreboard"]),
]);

export interface NebulaCommandTargetV1 { gameId: string; command: string; args: string[]; }
export type NebulaCommandResolutionV1 =
  | { kind: "none"; targets: [] }
  | { kind: "single"; targets: [NebulaCommandTargetV1] }
  | { kind: "broadcast"; command: string; args: string[]; targets: NebulaCommandTargetV1[] }
  | { kind: "choose-game"; command: string; args: string[]; targets: NebulaCommandTargetV1[]; prompt: string };

const JOIN_ALIASES = new Map<string, string>([
  ["pack", "quackverse"], ["quackpack", "quackverse"], ["card", "bingo"], ["chaos", "chaosmode"], ["garden", "chatgarden"], ["grow", "chatgarden"],
  ["wars", "chatwars"], ["chicken", "chickenroyale"], ["hatch", "chickenroyale"], ["symphony", "colorsymphony"], ["harmony", "colorsymphony"],
  ["colors", "colorwars"], ["parade", "dancingparade"], ["rain", "emojirain"], ["tower", "emojitower"], ["memory", "memorylane"],
  ["pet", "petrace"], ["race", "petrace"], ["phrase", "phraseguess"], ["pixel", "pixelbattle"], ["rhythm", "rhythmpulse"], ["treasure", "treasurehunt"],
  ["chain", "wordchain"], ["storm", "wordstorm"],
]);

const ACTION_ALIASES = new Map<string, { gameId: string; command: string }>([
  ["explode", { gameId: "chaosmode", command: "explode" }], ["glitch", { gameId: "chaosmode", command: "glitch" }], ["portal", { gameId: "chaosmode", command: "portal" }], ["shake", { gameId: "chaosmode", command: "shake" }],
  ["launch", { gameId: "chickenroyale", command: "start" }], ["dance", { gameId: "dancingparade", command: "dance" }], ["drop", { gameId: "emojitower", command: "drop" }],
  ["claim", { gameId: "bingo", command: "claim" }], ["phrases", { gameId: "bingo", command: "phrases" }], ["paint", { gameId: "pixelbattle", command: "paint" }], ["dig", { gameId: "treasurehunt", command: "dig" }],
]);

function parseCommand(text: string) {
  const match = /^!(\S+)(?:\s+(.*))?$/i.exec(String(text || "").trim());
  if (!match) return null;
  return { command: match[1]!.toLowerCase(), args: match[2]?.trim().split(/\s+/).filter(Boolean) ?? [] };
}

export function routeNebulaCommand(text: string, enabledGameIds: readonly string[], pendingGameIds: readonly string[] = []): NebulaCommandTargetV1[] {
  const parsed = parseCommand(text);
  if (!parsed) return [];
  const { command, args } = parsed;
  const enabled = new Set(enabledGameIds.map(normalizeGameId));
  const pending = new Set(pendingGameIds.map(normalizeGameId));

  const directAction = ACTION_ALIASES.get(command);
  if (directAction && enabled.has(directAction.gameId)) return [{ gameId: directAction.gameId, command: directAction.command, args }];

  if (command === "pet" || command === "race") return enabled.has("petrace") ? [{ gameId: "petrace", command: "pet", args }] : [];

  if (command === "red" || command === "blue" || command === "green" || command === "yellow") {
    return ["chatwars", "colorwars"].filter((gameId) => enabled.has(gameId)).map((gameId) => ({ gameId, command, args }));
  }

  const joinTarget = JOIN_ALIASES.get(command);
  if (joinTarget && enabled.has(joinTarget)) return [{ gameId: joinTarget, command, args }];

  if (command === "accept") {
    return NEBULA_ARCADE_GAMES.filter((item) => enabled.has(item.id) && pending.has(item.id) && item.commands.includes("accept")).map((item) => ({ gameId: item.id, command, args }));
  }

  return NEBULA_ARCADE_GAMES.filter((item) => enabled.has(item.id) && item.commands.includes(command)).map((item) => ({ gameId: item.id, command, args }));
}

export function resolveNebulaCommand(text: string, enabledGameIds: readonly string[], pendingGameIds: readonly string[] = []): NebulaCommandResolutionV1 {
  const parsed = parseCommand(text);
  const targets = routeNebulaCommand(text, enabledGameIds, pendingGameIds);
  if (!parsed || targets.length === 0) return { kind: "none", targets: [] };
  if (targets.length === 1) return { kind: "single", targets: [targets[0]!] };

  // Team-color actions are intentionally safe to fan out when both games are active.
  if (["red", "blue", "green", "yellow"].includes(parsed.command) && targets.every((target) => target.gameId === "chatwars" || target.gameId === "colorwars")) {
    return { kind: "broadcast", command: parsed.command, args: parsed.args, targets };
  }

  const choices = targets.map((target, index) => {
    const item = NEBULA_ARCADE_GAMES.find((candidate) => candidate.id === target.gameId);
    return `${index + 1} for ${item?.name ?? target.gameId}`;
  });
  return { kind: "choose-game", command: parsed.command, args: parsed.args, targets, prompt: `More than one active game uses !${parsed.command}. What game would you like? Type ${choices.join(", ")}.` };
}

export function nebulaGameCommandHelp(gameId: string): string[] {
  const game = NEBULA_ARCADE_GAMES.find((item) => item.id === normalizeGameId(gameId));
  if (!game) return [];
  return game.commands.map((command) => `!${command}`);
}

function normalizeGameId(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}
