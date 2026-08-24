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
  game("chat-tag", "Chat Tag", "A live community game of tagging, passing, immunity, crowns, and persistent scores across chat.", ["join", "leave", "status", "score", "tag", "pass"], ["current-it", "scoreboard", "activity"]),
  game("quackverse", "Quackverse", "Collect, trade, and reveal community duck cards while chat builds a shared collection.", ["join", "leave", "status", "accept"], ["card-reveal", "collection", "activity"]),
  game("bingo", "Bingo", "A shared chat bingo board that turns stream moments and community prompts into a race.", ["join", "leave", "status", "accept"], ["board", "winners"]),
  game("chaosmode", "Chaos Mode", "Timed community chaos events where chat actions modify the active round.", ["join", "leave", "status"], ["round", "activity"]),
  game("chatgarden", "Chat Garden", "A cooperative garden that grows through chat participation and shared community actions.", ["join", "leave", "status"], ["garden", "progress"]),
  game("chatwars", "Chat Wars", "Community teams compete through chat actions, objectives, and round scoring.", ["join", "leave", "status"], ["teams", "scoreboard"]),
  game("chickenroyale", "Chicken Royale", "A chat-driven elimination game where players survive rounds until one chicken remains.", ["join", "leave", "status", "start"], ["arena", "survivors"]),
  game("colorsymphony", "Color Symphony", "Chat builds a collaborative color performance through synchronized choices and reactions.", ["join", "leave", "status"], ["canvas", "activity"]),
  game("colorwars", "Color Wars", "Players choose colors and compete for control of a shared visual field.", ["join", "leave", "status"], ["battlefield", "scoreboard"]),
  game("dancingparade", "Dancing Parade", "A shared parade where chat joins, dances, and builds the on-screen procession.", ["join", "leave", "status", "dance"], ["parade", "activity"]),
  game("emojirain", "Emoji Rain", "Community emoji choices become a live falling visual game on stream.", ["join", "leave", "status"], ["rain", "counter"]),
  game("emojitower", "Emoji Tower", "Players stack emoji pieces and try to keep the community tower standing.", ["join", "leave", "status", "drop"], ["tower", "height"]),
  game("memorylane", "Memory Lane", "A community memory challenge using prompts, sequences, and recall rounds.", ["join", "leave", "status"], ["sequence", "scoreboard"]),
  game("petrace", "Pet Race", "Chat joins pets into a race and follows the field through each round.", ["join", "leave", "status"], ["track", "standings"]),
  game("phraseguess", "Phrase Guess", "Chat races to solve hidden phrases while clues are revealed over time.", ["join", "leave", "status"], ["phrase", "guesses"]),
  game("pixelbattle", "Pixel Battle", "Players compete and collaborate on a shared pixel battlefield.", ["join", "leave", "status"], ["canvas", "teams"]),
  game("rhythmpulse", "Rhythm Pulse", "A timing game where chat reactions drive a shared rhythm sequence.", ["join", "leave", "status"], ["pulse", "streak"]),
  game("treasurehunt", "Treasure Hunt", "Chat follows clues, accepts discoveries, and races through a shared hunt.", ["join", "leave", "status", "accept"], ["map", "clues"]),
  game("wordchain", "Word Chain", "Players keep a word chain alive by responding with valid linked words.", ["join", "leave", "status"], ["chain", "streak"]),
  game("wordstorm", "Word Storm", "A rapid word challenge where chat scores through valid responses during timed rounds.", ["join", "leave", "status"], ["round", "scoreboard"]),
]);

export interface NebulaCommandTargetV1 { gameId: string; command: string; args: string[]; }

export type NebulaCommandResolutionV1 =
  | { kind: "none"; targets: [] }
  | { kind: "single"; targets: [NebulaCommandTargetV1] }
  | { kind: "choose-game"; command: string; args: string[]; targets: NebulaCommandTargetV1[]; prompt: string };

export function routeNebulaCommand(text: string, enabledGameIds: readonly string[], pendingGameIds: readonly string[] = []): NebulaCommandTargetV1[] {
  const match = /^!(\S+)(?:\s+(.*))?$/i.exec(text.trim());
  if (!match) return [];
  const command = match[1]!.toLowerCase();
  const args = match[2]?.trim().split(/\s+/).filter(Boolean) ?? [];
  const enabled = new Set(enabledGameIds);
  const pending = new Set(pendingGameIds);
  return NEBULA_ARCADE_GAMES
    .filter((item) => enabled.has(item.id) && item.commands.includes(command) && (command !== "accept" || pending.has(item.id)))
    .map((item) => ({ gameId: item.id, command, args }));
}

export function resolveNebulaCommand(text: string, enabledGameIds: readonly string[], pendingGameIds: readonly string[] = []): NebulaCommandResolutionV1 {
  const targets = routeNebulaCommand(text, enabledGameIds, pendingGameIds);
  if (targets.length === 0) return { kind: "none", targets: [] };
  if (targets.length === 1) return { kind: "single", targets: [targets[0]!] };
  const choices = targets.map((target, index) => {
    const item = NEBULA_ARCADE_GAMES.find((candidate) => candidate.id === target.gameId);
    return `${index + 1} for ${item?.name ?? target.gameId}`;
  });
  return {
    kind: "choose-game",
    command: targets[0]!.command,
    args: targets[0]!.args,
    targets,
    prompt: `More than one active game uses !${targets[0]!.command}. What game would you like? Type ${choices.join(", ")}.`,
  };
}
